// Kyro Neo Board · trabajar de a varios en la red local (como Kyro Zine Generator, solo la parte LAN).
// Quien abre la sala comparte su proyecto; los demás entran con el enlace o el QR (compu, celu, tablet).
// Viaja solo lo que cambió: cada foto / lienzo por su id. Si dos tocan lo mismo, gana el último.
// Lo de los demás no se deshace con tu Ctrl+Z (se copia también en tu historial).
import { AV } from './avatars.js';
import { play } from './sound.js';
import { revealNew } from './motion.js';
import { cfg, prefs, savePrefs, icon } from './mesa.js';
import { roomJoinHTML, mountRoomJoin } from './room-join.js';
import { copyText } from './clipboard.js';

export const AV_ICONS = Object.keys(AV);
export const AV_COLORS = ['#d9381a', '#f08a24', '#ffe14d', '#7cb342', '#2b6b58', '#0f9fb0', '#2f5aa8', '#5b4fd0', '#7a4fd0', '#e86aa6', '#8a5a3c', '#16130f'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ink = hex => { const n = parseInt(hex.slice(1).padEnd(6, '0').slice(0, 6), 16); return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 160 ? '#16130f' : '#fffaf0'; };
export const avSvg = (icon, px) => `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${AV[icon] || AV.smile}</svg>`;
const CROWN = '<span class="host-crown" role="img" aria-label="Anfitrión" data-tip="Anfitrión"><svg viewBox="0 0 24 20" aria-hidden="true"><path d="M2 5 7 8 12 2 17 8 22 5 19 18H5Z"/></svg></span>';
export const avHTML = (icon, color, px = 24, host = false) => `<span class="av${host ? ' av-host' : ''}" style="width:${px}px;height:${px}px;background:${esc(color)};color:${ink(color)}">${host ? CROWN : ''}${avSvg(icon, Math.round(px * 0.62))}</span>`;
const device = () => matchMedia('(pointer:coarse)').matches ? (Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet') : 'pc';
const SVG = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const X_ICON = SVG('<path d="M18 6 6 18M6 6l12 12"/>');
const QR_ICON = SVG('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>');
const SEND_ICON = SVG('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>');
const CHAT_ICON = SVG('<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>');
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
    chat: [], draft: '', chatOnly: false, unread: 0, host: !app.guestCode, awaiting: false, info: null, liveT: 0, curT: 0, selT: 0, retry: 0, open: false, pending: [] };
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
      const r = await fetch(`/api/lan/start?dir=${encodeURIComponent(app.proj)}&name=${encodeURIComponent(app.projName())}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approval: cfg().roomApproval === 'on', password: $('#cbPassword')?.value || '' }),
      });
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
    C.peers = {}; C.cursors = {}; C.sels = {}; C.queue = []; C.pending = []; C.chatOnly = false; C.draft = '';
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
      renderDock();
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
    if (!C.open && !C.chatOnly && m.from !== C.id) { C.unread++; app.toast(`${m.name}: ${m.text}`, 3500); }
    renderChat(); paintBtn();
  }
  function sendChat(text) {
    text = String(text || '').trim().slice(0, 400); if (!text || !C.on) return;
    if (C.awaiting || C.ws?.readyState !== 1) { app.toast('Esperá a que vuelva la conexión para enviar.', 2500); return false; }
    send('chat', { text });
    addChat({ from: C.id, text, ts: Date.now(), name: prof.name, icon: prof.icon, color: prof.color });
    return true;
  }
  function renderChat() {
    const log = $('#cbChat');
    if (log) {
      log.innerHTML = C.chat.length ? C.chat.map(m => `<div class="chat-msg${m.from === C.id ? ' me' : ''}">${avHTML(m.icon, m.color, 22)}<div class="chat-body"><b class="chat-who">${esc(m.name)}</b><span>${esc(m.text)}</span></div></div>`).join('')
      : '<div class="cb-hint cb-empty">Sin mensajes.</div>';
      revealNew(app.el, '#cbChat .chat-msg', (_, i) => C.chat[i]);
      log.scrollTop = log.scrollHeight;
      requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    }
    renderDock();
  }

  // Solo el campo lleva fondo: los dos mensajes flotan centrados sobre la mesa.
  const dock = document.createElement('section');
  dock.className = 'cb-chat-dock'; dock.hidden = true; dock.setAttribute('aria-label', 'Solo chat');
  dock.innerHTML = `<div class="dock-messages" role="log" aria-label="Últimos dos mensajes" aria-live="polite" aria-relevant="additions text"></div><form class="dock-compose" autocomplete="off"><button class="dock-tool" type="button" data-dock="panel" aria-label="Abrir panel En equipo" data-tip="En equipo">${icon('users')}</button><input id="cbDockMsg" aria-label="Mensaje a la sala" maxlength="400" placeholder="Mensaje"><button class="cb-send" aria-label="Enviar mensaje" data-tip="Enviar · Enter">${SEND_ICON}</button></form>`;
  document.body.append(dock);
  const dockInput = dock.querySelector('input');
  setInterval(() => { if (C.chatOnly) renderDock(); }, 250);
  function renderDock() {
    dock.hidden = !C.on || !C.chatOnly;
    if (dock.hidden) return;
    const log = dock.querySelector('.dock-messages');
    const life = cfg().chatSeconds * 1000;
    const visible = C.chat.filter(m => !life || Date.now() - m.ts < life).slice(-2);
    // Conservar los mensajes que siguen a la vista: su transparencia y su animación
    // no vuelven a empezar cada vez que llega otro o vence el anterior.
    for (const el of [...log.children]) if (!visible.includes(el._message)) el.remove();
    visible.forEach((m, i) => {
      let el = [...log.children].find(el => el._message === m);
      if (!el) {
        el = document.createElement('p'); el.className = 'dock-message'; el._message = m;
        el.innerHTML = `${avHTML(m.icon, m.color, 18)}<b style="color:${esc(m.color)}">${esc(m.name)}</b><span>${esc(m.text)}</span>`;
      }
      if (log.children[i] !== el) log.insertBefore(el, log.children[i] || null);
    });
    [...log.children].forEach((el,i)=>{el.style.opacity = life ? Math.min(.8,Math.max(0,(life-(Date.now()-visible[i].ts))/1000)) : .8;});
    revealNew(log, '.dock-message', (_, i) => visible[i]);
    if (dockInput.value !== C.draft) dockInput.value = C.draft;
    dockInput.disabled = C.awaiting || !!C.retry;
    dock.querySelector('.cb-send').disabled = C.awaiting || !!C.retry;
  }
  function chatOnly() {
    if (!C.on) return;
    C.chatOnly = true; C.unread = 0;
    setOpen(false); renderDock(); dockInput.focus();
  }
  function submitChat(input) {
    if (!sendChat(input.value)) return;
    C.draft = ''; input.value = ''; const other = input === dockInput ? $('#cbMsg') : dockInput;
    if (other) other.value = '';
    input.focus();
  }
  dock.addEventListener('submit', e => { e.preventDefault(); submitChat(dockInput); });
  dock.addEventListener('input', () => { C.draft = dockInput.value; const input = $('#cbMsg'); if (input) input.value = C.draft; });
  dock.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { C.chatOnly = false; dock.hidden = true; app.btn.focus(); } });
  dock.addEventListener('click', e => {
    const action = e.target.closest('[data-dock]')?.dataset.dock;
    if (action === 'panel') setOpen(true);
    if (action === 'close') { C.chatOnly = false; dock.hidden = true; app.btn.focus(); }
  });

  /* --- QR del enlace (sin internet), en una ventana en el medio --- */
  const qrModal = document.createElement('div');
  qrModal.className = 'cb-qr'; qrModal.innerHTML = '<div class="cb-qr-box" role="dialog" aria-label="QR de la sala"><button class="cb-x" id="cbQRClose" aria-label="Cerrar" data-tip="Cerrar · Esc">' + X_ICON + '</button><canvas id="cbQR"></canvas><b id="cbQRCode"></b><span class="cb-hint">Escaneá para entrar desde el celu o la tablet.</span></div>';
  document.body.append(qrModal);
  const showQR = open => {
    qrModal.classList.toggle('show', open);
    if (!open) return;
    drawQR();
    qrModal.querySelector('#cbQRCode').textContent = C.info?.code || '';
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
        <div class="cb-security"><label>Ingreso<select id="cbApproval"><option value="on"${cfg().roomApproval === 'on' ? ' selected' : ''}>Pedir aprobación</option><option value="off"${cfg().roomApproval === 'off' ? ' selected' : ''}>Entrada directa</option></select></label>
        <label>Contraseña (opcional)<input class="cb-input" id="cbPassword" type="password" maxlength="128" autocomplete="new-password" placeholder="Sin contraseña"></label></div>
        <button class="cb-big" id="cbOpen"${app.proj ? '' : ' disabled'}>Abrir sala</button>
        <p class="cb-hint">Para trabajar de a varios en la misma red (wifi o cable). Las fotos quedan en esta compu.</p>
        ${roomJoinHTML()}` : '');
      if (C.host) mountRoomJoin(app.el, { beforeJoin: app.beforeJoin, toast: app.toast });
    } else {
      const people = Object.entries(C.peers).sort(([a], [b]) => (C.peers[b].host - C.peers[a].host) || a.localeCompare(b));
      app.el.innerHTML = head + `
        <div class="ticket"><div class="ticket-body"><div class="ticket-main"><div class="cb-code">${esc(C.info?.code || '')}</div><div class="ticket-rule"></div><div class="ticket-project">${esc(app.projName())}</div>${C.host && C.info?.urls?.length ? `<div class="ticket-foot"><button class="ticket-qr" id="cbQRBtn" aria-label="Mostrar QR de la sala" data-tip="QR de la sala">${QR_ICON}</button></div>` : ''}</div><button class="ticket-stub" id="cbCopyCode" aria-label="Copiar código de la sala" data-tip="Copiar código">${icon('copy')}</button></div></div>
        <div class="cb-room-actions"><button class="cb-chat-mode" id="cbChatOnly">${CHAT_ICON}Solo chat</button><button class="cb-leave" id="cbLeave">${C.host ? 'Cerrar sala' : 'Salir de la sala'}</button></div>
        ${C.host ? `<p class="cb-hint">${C.info?.approval ? 'Ingreso con aprobación' : 'Entrada directa'}${C.info?.password ? ' · con contraseña' : ''}</p><div class="cb-requests" id="cbRequests" aria-live="polite"></div>` : ''}
        ${C.retry ? '<div class="cb-warn">Sin conexión. Reintentando…</div>' : ''}
        ${C.host && !C.info?.urls?.length ? '<div class="cb-warn">Sin conexión a una red.</div>' : ''}
        <div class="cb-peers">${people.map(([id, p]) => `<span class="cb-peer" data-id="${esc(id)}">${avHTML(p.icon, p.color, 24, p.host)}<span class="nm">${esc(p.name || '…')}${id === C.id ? ' (vos)' : ''}</span>${p.device !== 'pc' ? `<span class="cb-tag">${DEVICE_NAME[p.device] || ''}</span>` : ''}</span>`).join('')}</div>
        <div class="chat"><div id="cbChat"></div><form id="cbChatForm" autocomplete="off"><input class="cb-input" id="cbMsg" aria-label="Mensaje a la sala" maxlength="400" placeholder="Mensaje" value="${esc(C.draft)}"><button class="cb-send" aria-label="Enviar" data-tip="Enviar · Enter">${SEND_ICON}</button></form></div>`;
      renderChat();
      renderRequests();
      revealNew(app.el, '.cb-peer');
    }
    renderDock();
  }
  function renderRequests() {
    const box = $('#cbRequests'); if (!box) return;
    box.innerHTML = C.pending.map(r => `<div class="cb-request"><b>${esc(r.name)} quiere entrar</b><button data-request="${esc(r.id)}" data-allow="yes">Aceptar</button><button data-request="${esc(r.id)}" data-allow="no">Rechazar</button></div>`).join('');
    revealNew(app.el, '#cbRequests .cb-request', (_, i) => C.pending[i].id);
  }
  async function pollRequests() {
    if (!C.on || !C.host) return;
    try {
      const r = await fetch('/api/lan/requests'); if (!r.ok) return;
      const pending = await r.json();
      if (!C.on || !C.host) return;
      const added = pending.filter(r => !C.pending.some(old => old.id === r.id));
      const changed = JSON.stringify(pending) !== JSON.stringify(C.pending);
      C.pending = pending;
      if (added.length) { app.toast(`${added[0].name} quiere entrar a la sala.`, 4000); play('mensaje'); if (!C.open) setOpen(true); }
      if (changed) renderRequests();
    } catch {}
  }
  setInterval(pollRequests, 1500);
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
    if (open) C.chatOnly = false;
    C.open = open; app.el.classList.toggle('show', open); app.btn.classList.toggle('on', open);
    if (open) { C.unread = 0; render(); pollRequests(); }
    paintBtn();
    renderDock();
  }
  // eventos (uno solo para todo el panel y para la puerta de entrada)
  function onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'cbClose') return setOpen(false);
    if (t.id === 'cbQRBtn') return showQR(true);
    if (t.id === 'cbChatOnly') return chatOnly();
    if (t.id === 'cbCopyCode') {
      copyText(C.info?.code || '').then(() => app.toast('Código copiado.', 1500), e => app.toast(e.message, 4000));
      return;
    }
    if (t.id === 'cbAv') { const g = t.closest('.cb-box, .collab-panel').querySelector('#cbIcons'); g.hidden = !g.hidden; return; }
    if (t.dataset.c) { prof.color = t.dataset.c; saveProf(); return rerenderProfile(t); }
    if (t.dataset.i) { prof.icon = t.dataset.i; saveProf(); return rerenderProfile(t); }
    if (t.id === 'cbOpen') return openRoom();
    if (t.id === 'cbEnter') return joinAsGuest();
    if (t.id === 'cbRetry') return location.reload();
    if (t.id === 'cbHome' && app.back) return location.href = app.back;
    if (t.id === 'cbLeave') { showQR(false); return C.host ? stop() : leaveAsGuest(); }
    if (t.dataset.request && C.host) {
      t.disabled = true;
      fetch(`/api/lan/decide?id=${encodeURIComponent(t.dataset.request)}&allow=${t.dataset.allow === 'yes' ? '1' : '0'}`, { method: 'POST' })
        .then(r => r.json()).then(r => { if (r.error) app.toast(r.error, 3000); pollRequests(); })
        .catch(() => { t.disabled = false; app.toast('No se pudo responder. Intentá de nuevo.', 3000); });
      return;
    }
  }
  function rerenderProfile(t) {
    const box = t.closest('.cb-box, .collab-panel');
    box.querySelector('#cbAv').innerHTML = avHTML(prof.icon, prof.color, 44);
    box.querySelectorAll('.cb-sw').forEach(b => b.classList.toggle('on', b.dataset.c === prof.color));
    box.querySelectorAll('.cb-ic').forEach(b => b.classList.toggle('on', b.dataset.i === prof.icon));
    if (t.dataset.i) box.querySelector('#cbIcons').hidden = true;
  }
  const onInput = e => {
    if (e.target.id === 'cbName') { prof.name = e.target.value.trim().slice(0, 24); saveProf(); }
    if (e.target.id === 'cbMsg') { C.draft = e.target.value; dockInput.value = C.draft; }
  };
  const onKey = e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.id === 'cbName' && app.gate?.contains(e.target)) joinAsGuest(); };
  for (const el of [app.el, app.gate].filter(Boolean)) {
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', e => { if (e.target.id === 'cbApproval') { prefs.roomApproval = e.target.value; savePrefs(); } });
    el.addEventListener('keydown', onKey);
    el.addEventListener('submit', e => { if (e.target.id !== 'cbChatForm') return; e.preventDefault(); submitChat(el.querySelector('#cbMsg')); });
  }
  app.btn.addEventListener('click', () => setOpen(!C.open));

  /* --- la puerta para los invitados: nombre e ícono antes de entrar --- */
  function showGate(kind) {
    const g = app.gate; if (!g) return;
    g.classList.add('show');
    const box = g.querySelector('.cb-box');
    if (kind === 'closed' || kind === 'left') {
      box.innerHTML = `<h3>${kind === 'left' ? 'Saliste de la sala' : 'La sala se cerró'}</h3><button class="cb-big" id="cbRetry">Volver a entrar</button>${app.back ? '<button class="pill" id="cbHome">Volver al inicio</button>' : ''}`;
      return;
    }
    box.innerHTML = `<h3>Sala ${esc(app.guestCode)}</h3>${profileHTML()}<button class="cb-big" id="cbEnter">Entrar</button>`;
    setTimeout(() => g.querySelector('#cbName')?.focus(), 50);
  }

  if (app.guestCode) showGate('join'); else rejoinAsHost();
  render();
  return { local, draw, selChanged, get on() { return C.on; }, get guest() { return !!app.guestCode; }, debug: () => ({ cursors: C.cursors, sels: C.sels, peers: C.peers }) };
}
