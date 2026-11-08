// Kyro Neo Board · trabajar de a varios en la red local (como Kyro Zine Generator, solo la parte LAN).
// Quien abre la sala comparte su proyecto; los demás entran con el enlace o el QR (compu, celu, tablet).
// Viaja solo lo que cambió: cada foto / lienzo por su id. Si dos tocan lo mismo, gana el último.
// Lo de los demás no se deshace con tu Ctrl+Z (se copia también en tu historial).
import { AV } from './avatars.js';
import { play } from './sound.js';

export const AV_ICONS = Object.keys(AV);
export const AV_COLORS = ['#d9381a', '#f08a24', '#ffe14d', '#7cb342', '#2b6b58', '#0f9fb0', '#2f5aa8', '#5b4fd0', '#7a4fd0', '#e86aa6', '#8a5a3c', '#16130f'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ink = hex => { const n = parseInt(hex.slice(1).padEnd(6, '0').slice(0, 6), 16); return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 160 ? '#16130f' : '#fffaf0'; };
export const avSvg = (icon, px) => `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${AV[icon] || AV.smile}</svg>`;
export const avHTML = (icon, color, px = 24) => `<span class="av" style="width:${px}px;height:${px}px;background:${esc(color)};color:${ink(color)}">${avSvg(icon, Math.round(px * 0.62))}</span>`;
const device = () => matchMedia('(pointer:coarse)').matches ? (Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet') : 'pc';
const SVG = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const X_ICON = SVG('<path d="M18 6 6 18M6 6l12 12"/>');
const QR_ICON = SVG('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>');
const SEND_ICON = SVG('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>');
const DEVICE_NAME = { pc: 'compu', phone: 'celu', tablet: 'tablet' };

/* ---------- qué cambió: foto por foto, lienzo por lienzo ---------- */
const OWN = new Set(['items', 'lienzos']);
const metaOf = S => { const o = {}; for (const k of Object.keys(S)) if (!OWN.has(k)) o[k] = S[k]; return o; };
const snapOf = S => ({
  meta: JSON.stringify(metaOf(S)),
  items: new Map(S.items.map(i => [i.id, JSON.stringify(i)])), order: S.items.map(i => i.id).join(','),
  lz: new Map(S.lienzos.map(l => [l.id, JSON.stringify(l)])), lzOrder: S.lienzos.map(l => l.id).join(','),
});
function diffOf(b, S) {
  const c = snapOf(S), op = {};
  const set = [...c.items].filter(([id, j]) => b.items.get(id) !== j).map(([, j]) => JSON.parse(j));
  const del = [...b.items.keys()].filter(id => !c.items.has(id));
  const lzSet = [...c.lz].filter(([id, j]) => b.lz.get(id) !== j).map(([, j]) => JSON.parse(j));
  const lzDel = [...b.lz.keys()].filter(id => !c.lz.has(id));
  if (set.length) op.set = set; if (del.length) op.del = del;
  if (c.order !== b.order) op.order = c.order ? c.order.split(',') : [];
  if (lzSet.length) op.lzSet = lzSet; if (lzDel.length) op.lzDel = lzDel;
  if (c.lzOrder !== b.lzOrder) op.lzOrder = c.lzOrder ? c.lzOrder.split(',') : [];
  if (c.meta !== b.meta) op.meta = JSON.parse(c.meta);
  return { op: Object.keys(op).length ? op : null, snap: c };
}
// aplicar un cambio sobre un estado (el de la mesa o uno del historial), sin cambiar los objetos de lugar
function applyOp(S, op) {
  const merge = (list, incoming) => {
    for (const x of incoming) {
      const cur = list.find(y => y.id === x.id), copy = structuredClone(x);
      if (cur) { for (const k of Object.keys(cur)) if (!(k in copy)) delete cur[k]; Object.assign(cur, copy); } else list.push(copy);
    }
  };
  const drop = (list, ids) => { const d = new Set(ids); for (let i = list.length - 1; i >= 0; i--) if (d.has(list[i].id)) list.splice(i, 1); };
  const order = (list, ids) => { const pos = new Map(ids.map((id, i) => [id, i])); list.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)); };
  if (op.set) merge(S.items, op.set);
  if (op.del) drop(S.items, op.del);
  if (op.order) order(S.items, op.order);
  if (op.lzSet) merge(S.lienzos, op.lzSet);
  if (op.lzDel) drop(S.lienzos, op.lzDel);
  if (op.lzOrder) order(S.lienzos, op.lzOrder);
  if (op.meta) { for (const k of Object.keys(S)) if (!OWN.has(k) && !(k in op.meta)) delete S[k]; Object.assign(S, structuredClone(op.meta)); }
}

/* ---------- la sala ---------- */
export function createCollab(app) {
  // app: { el, btn, getS, replaceS(s), afterRemote(op), hist, mesa, proj, projName(), toast, guestCode, back }
  const $ = s => app.el.querySelector(s);
  const C = { on: false, ws: null, id: '', peers: {}, cursors: {}, sels: {}, base: null, commitBase: null, queue: [], busy: false,
    chat: [], unread: 0, host: !app.guestCode, awaiting: false, info: null, liveT: 0, curT: 0, selT: 0, retry: 0, open: false, near: [] };
  C.id = (crypto.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2)).slice(0, 36);
  // perfil: nombre, ícono y color (se recuerdan)
  const prof = (() => {
    let p = null; try { p = JSON.parse(localStorage.getItem('kyro-neo-perfil') || 'null'); } catch {}
    return { name: p?.name || '', icon: AV_ICONS.includes(p?.icon) ? p.icon : AV_ICONS[Math.floor(Math.random() * AV_ICONS.length)],
      color: AV_COLORS.includes(p?.color) ? p.color : AV_COLORS[Math.floor(Math.random() * AV_COLORS.length)] };
  })();
  const saveProf = () => { try { localStorage.setItem('kyro-neo-perfil', JSON.stringify(prof)); } catch {} if (C.on) track(); };
  const meta = () => ({ name: prof.name, icon: prof.icon, color: prof.color, device: device() });

  /* --- conexión --- */
  const raw = obj => { if (C.ws?.readyState === 1) C.ws.send(JSON.stringify(obj)); };
  const send = (k, data = {}, to) => raw({ t: 'bc', to: to || undefined, payload: { k, ...data } });
  const track = () => raw({ t: 'track', meta: meta() });
  function connect() {
    return new Promise((ok, ko) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?id=${encodeURIComponent(C.id)}`);
      const to = setTimeout(() => { try { ws.close(); } catch {} ko(new Error('timeout')); }, 8000);
      ws.onopen = () => { clearTimeout(to); C.ws = ws; ok(); };
      ws.onerror = () => { clearTimeout(to); ko(new Error('ws')); };
      ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.t === 'presence') onPresence(m.peers || {}); else if (m.t === 'bc') onMsg(m.payload || {}, m.from); };
      ws.onclose = ev => { if (C.ws === ws) onClosed(ev.code); };
    });
  }
  function onClosed(code) {
    C.ws = null;
    if (!C.on) return;
    if (code === 4000 || !C.host && C.retry > 30) { // la sala se cerró
      stop(true); play('cerrada');
      if (!C.host) return showGate('closed');
      return app.toast('La sala se cerró.', 3000);
    }
    // se cortó (wifi, recarga): reintentar
    C.retry++; render();
    setTimeout(async () => {
      if (!C.on || C.ws) return;
      try { await connect(); C.retry = 0; track(); if (!C.host) hello(); render(); } catch { onClosed(1006); }
    }, 2000);
  }

  /* --- abrir / entrar / salir --- */
  async function openRoom() {
    if (!prof.name.trim()) { app.toast('Falta tu nombre.', 2000); $('#cbName')?.focus(); return; }
    try {
      const r = await fetch(`/api/lan/start?dir=${encodeURIComponent(app.proj)}&name=${encodeURIComponent(app.projName())}`, { method: 'POST' });
      C.info = await r.json(); if (!r.ok) throw new Error(C.info.error);
      await connect();
    } catch (e) { app.toast('No se pudo abrir la sala: ' + e.message, 5000); return; }
    C.on = true; C.host = true; C.base = C.commitBase = snapOf(app.getS()); track();
    render(); drawQR();
    app.toast(`Sala ${C.info.code} abierta.`, 2500); play('sala');
  }
  async function rejoinAsHost() { // la mesa se recargó con la sala abierta: volver a entrar solo
    try { const i = await (await fetch('/api/lan/info')).json(); if (!i.on || norm(i.dir) !== norm(app.proj)) return; C.info = i; await connect(); } catch { return; }
    C.on = true; C.host = true; C.base = C.commitBase = snapOf(app.getS()); track(); render();
  }
  const norm = p => String(p || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
  async function joinAsGuest() {
    if (!prof.name.trim()) { app.toast('Falta tu nombre.', 2000); app.gate.querySelector('#cbName')?.focus(); return; }
    saveProf();
    try { await connect(); } catch { return showGate('closed'); }
    C.on = true; C.host = false; C.info = { code: app.guestCode };
    track(); hello();
    app.gate.classList.remove('show'); render();
  }
  function hello() { // pedirle la mesa a quien abrió la sala
    C.awaiting = true; send('hello');
    clearTimeout(C.helloT);
    C.helloT = setTimeout(() => { if (C.awaiting && C.on) { app.toast('Esperando a quien abrió la sala…', 2500); hello(); } }, 4000);
  }
  async function stop(silent) {
    clearTimeout(C.liveT); clearTimeout(C.helloT); C.liveT = 0;
    const was = C.on; C.on = false; C.awaiting = false;
    try { C.ws?.close(); } catch {} C.ws = null;
    C.peers = {}; C.cursors = {}; C.sels = {}; C.queue = [];
    if (C.host && was && !silent) { await fetch('/api/lan/stop', { method: 'POST' }).catch(() => {}); app.toast('Sala cerrada.', 1500); play('cerrada'); }
    app.mesa.invalidate(); render();
  }
  function leaveAsGuest() {
    stop(true);
    if (app.back) location.href = app.back; else showGate('left');
  }

  /* --- lo que llega --- */
  function onPresence(peers) {
    const before = C.peers;
    let joined = 0, left = 0;
    for (const [id, p] of Object.entries(peers)) if (!before[id] && id !== C.id && p.name && Object.keys(before).length) { app.toast(`${p.name} entró.`, 2000); joined++; }
    for (const [id, p] of Object.entries(before)) if (!peers[id] && id !== C.id && p.name) { app.toast(`${p.name} salió.`, 2000); left++; }
    if (joined) play('entra'); else if (left) play('sale');
    C.peers = peers;
    for (const id of Object.keys(C.cursors)) if (!peers[id]) { delete C.cursors[id]; delete C.sels[id]; }
    app.mesa.invalidate(); render();
  }
  function onMsg(p, from) {
    if (p.k === 'cur') { C.cursors[from] = { x: +p.x, y: +p.y, t: Date.now() }; return app.mesa.invalidate(); }
    if (p.k === 'sel') { C.sels[from] = Array.isArray(p.ids) ? p.ids.slice(0, 2000) : []; return app.mesa.invalidate(); }
    if (p.k === 'chat') return addChat({ from, text: String(p.text || '').slice(0, 400), ts: Date.now(), ...whoIs(from) });
    if (p.k === 'hello') { // alguien nuevo: quien abrió la sala le manda la mesa entera
      if (!C.host) return;
      flush(true);
      return send('snap', { state: app.getS(), chat: C.chat.slice(-60) }, from);
    }
    if (p.k === 'snap') {
      if (!C.awaiting) return;
      C.awaiting = false; clearTimeout(C.helloT);
      app.replaceS(p.state);
      C.base = C.commitBase = snapOf(app.getS());
      if (Array.isArray(p.chat) && !C.chat.length) { C.chat = p.chat; renderChat(); }
      play('sala');
      return app.toast(`Entraste a la sala de ${hostName() || 'la mesa'}.`, 2500);
    }
    if (p.k === 'op' && p.op) return remoteOp(p.op, !!p.c);
  }
  const whoIs = id => { const q = C.peers[id] || {}; return { name: q.name || '?', icon: q.icon || 'smile', color: q.color || '#888888' }; };
  const hostName = () => Object.values(C.peers).find(p => p.host)?.name;

  function remoteOp(op, committed) {
    if (C.awaiting) return;
    if (C.busy) { C.queue.push(() => remoteOp(op, committed)); return; } // nunca en medio de mi arrastre
    flush(false); // lo mío que todavía no salió, primero
    const S = app.getS();
    applyOp(S, op);
    if (committed) { // también en mi historial: mi Ctrl+Z no deshace lo de los demás
      const h = app.hist, fix = s => { try { const o = JSON.parse(s); applyOp(o, op); return JSON.stringify(o); } catch { return s; } };
      h.undos = h.undos.map(fix); h.redos = h.redos.map(fix); if (typeof h.pending === 'string') h.pending = fix(h.pending);
    }
    C.base = snapOf(S); if (committed) C.commitBase = C.base;
    app.afterRemote(op, committed);
  }

  /* --- lo que cambio yo --- */
  // committed: cambio terminado (Ctrl+Z lo puede deshacer). Si no, va "en vivo" mientras arrastro.
  function local(committed) {
    if (!C.on || C.awaiting) return;
    if (committed) { clearTimeout(C.liveT); C.liveT = 0; return flush(true); }
    if (!C.liveT) C.liveT = setTimeout(() => { C.liveT = 0; flush(false); }, 70);
  }
  function flush(committed) {
    if (!C.on || C.awaiting || !C.base) return;
    const S = app.getS();
    if (committed) {
      const { op, snap } = diffOf(C.commitBase, S);
      C.base = C.commitBase = snap;
      if (op) send('op', { op, c: 1 });
    } else {
      const { op, snap } = diffOf(C.base, S);
      C.base = snap;
      if (op) send('op', { op, c: 0 });
    }
  }
  setInterval(() => { if (C.on && !C.busy && !C.awaiting) flush(true); }, 1500); // por si algo cambió sin pasar por el historial
  // mientras aprieto el mouse / el dedo, lo que llega espera
  document.addEventListener('pointerdown', e => { if (e.target === app.mesa.c) C.busy = true; }, true);
  const free = () => { if (!C.busy) return; C.busy = false; setTimeout(() => { if (C.busy) return; const q = C.queue; C.queue = []; q.forEach(f => f()); }, 30); };
  document.addEventListener('pointerup', free, true); document.addEventListener('pointercancel', free, true);
  // mi cursor y mi selección
  app.mesa.c.addEventListener('pointermove', () => {
    if (!C.on || C.awaiting) return;
    const t = performance.now(); if (t - C.curT < 60) return; C.curT = t;
    send('cur', { x: Math.round(app.mesa.mouse.x * 10) / 10, y: Math.round(app.mesa.mouse.y * 10) / 10 });
  });
  function selChanged() {
    if (!C.on) return;
    clearTimeout(C.selT);
    C.selT = setTimeout(() => send('sel', { ids: [...app.mesa.selection].map(r => r.id).filter(Boolean) }), 80);
  }

  /* --- dibujar a los demás arriba de la mesa: su selección y su cursor --- */
  function draw(ctx, z, list) {
    if (!C.on) return;
    const now = Date.now();
    for (const [id, ids] of Object.entries(C.sels)) {
      const p = C.peers[id]; if (!p || !ids.length) continue;
      const want = new Set(ids);
      ctx.save(); ctx.strokeStyle = p.color; ctx.lineWidth = 3 / z; ctx.setLineDash([8 / z, 5 / z]);
      for (const q of list) {
        if (!want.has(q.ref.id) || q.hidden) continue;
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.ang || 0);
        const pad = 4 / z; ctx.strokeRect(-q.w / 2 - pad, -q.h / 2 - pad, q.w + pad * 2, q.h + pad * 2); ctx.restore();
      }
      ctx.restore();
    }
    for (const [id, c] of Object.entries(C.cursors)) {
      const p = C.peers[id]; if (!p || now - c.t > 8000) continue;
      const s = 1 / z;
      ctx.save(); ctx.translate(c.x, c.y);
      ctx.fillStyle = p.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6 * s; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 18 * s); ctx.lineTo(5 * s, 13.5 * s); ctx.lineTo(11 * s, 13.5 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.font = `800 ${12 * s}px Archivo, "Segoe UI", Arial, sans-serif`;
      const label = p.name + (p.device && p.device !== 'pc' ? ` · ${DEVICE_NAME[p.device]}` : ''), tw = ctx.measureText(label).width, h = 20 * s;
      ctx.beginPath(); ctx.roundRect(12 * s, 14 * s, tw + 16 * s, h, h / 2); ctx.fill();
      ctx.fillStyle = ink(p.color); ctx.textBaseline = 'middle'; ctx.fillText(label, 20 * s, 14 * s + h / 2 + 0.5 * s);
      ctx.restore();
    }
    if (Object.keys(C.cursors).length) setTimeout(() => app.mesa.invalidate(), 1000); // para que se borren los quietos
  }

  /* --- mensajes (chat) --- */
  function addChat(m) {
    C.chat.push(m); if (C.chat.length > 200) C.chat.shift();
    if (m.from !== C.id) play('mensaje');
    if (!C.open && m.from !== C.id) { C.unread++; app.toast(`${m.name}: ${m.text}`, 3500); }
    renderChat(); paintBtn();
  }
  function sendChat(text) {
    text = String(text || '').trim().slice(0, 400); if (!text || !C.on) return;
    send('chat', { text });
    addChat({ from: C.id, text, ts: Date.now(), name: prof.name, icon: prof.icon, color: prof.color });
  }
  function renderChat() {
    const log = $('#cbChat'); if (!log) return;
    log.innerHTML = C.chat.length ? C.chat.map(m => `<div class="chat-msg${m.from === C.id ? ' me' : ''}">${avHTML(m.icon, m.color, 22)}<div class="chat-body"><b class="chat-who">${esc(m.name)}</b><span>${esc(m.text)}</span></div></div>`).join('')
      : '<div class="cb-hint cb-empty">Sin mensajes.</div>';
    log.scrollTop = log.scrollHeight;
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; }); // después de que se acomode el panel
  }

  /* --- QR del enlace (sin internet), en una ventana en el medio --- */
  const qrModal = document.createElement('div');
  qrModal.className = 'cb-qr'; qrModal.innerHTML = '<div class="cb-qr-box" role="dialog" aria-label="QR de la sala"><button class="cb-x" id="cbQRClose" aria-label="Cerrar" data-tip="Cerrar · Esc">' + X_ICON + '</button><canvas id="cbQR"></canvas><b id="cbQRCode"></b><span id="cbQRUrl"></span></div>';
  document.body.append(qrModal);
  const showQR = open => {
    qrModal.classList.toggle('show', open);
    if (!open) return;
    drawQR();
    qrModal.querySelector('#cbQRCode').textContent = C.info?.code || '';
    qrModal.querySelector('#cbQRUrl').textContent = (C.info?.urls?.[0] || '').replace(/^https?:\/\//, '');
  };
  qrModal.addEventListener('click', e => { if (e.target === qrModal || e.target.closest('#cbQRClose')) showQR(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && qrModal.classList.contains('show')) { showQR(false); e.stopImmediatePropagation(); } }, true);
  function drawQR() {
    const cv = document.getElementById('cbQR'), url = C.info?.urls?.[0]; if (!cv || !url || !window.qrcode) return;
    const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
    const n = qr.getModuleCount(), quiet = 2, px = Math.max(4, Math.floor(300 / (n + quiet * 2)));
    cv.width = cv.height = (n + quiet * 2) * px;
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.fillStyle = '#16130f';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cx.fillRect((c + quiet) * px, (r + quiet) * px, px, px);
  }

  /* --- panel --- */
  const profileHTML = () => `
    <label class="cb-field"><span class="cb-label">Tu nombre</span><input class="cb-input" id="cbName" maxlength="24" placeholder="Nombre" autocomplete="off" value="${esc(prof.name)}"></label>
    <div class="cb-profile"><button class="cb-av" id="cbAv" aria-label="Elegir ícono" data-tip="Ícono">${avHTML(prof.icon, prof.color, 44)}</button>
      <div class="cb-colors">${AV_COLORS.map(c => `<button class="cb-sw${c === prof.color ? ' on' : ''}" data-c="${c}" style="background:${c}" aria-label="Color"></button>`).join('')}</div></div>
    <div class="cb-icons" id="cbIcons" hidden>${AV_ICONS.map(i => `<button class="cb-ic${i === prof.icon ? ' on' : ''}" data-i="${i}" aria-label="${i}">${avSvg(i, 20)}</button>`).join('')}</div>`;
  function render() {
    paintBtn();
    if (!app.el) return;
    const head = `<div class="cb-head"><div><b>En equipo</b><span class="cb-chip">red local</span></div><button class="cb-x" id="cbClose" aria-label="Cerrar panel" data-tip="Cerrar · Esc">${X_ICON}</button></div>`;
    if (!C.on) {
      app.el.innerHTML = head + profileHTML() + (C.host ? `
        <button class="cb-big" id="cbOpen"${app.proj ? '' : ' disabled'}>Abrir sala</button>
        <p class="cb-hint">Para trabajar de a varios en la misma red (wifi o cable). Las fotos quedan en esta compu.</p>
        <div class="cb-near"><div class="cb-label">Salas cerca</div><div id="cbNear">${nearHTML()}</div></div>` : '');
    } else {
      const people = Object.entries(C.peers).sort(([a], [b]) => (C.peers[b].host - C.peers[a].host) || a.localeCompare(b));
      app.el.innerHTML = head + `
        <div class="ticket"><div class="ticket-body"><div class="ticket-main"><div class="cb-code">${esc(C.info?.code || '')}</div><div class="ticket-rule"></div><div class="ticket-project">${esc(app.projName())}</div></div><div class="ticket-stub"></div></div></div>
        <button class="cb-leave" id="cbLeave">${C.host ? 'Cerrar sala' : 'Salir de la sala'}</button>
        ${C.retry ? '<div class="cb-warn">Sin conexión. Reintentando…</div>' : ''}
        ${C.host && C.info?.urls?.length ? `<div class="cb-share"><button class="cb-url" data-url="${esc(C.info.urls[0])}" data-tip="Copiar enlace">${esc(C.info.urls[0].replace(/^https?:\/\//, ''))}</button><button class="cb-round" id="cbQRBtn" aria-label="QR" data-tip="QR">${QR_ICON}</button></div>`
          : C.host ? '<div class="cb-warn">Sin conexión a una red.</div>' : ''}
        <div class="cb-peers">${people.map(([id, p]) => `<span class="cb-peer">${avHTML(p.icon, p.color, 24)}<span class="nm">${esc(p.name || '…')}${id === C.id ? ' (vos)' : ''}</span>${p.host ? '<span class="cb-tag">anfitrión</span>' : p.device !== 'pc' ? `<span class="cb-tag">${DEVICE_NAME[p.device]}</span>` : ''}</span>`).join('')}</div>
        <div class="chat"><div id="cbChat"></div><form id="cbChatForm" autocomplete="off"><input class="cb-input" id="cbMsg" maxlength="400" placeholder="Mensaje"><button class="cb-send" aria-label="Enviar" data-tip="Enviar · Enter">${SEND_ICON}</button></form></div>`;
      renderChat();
    }
  }
  const nearHTML = () => C.near.length ? C.near.map(n => `<div class="cb-room"><div><b>${esc(n.project || 'Mesa')}</b><small>${esc(n.name)} · ${n.people} ${n.people === 1 ? 'persona' : 'personas'}</small></div><button class="cb-go" data-url="${esc(n.url)}">Entrar</button></div>`).join('')
    : '<span class="cb-hint">Ninguna sala abierta.</span>';
  async function pollNear() {
    if (!C.open || C.on || !C.host) return;
    try { C.near = await (await fetch('/api/lan/peers')).json(); } catch { C.near = []; }
    const box = $('#cbNear'); if (box) box.innerHTML = nearHTML();
  }
  setInterval(pollNear, 3000);
  // la dirección de esta compu puede cambiar (se reconectó el wifi): enlace y QR al día
  setInterval(async () => {
    if (!C.on || !C.host) return;
    try {
      const i = await (await fetch('/api/lan/info')).json();
      if (!i.on) return;
      const changed = JSON.stringify(i.urls) !== JSON.stringify(C.info?.urls);
      C.info = i;
      if (changed && C.open) render();
    } catch {}
  }, 2000);
  function paintBtn() {
    app.el?.classList.toggle('live', C.on);
    app.btn.classList.toggle('live', C.on);
    app.btn.classList.toggle('unread', C.unread > 0);
  }
  function setOpen(open) {
    C.open = open; app.el.classList.toggle('show', open); app.btn.classList.toggle('on', open);
    if (open) { C.unread = 0; render(); pollNear(); }
    paintBtn();
  }
  // eventos (uno solo para todo el panel y para la puerta de entrada)
  function onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'cbClose') return setOpen(false);
    if (t.id === 'cbQRBtn') return showQR(true);
    if (t.id === 'cbAv') { const g = t.closest('.cb-box, .collab-panel').querySelector('#cbIcons'); g.hidden = !g.hidden; return; }
    if (t.dataset.c) { prof.color = t.dataset.c; saveProf(); return rerenderProfile(t); }
    if (t.dataset.i) { prof.icon = t.dataset.i; saveProf(); return rerenderProfile(t); }
    if (t.id === 'cbOpen') return openRoom();
    if (t.id === 'cbEnter') return joinAsGuest();
    if (t.id === 'cbRetry') return location.reload();
    if (t.id === 'cbLeave') { showQR(false); return C.host ? stop() : leaveAsGuest(); }
    if (t.classList.contains('cb-url')) { navigator.clipboard.writeText(t.dataset.url).then(() => app.toast('Enlace copiado.', 1500), () => window.prompt('Copiá este enlace', t.dataset.url)); return; }
    if (t.classList.contains('cb-go')) { // entrar a la sala de otra compu (sale de esta mesa: queda guardada)
      const back = location.origin + '/';
      location.href = t.dataset.url + '?volver=' + encodeURIComponent(back);
    }
  }
  function rerenderProfile(t) {
    const box = t.closest('.cb-box, .collab-panel');
    box.querySelector('#cbAv').innerHTML = avHTML(prof.icon, prof.color, 44);
    box.querySelectorAll('.cb-sw').forEach(b => b.classList.toggle('on', b.dataset.c === prof.color));
    box.querySelectorAll('.cb-ic').forEach(b => b.classList.toggle('on', b.dataset.i === prof.icon));
    if (t.dataset.i) box.querySelector('#cbIcons').hidden = true;
  }
  const onInput = e => { if (e.target.id === 'cbName') { prof.name = e.target.value.trim().slice(0, 24); saveProf(); } };
  const onKey = e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.id === 'cbName' && app.gate?.contains(e.target)) joinAsGuest(); };
  for (const el of [app.el, app.gate].filter(Boolean)) {
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKey);
    el.addEventListener('submit', e => { e.preventDefault(); const i = el.querySelector('#cbMsg'); sendChat(i.value); i.value = ''; i.focus(); });
  }
  app.btn.addEventListener('click', () => setOpen(!C.open));

  /* --- la puerta para los invitados: nombre e ícono antes de entrar --- */
  function showGate(kind) {
    const g = app.gate; if (!g) return;
    g.classList.add('show');
    const box = g.querySelector('.cb-box');
    if (kind === 'closed' || kind === 'left') {
      box.innerHTML = `<h3>${kind === 'left' ? 'Saliste de la sala' : 'La sala se cerró'}</h3><button class="cb-big" id="cbRetry">Volver a entrar</button>`;
      return;
    }
    box.innerHTML = `<h3>Sala ${esc(app.guestCode)}</h3>${profileHTML()}<button class="cb-big" id="cbEnter">Entrar</button>`;
    setTimeout(() => g.querySelector('#cbName')?.focus(), 50);
  }

  if (app.guestCode) showGate('join'); else rejoinAsHost();
  render();
  return { local, draw, selChanged, get on() { return C.on; }, get guest() { return !!app.guestCode; }, debug: () => ({ cursors: C.cursors, sels: C.sels, peers: C.peers }) };
}
