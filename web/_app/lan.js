// Kyro Neo Board · sala en la red local (LAN): trabajar de a varios en la misma mesa.
// Quien abre la sala comparte SU proyecto: las fotos quedan en su compu y los demás
// (otra compu, un celu, una tablet) entran desde el navegador con un enlace o un QR.
//
// - Puerta de la red: un segundo servidor en 0.0.0.0 que solo deja pasar lo justo
//   (la mesa, las fotos de ESE proyecto y subir fotos nuevas), y solo con la llave de la sala.
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
function page(res, code, title, text) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kyro Neo Board</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#2b6b58;font-family:system-ui,sans-serif;color:#16130f">
<div style="background:#fffaf0;border-radius:20px;padding:28px 30px;max-width:360px;box-shadow:5px 5px 0 #16130f;text-align:center">
<h2 style="margin:0 0 10px">${esc(title)}</h2><p style="margin:0;line-height:1.5;color:#5f5849">${esc(text)}</p></div></body>`);
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
function startDiscovery(getInfo) {
  const id = crypto.randomBytes(6).toString('hex'), peers = new Map();
  let sock = null;
  try {
    sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => {});
    sock.on('message', (msg, rinfo) => {
      let m; try { m = JSON.parse(String(msg)); } catch { return; }
      if (!m || m.app !== 'kyro-neo' || m.id === id || !Number.isInteger(m.port) || !CODE_RE.test(m.code || '')) return;
      peers.set(m.id, { name: String(m.name || '').slice(0, 40), project: String(m.project || '').slice(0, 60), host: rinfo.address, port: m.port, code: m.code, people: Number(m.people) || 0, t: Date.now() });
    });
    sock.bind(DISCOVERY_PORT, () => { try { sock.setBroadcast(true); } catch {} });
  } catch { sock = null; }
  const timer = setInterval(() => {
    const now = Date.now();
    peers.forEach((p, k) => { if (now - p.t > 7000) peers.delete(k); });
    const info = getInfo();
    if (!sock || !info) return;
    const payload = Buffer.from(JSON.stringify({ app: 'kyro-neo', v: 1, id, ...info }));
    for (const addr of broadcastTargets()) try { sock.send(payload, DISCOVERY_PORT, addr, () => {}); } catch {}
  }, 2000);
  timer.unref();
  return {
    list: () => [...peers.values()].map(p => ({ ...p, url: `http://${p.host}:${p.port}/sala/${p.code}` })),
    close: () => { clearInterval(timer); try { sock?.close(); } catch {} },
  };
}

/* ---------- la sala ---------- */
function createLan({ handler, safe }) {
  const room = { code: null, dir: null, project: '', server: null, port: 0, peers: new Map(), hostGone: null };
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
    const u = new URL(req.url, 'http://x'), id = u.searchParams.get('id') || '';
    if (u.pathname !== '/ws' || !room.code || !id || id.length > 64 || (fromLan && cookieOf(req, 'kyro_sala') !== room.code)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => {
      const isHost = !fromLan;
      const old = room.peers.get(id); if (old) try { old.ws.close(); } catch {}
      room.peers.set(id, { ws, meta: cleanMeta({}, isHost), host: isHost });
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

  // la puerta de la red
  function gate(req, res) {
    req.lan = true;
    const u = new URL(req.url, 'http://x');
    if (!room.code) return page(res, 404, 'No hay ninguna sala abierta', 'La sala se cerró. Pedile a quien la abrió que la vuelva a abrir y te mande el enlace nuevo.');
    const m = u.pathname.match(/^\/sala\/([A-Za-z0-9]{4,12})\/?$/);
    if (m) { // entrar con el enlace o el QR: queda la llave guardada y va a la mesa
      if (m[1].toUpperCase() !== room.code) return page(res, 403, 'Esa sala ya no está abierta', 'Pedile a quien abrió la sala el enlace o el QR nuevo.');
      res.writeHead(302, { 'Set-Cookie': `kyro_sala=${room.code}; Path=/; SameSite=Strict; HttpOnly`, Location: `/?p=${encodeURIComponent(room.dir)}&sala=${room.code}` + (/^http:\/\/127\.0\.0\.1:\d+\/$/.test(u.searchParams.get('volver') || '') ? '&volver=' + encodeURIComponent(u.searchParams.get('volver')) : ''), 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (cookieOf(req, 'kyro_sala') !== room.code) return page(res, 403, 'Hace falta la invitación', 'Entrá con el enlace o el QR que te pasó quien abrió la sala.');
    try {
      if (u.pathname.startsWith('/api/')) {
        if (!LAN_API.has(u.pathname)) return page(res, 403, 'No permitido', 'Eso solo se puede hacer en la compu que abrió la sala.');
        for (const k of ['dir', 'path', 'file']) { const v = u.searchParams.get(k); if (v != null && !inside(path.resolve(v), room.dir)) return page(res, 403, 'No permitido', 'Solo las fotos de este proyecto.'); }
      } else if (!inside(path.resolve(safe.root, decodeURIComponent(u.pathname).replace(/^\/+/, '')), safe.root)) return page(res, 403, 'No permitido', '');
    } catch { return page(res, 400, 'Dirección inválida', ''); }
    return handler(req, res);
  }

  async function start(dir, project) {
    dir = path.resolve(dir);
    if (room.code && room.dir === dir) return info();
    if (room.code) stop();
    room.code = newCode(); room.dir = dir; room.project = project || path.basename(dir);
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
    room.code = null; room.dir = null;
    try { room.server?.close(); } catch {}
    room.server?.closeAllConnections?.();
    room.server = null;
    return { on: false };
  }
  function info() {
    if (!room.code) return { on: false };
    return { on: true, code: room.code, dir: room.dir, project: room.project, port: room.port, people: room.peers.size,
      urls: lanAddresses().map(a => `http://${a}:${room.port}/sala/${room.code}`) };
  }
  function discover() { // empieza a anunciar / escuchar salas cerca (la primera vez que hace falta)
    discovery ||= startDiscovery(() => room.code ? { name: os.hostname(), project: room.project, port: room.port, code: room.code, people: room.peers.size } : null);
    return discovery;
  }
  return { start, stop, info, upgrade, peers: () => discover().list(), get dir() { return room.dir; } };
}

module.exports = { createLan, lanAddresses };
