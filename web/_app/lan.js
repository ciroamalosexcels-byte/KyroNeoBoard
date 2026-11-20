// Kyro Neo Board · sala en la red local (LAN): trabajar de a varios en la misma mesa.
// Quien abre la sala comparte SU proyecto: las fotos quedan en su compu y los demás
// (otra compu, un celu, una tablet) entran desde el navegador con un enlace o un QR.
//
// - Puerta de la red: un segundo servidor en 0.0.0.0 que solo deja pasar lo justo
//   (la mesa, las fotos de ESE proyecto y subir fotos nuevas), con una sesión admitida.
// - En vivo: un relevo por WebSocket (/ws). No guarda nada: reenvía los cambios entre todos.
// - Salas cerca: cada programa anuncia por UDP su sala abierta, para entrar sin escribir direcciones.
'use strict';
const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');

const LAN_PORT = 47830, DISCOVERY_PORT = 3739;
const CODE_RE = /^[A-Z0-9]{4,12}$/;
const inside = (p, base) => p === base || p.startsWith(base + path.sep);
// lo único que se puede pedir desde la red (todo lo demás: explorador, archivos, exportar… solo en la compu que abrió la sala)
const LAN_API = new Set(['/api/list', '/api/exif', '/api/img', '/api/upload', '/api/import-url', '/api/version', '/api/formats']);

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  // primero las de casa / oficina (192.168…, 10…), después las demás
  return out.sort((a, b) => (/^(192\.168|10)\./.test(b) ? 1 : 0) - (/^(192\.168|10)\./.test(a) ? 1 : 0));
}
function newCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.randomBytes(6)].map(b => a[b % a.length]).join('');
}
const cookieOf = (req, k) => (String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(k + '=')) || '').slice(k.length + 1);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PAGE_STYLE = `:root{--bg:#efe8d8;--paper:#fffaf0;--ink:#16130f;--muted:#5f5849;--stage:#2b6b58;--hl:#ffe14d}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--stage);color:var(--ink);font:16px Archivo,system-ui,sans-serif}
main{box-sizing:border-box;margin:24px;padding:28px;width:min(380px,calc(100% - 48px));background:var(--paper);border-radius:18px;box-shadow:6px 6px 0 var(--ink)}
h1{font-size:24px;font-weight:800;overflow-wrap:anywhere}label{display:grid;gap:8px;margin:18px 0;font-weight:700}
input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;border-radius:12px;border:0;color:var(--ink)}
input{background:var(--bg);box-shadow:2px 2px 0 var(--ink)}input:focus-visible{outline:none;box-shadow:4px 4px 0 var(--ink)}
button{background:var(--hl);font-weight:800;box-shadow:4px 4px 0 var(--ink);cursor:pointer}
button:hover:not(:disabled){transform:translate(-1px,-1px);box-shadow:5px 6px 0 var(--ink)}button:active:not(:disabled){transform:translate(2px,2px);box-shadow:none}
button:focus-visible,a:focus-visible{outline:2px solid var(--ink);outline-offset:4px}button:disabled{opacity:.6;cursor:wait}p{line-height:1.5;color:var(--muted)}a{color:var(--ink)}`;
function page(res, code, title, text) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kyro Neo Board</title><link rel="stylesheet" href="/_app/fonts/archivo.css"><style>${PAGE_STYLE}</style><main><h1>${esc(title)}</h1><p>${esc(text)}</p></main></html>`);
}

/* ---------- salas cerca (UDP) ---------- */
function broadcastTargets() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) {
    if (n.family !== 'IPv4' || n.internal || !n.netmask) continue;
    const a = n.address.split('.').map(Number), m = n.netmask.split('.').map(Number);
    out.add(a.map((x, i) => x | (~m[i] & 255)).join('.'));
  }
  return [...out];
}
function startDiscovery(getInfo, { listenPort = DISCOVERY_PORT, targets } = {}) {
  const id = crypto.randomBytes(6).toString('hex'), peers = new Map();
  const debug = (...args) => { if (process.env.MESA_LAN_DEBUG) console.error('[LAN]', id, ...args); };
  let sock = null;
  const payload = () => {
    const info = getInfo();
    return info ? Buffer.from(JSON.stringify({ app: 'kyro-neo', v: 1, id, ...info })) : null;
  };
  const broadcast = data => {
    if (!sock) return;
    const destinations = targets || broadcastTargets().map(address => ({ address, port: DISCOVERY_PORT }));
    for (const { address, port } of destinations) try { sock.send(data, port, address, e => { if (e) debug('send', address, e.code); }); } catch (e) { debug('send', address, e.code); }
  };
  try {
    sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', e => debug('socket', e.code));
    sock.on('message', (msg, rinfo) => {
      let m; try { m = JSON.parse(String(msg)); } catch { return; }
      if (!m || m.app !== 'kyro-neo' || m.id === id) return;
      if (m.query === true) {
        const data = payload();
        // Anunciar a todos: en Windows puede haber varios oyentes en el mismo puerto.
        if (data) broadcast(data);
        return;
      }
      if (!Number.isInteger(m.port) || m.port < 1 || m.port > 65535 || !CODE_RE.test(m.code || '')) return;
      peers.set(m.id, { name: String(m.name || '').slice(0, 40), project: String(m.project || '').slice(0, 60), host: rinfo.address, port: m.port, code: m.code, people: Number(m.people) || 0, t: Date.now() });
    });
    sock.bind(listenPort, () => {
      try { sock.setBroadcast(true); } catch {}
      const data = payload();
      if (data) broadcast(data);
      else broadcast(Buffer.from(JSON.stringify({ app: 'kyro-neo', v: 1, id, query: true })));
    });
  } catch { sock = null; }
  const timer = setInterval(() => {
    const now = Date.now();
    peers.forEach((p, k) => { if (now - p.t > 7000) peers.delete(k); });
    const data = payload();
    if (data) broadcast(data);
  }, 2000);
  timer.unref();
  return {
    list: () => [...peers.values()].filter(p => Date.now() - p.t <= 7000).map(p => ({ ...p, url: `http://${p.host}:${p.port}/sala/${p.code}` })),
    query: () => broadcast(Buffer.from(JSON.stringify({ app: 'kyro-neo', v: 1, id, query: true }))),
    close: () => { clearInterval(timer); try { sock?.close(); } catch {} },
  };
}

/* ---------- la sala ---------- */
function createLan({ handler, safe, discoveryOptions }) {
  const room = { code: null, dir: null, project: '', server: null, port: 0, peers: new Map(), hostGone: null,
    approval: false, password: null, sessions: new Set(), requests: new Map(), attempts: new Map() };
  let discovery = null;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

  const presence = () => {
    const peers = {};
    room.peers.forEach((v, id) => { peers[id] = v.meta; });
    const msg = JSON.stringify({ t: 'presence', peers });
    room.peers.forEach(v => { if (v.ws.readyState === 1) v.ws.send(msg); });
  };
  const cleanMeta = (m, host) => {
    m = m && typeof m === 'object' ? m : {};
    return { name: String(m.name || '').slice(0, 24), color: /^#[0-9a-fA-F]{3,8}$/.test(m.color || '') ? m.color : '#888888',
      icon: /^[a-z0-9-]{1,16}$/.test(m.icon || '') ? m.icon : 'smile', host: !!host, device: /^(pc|phone|tablet)$/.test(m.device || '') ? m.device : 'pc' };
  };

  // conexión en vivo: desde esta compu (quien abrió la sala) o desde la red (con la llave)
  function upgrade(req, socket, head, fromLan) {
    const u = new URL(req.url, 'http://x'), id = u.searchParams.get('id') || '', roomCode = room.code;
    if (u.pathname !== '/ws' || !room.code || !id || id.length > 64 || (fromLan && !room.sessions.has(cookieOf(req, 'kyro_sala')))) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => {
      const isHost = !fromLan;
      const old = room.peers.get(id);
      // Un invitado no puede reemplazar la conexión del anfitrión ni la de otro invitado.
      const session = fromLan ? cookieOf(req, 'kyro_sala') : 'host';
      if (old && old.session !== session) return ws.close(4001, 'identidad en uso');
      if (old) try { old.ws.close(); } catch {}
      room.peers.set(id, { ws, meta: cleanMeta({}, isHost), host: isHost, session });
      if (isHost && room.hostGone) { clearTimeout(room.hostGone); room.hostGone = null; }
      ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
      presence();
      ws.on('message', data => {
        let m; try { m = JSON.parse(String(data)); } catch { return; }
        const me = room.peers.get(id); if (!me || me.ws !== ws) return;
        if (m.t === 'track') { me.meta = cleanMeta(m.meta, isHost); presence(); }
        else if (m.t === 'bc' && m.payload) {
          const out = JSON.stringify({ t: 'bc', from: id, payload: m.payload });
          room.peers.forEach((v, other) => { if (other !== id && (!m.to || m.to === other) && v.ws.readyState === 1) v.ws.send(out); });
        }
      });
      ws.on('close', () => {
        if (room.code !== roomCode) return;
        const me = room.peers.get(id);
        if (me && me.ws === ws) room.peers.delete(id);
        presence();
        // si quien abrió la sala se fue (cerró la mesa), la sala se cierra en un rato (por si solo recargó)
        if (isHost && ![...room.peers.values()].some(v => v.host)) room.hostGone = setTimeout(() => stop(), 20000);
      });
    });
  }
  const beat = setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch {} }), 20000);
  beat.unref();

  const json = (res, status, data, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(data));
  };
  const cookie = token => `kyro_sala=${token}; Path=/; SameSite=Lax; HttpOnly`;
  const backOf = u => /^http:\/\/127\.0\.0\.1:\d+\/$/.test(u.searchParams.get('volver') || '') ? u.searchParams.get('volver') : '';
  const destination = u => `/?p=${encodeURIComponent(room.dir)}&sala=${room.code}` + (backOf(u) ? '&volver=' + encodeURIComponent(backOf(u)) : '');
  const passwordHash = value => crypto.createHash('sha256').update(String(value)).digest();
  function pruneRequests() {
    for (const [id, r] of room.requests) if (Date.now() - r.time > 120000) room.requests.delete(id);
    for (const [ip, r] of room.attempts) if (Date.now() - r.time > 60000) room.attempts.delete(ip);
  }
  function requests() {
    pruneRequests();
    return [...room.requests].filter(([, r]) => r.status === 'waiting').map(([id, r]) => ({ id, name: r.name }));
  }
  function decide(id, allow) {
    pruneRequests();
    const r = room.requests.get(id);
    if (!r || r.status !== 'waiting') return { error: 'La solicitud ya no está pendiente.' };
    r.status = allow ? 'accepted' : 'denied';
    if (allow) room.sessions.add(id);
    return { ok: true };
  }
  async function admission(req, res, u) {
    pruneRequests();
    const token = cookieOf(req, 'kyro_sala');
    if (req.method === 'GET') {
      if (room.sessions.has(token)) return json(res, 200, { status: 'accepted', next: destination(u) });
      return json(res, 200, { status: room.requests.get(token)?.status || 'expired' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido.' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Origen no permitido.' });
    // Acotar tanto los intentos de contraseña como las solicitudes de ingreso.
    const ip = req.socket.remoteAddress;
    const rate = room.attempts.get(ip) || { n: 0, time: Date.now() };
    room.attempts.set(ip, rate);
    if (++rate.n > 15) return json(res, 429, { error: 'Demasiados intentos. Esperá un minuto.' });
    let data = '', form;
    try {
      for await (const chunk of req) { data += chunk; if (data.length > 4096) return json(res, 413, { error: 'Solicitud demasiado larga.' }); }
      form = JSON.parse(data);
    } catch { return json(res, 400, { error: 'Solicitud inválida.' }); }
    if (room.password && !crypto.timingSafeEqual(room.password, passwordHash(form.password || ''))) return json(res, 403, { error: 'La contraseña no coincide.' });
    const name = String(form.name || '').trim().slice(0, 24);
    if (!name) return json(res, 400, { error: 'Falta tu nombre.' });
    if (room.requests.size >= 100 || room.sessions.size >= 500) return json(res, 429, { error: 'La sala está llena. Intentá más tarde.' });
    if (room.requests.get(token)?.status === 'waiting') return json(res, 200, { status: 'waiting' });
    const id = crypto.randomBytes(24).toString('hex');
    room.requests.set(id, { name, time: Date.now(), status: room.approval ? 'waiting' : 'accepted' });
    if (!room.approval) room.sessions.add(id);
    return json(res, 200, { status: room.approval ? 'waiting' : 'accepted', ...(!room.approval ? { next: destination(u) } : {}) }, { 'Set-Cookie': cookie(id) });
  }
  function admissionPage(res, u) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    // Página autocontenida: antes de la admisión no se sirven ni fotos ni la mesa.
    res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar a la sala · Kyro Neo Board</title><link rel="stylesheet" href="/_app/fonts/archivo.css">
<style>${PAGE_STYLE}</style>
<main><h1>${esc(room.project)}</h1><p>${room.approval ? 'Pedí entrar. El anfitrión tiene que aceptarte.' : 'Ingresá para conectarte a la sala.'}</p>
<form id="join"><label>Tu nombre<input id="name" maxlength="24" required autocomplete="nickname"></label>${room.password ? '<label>Contraseña de la sala<input id="password" type="password" maxlength="128" required autocomplete="current-password"></label>' : ''}<button id="enter">${room.approval ? 'Pedir entrar' : 'Entrar'}</button></form><p id="status" role="status" aria-live="polite"></p>${backOf(u) ? `<a href="${esc(backOf(u))}">Volver al inicio</a>` : ''}</main>
<script>
const endpoint = '/api/lan/admission' + location.search, form = document.querySelector('#join'), status = document.querySelector('#status'), button = document.querySelector('#enter');
let timer;
try { document.querySelector('#name').value = JSON.parse(localStorage.getItem('kyro-neo-perfil') || '{}').name || ''; } catch {}
async function result(data) {
  if (data.error) throw new Error(data.error);
  if (data.status === 'accepted') return location.replace(data.next);
  if (data.status === 'waiting') { status.textContent = 'Esperando la aprobación del anfitrión…'; timer = setTimeout(poll, 1500); return; }
  status.textContent = data.status === 'denied' ? 'El anfitrión rechazó la solicitud.' : 'La solicitud venció o la sala se cerró. Podés volver a intentar.';
  button.disabled = false;
}
async function poll() { try { await result(await (await fetch(endpoint)).json()); } catch { status.textContent = 'No se pudo contactar con la sala. Revisá la conexión y volvé a intentar.'; button.disabled = false; } }
form.onsubmit = async e => {
  e.preventDefault(); clearTimeout(timer); button.disabled = true; status.textContent = 'Conectando…';
  const name = document.querySelector('#name').value.trim();
  try {
    const profile = JSON.parse(localStorage.getItem('kyro-neo-perfil') || '{}'); profile.name = name; localStorage.setItem('kyro-neo-perfil', JSON.stringify(profile));
  } catch {}
  try { await result(await (await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: document.querySelector('#password')?.value || '' }) })).json()); }
  catch (e) { status.textContent = e.message; button.disabled = false; }
};
fetch(endpoint).then(r => r.json()).then(data => { if (data.status === 'waiting' || data.status === 'accepted') { button.disabled = true; result(data); } }).catch(() => {});
</script></html>`);
  }

  // la puerta de la red
  async function gate(req, res) {
    req.lan = true;
    const u = new URL(req.url, 'http://x');
    if (/^\/_app\/fonts\/[a-zA-Z0-9_.-]+\.(css|woff2)$/.test(u.pathname)) return handler(req, res);
    if (!room.code) return page(res, 404, 'No hay ninguna sala abierta', 'La sala se cerró. Pedile a quien la abrió que la vuelva a abrir y te mande el código nuevo.');
    if (u.pathname === '/api/lan/admission') return admission(req, res, u).catch(() => { if (!res.headersSent) json(res, 400, { error: 'No se pudo procesar el ingreso.' }); });
    const m = u.pathname.match(/^\/sala\/([A-Za-z0-9]{4,12})\/?$/);
    if (m) { // entrar con el enlace o el QR: queda la llave guardada y va a la mesa
      if (m[1].toUpperCase() !== room.code) return page(res, 403, 'Esa sala ya no está abierta', 'Pedile a quien abrió la sala el código o el QR nuevo.');
      if (!room.sessions.has(cookieOf(req, 'kyro_sala')) && (room.approval || room.password)) return admissionPage(res, u);
      if (room.sessions.size >= 500 && !room.sessions.has(cookieOf(req, 'kyro_sala'))) return page(res, 429, 'La sala está llena', 'Intentá más tarde.');
      const token = room.sessions.has(cookieOf(req, 'kyro_sala')) ? cookieOf(req, 'kyro_sala') : crypto.randomBytes(24).toString('hex'); room.sessions.add(token);
      res.writeHead(302, { 'Set-Cookie': cookie(token), Location: destination(u), 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (!room.sessions.has(cookieOf(req, 'kyro_sala'))) {
      if (u.pathname === '/') { res.writeHead(302, { Location: `/sala/${room.code}` + (backOf(u) ? '?volver=' + encodeURIComponent(backOf(u)) : '') }); return res.end(); }
      return page(res, 403, 'Hace falta entrar a la sala', 'Entrá con el código o el QR y completá el ingreso.');
    }
    try {
      if (u.pathname.startsWith('/api/')) {
        if (!LAN_API.has(u.pathname)) return page(res, 403, 'No permitido', 'Eso solo se puede hacer en la compu que abrió la sala.');
        for (const k of ['dir', 'path', 'file']) { const v = u.searchParams.get(k); if (v != null && !inside(path.resolve(v), room.dir)) return page(res, 403, 'No permitido', 'Solo las fotos de este proyecto.'); }
      } else if (!inside(path.resolve(safe.root, decodeURIComponent(u.pathname).replace(/^\/+/, '')), safe.root)) return page(res, 403, 'No permitido', '');
    } catch { return page(res, 400, 'Dirección inválida', ''); }
    return handler(req, res);
  }

  async function start(dir, project, options = {}) {
    dir = path.resolve(dir);
    if (room.code && room.dir === dir) return info();
    if (room.code) stop();
    const password = String(options.password || '');
    if (password.length > 128) throw new Error('La contraseña puede tener hasta 128 caracteres.');
    room.code = newCode(); room.dir = dir; room.project = project || path.basename(dir);
    room.approval = options.approval === true; room.password = password ? passwordHash(password) : null;
    if (!room.server) {
      room.server = http.createServer(gate);
      room.server.on('upgrade', (req, socket, head) => upgrade(req, socket, head, true));
      room.port = await new Promise((ok, ko) => {
        let p = LAN_PORT;
        const tryIt = () => { room.server.once('error', e => { if (e.code === 'EADDRINUSE' && p < LAN_PORT + 20) { p++; tryIt(); } else ko(e); }); room.server.listen(p, '0.0.0.0', () => ok(room.server.address().port)); };
        tryIt();
      });
    }
    discover();
    return info();
  }
  function stop() {
    if (room.hostGone) { clearTimeout(room.hostGone); room.hostGone = null; }
    room.peers.forEach(v => { try { v.ws.close(4000, 'sala cerrada'); } catch {} });
    room.peers.clear();
    room.sessions.clear(); room.requests.clear(); room.attempts.clear(); room.password = null;
    room.code = null; room.dir = null;
    try { room.server?.close(); } catch {}
    room.server?.closeAllConnections?.();
    room.server = null;
    return { on: false };
  }
  function info() {
    if (!room.code) return { on: false };
    return { on: true, code: room.code, dir: room.dir, project: room.project, port: room.port, people: room.peers.size, approval: room.approval, password: !!room.password,
      urls: lanAddresses().map(a => `http://${a}:${room.port}/sala/${room.code}`) };
  }
  function discover() { // empieza a anunciar / escuchar salas cerca (la primera vez que hace falta)
    discovery ||= startDiscovery(() => room.code ? { name: os.hostname(), project: room.project, port: room.port, code: room.code, people: room.peers.size } : null, discoveryOptions);
    return discovery;
  }
  async function resolve(code) {
    code = String(code || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return { error: 'Escribí el código que aparece en el ticket de la sala.' };
    const d = discover();
    d.query();
    // Dar tiempo a la otra compu a contestar, incluso recién abierto el programa.
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 250));
      const matches = d.list().filter(p => p.code === code);
      if (matches.length > 1) return { error: 'Hay dos salas con ese código. Pedile al anfitrión que vuelva a abrir su sala.' };
      if (matches.length === 1) return { code, url: matches[0].url };
      if (i === 7) d.query();
    }
    return { error: 'No encontré esa sala. Revisá el código, que siga abierta y que estén en la misma red.' };
  }
  return { start, stop, info, upgrade, requests, decide, resolve, peers: () => discover().list(), get dir() { return room.dir; },
    close: () => { stop(); discovery?.close(); clearInterval(beat); wss.close(); } };
}

module.exports = { createLan, lanAddresses };
