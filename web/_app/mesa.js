// Motor compartido de las mesas: mat de corte con zoom, piezas con marco blanco,
// deshacer/rehacer persistente, lienzo de 1 x 1 m, armado de hojas A3 y
// exportación a JPG 300 dpi + PDF. Todas las medidas del mundo están en mm.

export const A = { A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148], A7: [74, 105] };
export const SIZES = ['A6', 'A5', 'A4'];
const RANK = { A3: -1, A4: 0, A5: 1, A6: 2, A7: 3 };
export const SHEETS = {
  A3: { w: 297, h: 420, px: [3508, 4961], pt: [841.89, 1190.55] },
  A4: { w: 210, h: 297, px: [2480, 3508], pt: [595.28, 841.89] },
};
export const SHEET = SHEETS.A3;
const UP = { A4: 'A3', A5: 'A4', A6: 'A5', A7: 'A6' }; // en hoja A4, el lugar que ocuparía en A3
export const LIENZO = 1000; // 1 m x 1 m
const LABEL_MM = 2.3; // ~6.5 pt: el número chiquito en la esquina
const MAT = { day: '#2b6b58', night: '#16130f', dots: '#b3aea4', dot: '#7e786d' };

// ---------- API del servidor local ----------
export const fileUrl = (...parts) => '/' + parts.join('/').split('/').map(encodeURIComponent).join('/');
export async function listDir(dir) {
  return (await fetch('/api/list?dir=' + encodeURIComponent(dir))).json();
}
export async function loadState(file) {
  try { return await (await fetch('/api/state?file=' + encodeURIComponent(file))).json(); } catch { return null; }
}
let saveSeq = 0;
export function saveState(file, obj) { // con número de orden (ver /api/state en el servidor)
  const seq = Date.now() * 1000 + (++saveSeq % 1000);
  return fetch('/api/state?file=' + encodeURIComponent(file) + '&seq=' + seq, { method: 'POST', body: JSON.stringify(obj) });
}
export async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}
// Versión liviana para ver en pantalla (la original se vuelve a leer al exportar).
// El servidor ya la manda achicada (y convertida si es TIFF, HEIC o RAW); w/h = la resolución que se va a exportar.
export async function loadPreview(url, maxPx = 2000) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('no se pudo leer la foto');
  let bmp = await createImageBitmap(await r.blob());
  const W = +r.headers.get('X-Img-W') || bmp.width, H = +r.headers.get('X-Img-H') || bmp.height;
  const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  if (k < 1) { const big = bmp; bmp = await createImageBitmap(big, { resizeWidth: Math.round(big.width * k), resizeHeight: Math.round(big.height * k), resizeQuality: 'high' }); big.close(); }
  return { bmp, meta: { w: W, h: H, ow: +r.headers.get('X-Orig-W') || W, oh: +r.headers.get('X-Orig-H') || H } };
}
// Configuración (Configuración ⚙): vista previa, tope al exportar, pasos de Ctrl+Z, trackpad
export const PREVIEW_PX = { liviana: 1200, normal: 2000, alta: 3000 };
export const cfg = () => ({ preview: prefs.preview || 'normal', cap: prefs.capMP || 40, steps: prefs.undoSteps || 40, pointer: prefs.pointer || 'auto', tips: prefs.tips || 'on', sound: prefs.sound || 'on' });

// ---------- Preferencias de vista (compartidas por las dos mesas) ----------
const PREFS_KEY = 'ojo-mdp-prefs';
export const prefs = (() => {
  let p = { night: false, limit: true };
  try { p = { ...p, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { /* sin storage */ }
  return p;
})();
// modo del mat: 'day' (verde) · 'night' (negro) · 'dots' (gris con puntitos)
export const matMode = () => prefs.matMode || (prefs.night ? 'night' : 'day');
export const MAT_MODES = ['day', 'night', 'dots'];
export const MAT_NAME = { day: 'verde', night: 'negro', dots: 'gris con puntitos' };
export const MAT_ICON = { day: 'sun', night: 'moon', dots: 'dots' };
export function cycleMat() { const i = MAT_MODES.indexOf(matMode()); prefs.matMode = MAT_MODES[(i + 1) % 3]; prefs.night = prefs.matMode === 'night'; savePrefs(); return prefs.matMode; }
function matClasses() { const m = matMode(); document.documentElement.classList.toggle('night', m === 'night'); document.documentElement.classList.toggle('dots', m === 'dots'); }
export function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* sin storage */ }
  matClasses();
}
matClasses();
// Sin el menú del navegador (Chrome, Edge…) en el clic derecho: la mesa tiene el suyo.
// En Windows ese menú sale al SOLTAR el botón, cuando el nuestro ya apareció debajo del mouse,
// por eso se bloquea en toda la página y no solo en el mat. Donde se escribe, se deja.
document.addEventListener('contextmenu', e => {
  const t = e.target;
  if (t.closest?.('input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
});

// ---------- Explorador de Windows (lo abre el servidor local) ----------
// kind: 'folder' (elegir carpeta) · 'save' (guardar .neo) · 'open' (abrir .neo). Devuelve la ruta o null si se cancela.
// Respuesta del servidor como JSON; si el servidor es una versión vieja (no conoce el pedido), lo dice claro.
const OLD_SERVER = 'el servidor quedó en una versión vieja: abrí el .bat de nuevo (se reinicia solo)';
async function apiJson(r) {
  let j = null;
  try { j = await r.json(); } catch { /* no era JSON */ }
  if (!j) throw new Error(r.status === 404 ? OLD_SERVER : 'respuesta inesperada del servidor');
  if (!r.ok) throw new Error(j.error || 'error del servidor');
  return j;
}
export const SERVER_V = 2;
export async function serverIsCurrent() {
  try { const r = await fetch('/api/version'); return r.ok && (await r.json()).v >= SERVER_V; } catch { return false; }
}
export const SERVER_OLD_MSG = 'Servidor desactualizado: cerrá esta pestaña y abrí el .bat de nuevo (se reinicia solo). Hasta entonces, guardar, exportar y el explorador no van a andar.';
export async function winDialog(kind, extra = {}) {
  const r = await fetch('/api/dialog?' + new URLSearchParams({ kind, ...extra }), { method: 'POST' });
  return (await apiJson(r)).path || null;
}
export const revealFolder = p => fetch('/api/reveal?path=' + encodeURIComponent(p), { method: 'POST' });

// ---------- Deshacer / rehacer (se guarda en disco) ----------
export class History {
  constructor(get, set, onChange, max = 150) { Object.assign(this, { get, set, onChange, max, undos: [], redos: [], pending: null }); }
  begin() { this.pending = this.get(); }
  commit() {
    if (this.pending == null) return;
    const now = this.get();
    if (now !== this.pending) { this.undos.push(this.pending); this.redos = []; if (this.undos.length > this.max) this.undos.shift(); this.onChange(); }
    this.pending = null;
  }
  cancel() { this.pending = null; }
  run(fn) { this.begin(); fn(); this.commit(); }
  undo() { if (!this.undos.length) return; this.redos.push(this.get()); this.set(this.undos.pop()); this.onChange(); }
  redo() { if (!this.redos.length) return; this.undos.push(this.get()); this.set(this.redos.pop()); this.onChange(); }
  dump() { return { undos: this.undos, redos: this.redos }; }
  restore(d) { if (d && Array.isArray(d.undos)) { this.undos = d.undos.slice(-this.max); this.redos = (d.redos || []).slice(-this.max); } }
  setMax(n) { this.max = n; this.undos = this.undos.slice(-n); this.redos = this.redos.slice(-n); this.onChange(); }
}

// ---------- Lienzo ----------
// Mitades del rectángulo que ocupa una pieza girada.
export function extent(w, h, ang = 0) {
  const c = Math.abs(Math.cos(ang)), s = Math.abs(Math.sin(ang));
  return [(w * c + h * s) / 2, (w * s + h * c) / 2];
}
export function clampXY(x, y, w, h, ang, b) {
  const [hw, hh] = extent(w, h, ang);
  const cl = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
  return [cl(x, b.x0 + hw, b.x1 - hw), cl(y, b.y0 + hh, b.y1 - hh)];
}
export function isOutside(p, b) {
  const [hw, hh] = extent(p.w, p.h, p.ang);
  return p.x - hw < b.x0 - 0.5 || p.x + hw > b.x1 + 0.5 || p.y - hh < b.y0 - 0.5 || p.y + hh > b.y1 + 0.5;
}

// ---------- Pieza ----------
// p = { x, y, ang, w, h, f, label, key, size, draw(ctx, imgs), ref }
// ctx en mm, origen en el centro de la pieza, pieza derecha.
export function drawPiece(ctx, p, imgs) {
  const { w, h, f } = p;
  ctx.fillStyle = '#fff';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w / 2 + f, -h / 2 + f, w - 2 * f, h - 2 * f);
  ctx.clip();
  p.draw(ctx, imgs);
  ctx.restore();
  if (p.label) {
    ctx.fillStyle = '#8c8c8c';
    ctx.font = `600 ${LABEL_MM}px Archivo, "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.label, w / 2 - f, h / 2 - Math.max(f, LABEL_MM * 1.6) / 2);
  }
}

// ---------- Hojas A3 ----------
// La A3 vertical se divide en 2 columnas x 4 filas de A6 (148,5 x 105).
// A5 = dos A6 apiladas, A4 = la mitad de la hoja.
// La A3 vertical se divide en 4 columnas x 4 filas de A7 (74,25 x 105 mm), índice = fila*4 + columna.
// A6 = 2 A7 lado a lado · A5 = 2 A6 apiladas · A4 = media hoja · A3 = la hoja entera.
// Siempre se llenan primero los huecos ya empezados, para gastar menos hojas.
function alloc(g, size) {
  const cw = 74.25, rh = 105;
  const free = c => c.every(k => !g[k]);
  const take = c => c.forEach(k => { g[k] = true; });
  const used = c => c.some(k => g[k]);
  const pick = (cands, rect) => { // de los lugares libres, el que está al lado de algo ya ocupado
    const ok = cands.filter(c => free(c.cells));
    if (!ok.length) return null;
    const best = ok.find(c => c.near && used(c.near)) || ok[0];
    take(best.cells); return rect(best);
  };
  if (size === 'A3') return pick([{ cells: [...Array(16).keys()] }], () => ({ x: 0, y: 0, w: 297, h: 420 }));
  if (size === 'A4') return pick([0, 2].map(r0 => ({ r0, cells: [...Array(8).keys()].map(i => r0 * 4 + i) })), c => ({ x: 0, y: c.r0 * rh, w: 297, h: 210 }));
  const A5 = [], A6 = [], A7 = [];
  for (const r0 of [0, 2]) for (const c0 of [0, 2]) {
    const cells = [r0 * 4 + c0, r0 * 4 + c0 + 1, (r0 + 1) * 4 + c0, (r0 + 1) * 4 + c0 + 1];
    A5.push({ r0, c0, cells, near: [...Array(8).keys()].map(i => r0 * 4 + i).filter(k => !cells.includes(k)) });
  }
  for (let r = 0; r < 4; r++) for (const c0 of [0, 2]) A6.push({ r, c0, cells: [r * 4 + c0, r * 4 + c0 + 1], near: [(r ^ 1) * 4 + c0, (r ^ 1) * 4 + c0 + 1] });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) A7.push({ r, c, cells: [r * 4 + c], near: [r * 4 + (c ^ 1)] });
  if (size === 'A5') return pick(A5, c => ({ x: c.c0 * cw, y: c.r0 * rh, w: cw * 2, h: rh * 2 }));
  if (size === 'A6') return pick(A6, c => ({ x: c.c0 * cw, y: c.r * rh, w: cw * 2, h: rh }));
  return pick(A7, c => ({ x: c.c * cw, y: c.r * rh, w: cw, h: rh }));
}
// fmt: 'A3' (por defecto) o 'A4'. En A4 las fotos A3 no entran: quedan en sheets.skipped.
export function packSheets(pieces, fmt = 'A3') {
  const sizeOf = fmt === 'A4' ? p => UP[p.size] : p => p.size;
  const ok = pieces.filter(p => sizeOf(p));
  const list = ok.map((p, i) => ({ p, i })).sort((a, b) => RANK[sizeOf(a.p)] - RANK[sizeOf(b.p)] || a.i - b.i);
  const sheets = [];
  for (const { p } of list) {
    let s = sheets.find(s => { const r = alloc(s.grid, sizeOf(p)); if (r) s.items.push({ p, rect: r }); return r; });
    if (!s) { s = { grid: Array(16).fill(false), items: [] }; sheets.push(s); s.items.push({ p, rect: alloc(s.grid, sizeOf(p)) }); }
  }
  const k = SHEETS[fmt].w / SHEETS.A3.w; // A4: todo achicado ×1/√2
  for (const s of sheets) {
    s.fmt = fmt;
    if (k !== 1) for (const it of s.items) it.rect = { x: it.rect.x * k, y: it.rect.y * k, w: it.rect.w * k, h: it.rect.h * k };
  }
  sheets.skipped = pieces.filter(p => !sizeOf(p));
  return sheets;
}
export function renderSheet(ctx, sheet, s, imgs) {
  const SHEET = SHEETS[sheet.fmt || 'A3'];
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SHEET.w, SHEET.h);
  for (const { p, rect } of sheet.items) {
    ctx.save();
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    const rot = (p.w > p.h) !== (rect.w > rect.h) && Math.abs(p.w - p.h) > 0.01;
    if (rot) ctx.rotate(Math.PI / 2);
    drawPiece(ctx, p, imgs);
    const cw = rot ? rect.h : rect.w, ch = rot ? rect.w : rect.h;
    if (Math.abs(p.w - cw) > 0.5 || Math.abs(p.h - ch) > 0.5) { // guía de corte en el borde del marco
      ctx.strokeStyle = '#d4d4d4'; ctx.lineWidth = 0.15;
      ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
    ctx.strokeStyle = '#c8c8c8'; ctx.lineWidth = 0.2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }
}
// Vista previa: el mapa de armado y cada hoja A3 tal como se imprime.
// Tocar una hoja (o el mapa) la agranda; tocar de nuevo la achica.
export function showSheets(container, sheets, imgs, cssW = 300, map = null) {
  container.innerHTML = '';
  const d = devicePixelRatio || 1;
  const big = () => Math.min(innerWidth - 80, (innerHeight - 140) * SHEET.w / SHEET.h, 760);
  if (map) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet';
    const mk = w => { const cv = mapCanvas({ ...map, widthPx: Math.round(w * d) }); cv.style.width = w + 'px'; cv.style.height = cv.height / d + 'px'; return cv; };
    let cv = mk(cssW * 1.4), isBig = false;
    const cap = document.createElement('span');
    cap.textContent = 'Mapa de armado · dónde va cada una';
    wrap.append(cv, cap);
    wrap.onclick = () => { isBig = !isBig; const n = mk(isBig ? Math.min(innerWidth - 80, 1100) : cssW * 1.4); cv.replaceWith(n); cv = n; wrap.classList.toggle('big', isBig); };
    container.append(wrap);
  }
  sheets.forEach((sh, i) => {
    const SHEET = SHEETS[sh.fmt || 'A3'];
    const wrap = document.createElement('div');
    wrap.className = 'sheet';
    const mk = w => {
      const cv = document.createElement('canvas');
      cv.style.width = w + 'px'; cv.style.height = w * SHEET.h / SHEET.w + 'px';
      cv.width = Math.round(w * d); cv.height = Math.round(w * d * SHEET.h / SHEET.w);
      renderSheet(cv.getContext('2d'), sh, cv.width / SHEET.w, imgs);
      return cv;
    };
    let cv = mk(cssW), isBig = false;
    const cap = document.createElement('span');
    cap.textContent = `Hoja ${i + 1} · ${sh.items.map(it => it.p.label).join('  ')}`;
    wrap.append(cv, cap);
    wrap.onclick = () => { isBig = !isBig; const n = mk(isBig ? big() : cssW); cv.replaceWith(n); cv = n; wrap.classList.toggle('big', isBig); if (isBig) wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
    container.append(wrap);
  });
}
function setJpegDpi(u8, dpi = 300) {
  if (u8[6] === 0x4a && u8[7] === 0x46 && u8[8] === 0x49 && u8[9] === 0x46) {
    u8[13] = 1; u8[14] = dpi >> 8; u8[15] = dpi & 255; u8[16] = dpi >> 8; u8[17] = dpi & 255;
  }
  return u8;
}
async function saveCanvas(cv, dir, name, q = 0.93) {
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
  const u8 = setJpegDpi(new Uint8Array(await blob.arrayBuffer()));
  const r = await fetch(`/api/save?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`, { method: 'POST', body: u8 });
  if (!r.ok) throw new Error((await r.json()).error);
}
// Edición en el lugar (título, nombres): Enter guarda, Esc cancela, clic afuera guarda.
export function inlineEdit(el, onDone) {
  const before = el.textContent;
  el.contentEditable = 'true'; el.focus();
  getSelection().selectAllChildren(el);
  const end = ok => {
    el.removeEventListener('blur', blur); el.removeEventListener('keydown', key);
    el.contentEditable = 'false';
    const v = el.textContent.replace(/\s+/g, ' ').trim();
    if (ok && v && v !== before) onDone(v); else el.textContent = before;
  };
  const blur = () => end(true);
  const key = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); el.blur(); } else if (e.key === 'Escape') { el.removeEventListener('blur', blur); end(false); } };
  el.addEventListener('blur', blur); el.addEventListener('keydown', key);
}
// Nombre apto para carpeta/archivo de Windows.
export const safeName = s => (String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'Exportación').slice(0, 80);
export async function exportSheets({ sheets, dir, title = '', loadFull, onProgress }) {
  const fmt = sheets[0]?.fmt || 'A3', SHEET = SHEETS[fmt];
  const pre = title ? safeName(title) + ' - ' : '';
  await fetch(`/api/clear?dir=${encodeURIComponent(dir)}&prefix=${encodeURIComponent(pre)}`, { method: 'POST' });
  const names = [];
  for (let i = 0; i < sheets.length; i++) {
    const imgs = new Map();
    for (const k of new Set(sheets[i].items.map(it => it.p.key))) imgs.set(k, await loadFull(k));
    const cv = document.createElement('canvas');
    [cv.width, cv.height] = SHEET.px;
    renderSheet(cv.getContext('2d'), sheets[i], SHEET.px[0] / SHEET.w, imgs);
    const name = `${pre}${fmt} hoja ${String(i + 1).padStart(2, '0')}.jpg`;
    await saveCanvas(cv, dir, name);
    cv.width = cv.height = 0;
    names.push(name);
    onProgress?.(i + 1, sheets.length);
  }
  const r = await fetch('/api/pdf?dir=' + encodeURIComponent(dir), {
    method: 'POST',
    body: JSON.stringify({ files: names, name: title ? `${pre}${fmt} completo.pdf` : `Impresión ${fmt} completa.pdf`, wPt: SHEET.pt[0], hPt: SHEET.pt[1] }),
  });
  if (!r.ok) throw new Error((await r.json()).error);
}
// Mapa de armado: toda la composición vista desde arriba con los números grandes.
export async function exportMap({ dir, name = 'Mapa de armado.jpg', ...opts }) {
  const cv = mapCanvas(opts);
  await saveCanvas(cv, dir, name, 0.9);
  cv.width = cv.height = 0;
}
export function mapCanvas({ pieces, imgs, under, bounds, shapes = [], widthPx = 5000 }) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pieces) {
    const [hw, hh] = extent(p.w, p.h, p.ang);
    x0 = Math.min(x0, p.x - hw); y0 = Math.min(y0, p.y - hh); x1 = Math.max(x1, p.x + hw); y1 = Math.max(y1, p.y + hh);
  }
  if (bounds) { x0 = Math.min(x0, bounds.x0); y0 = Math.min(y0, bounds.y0); x1 = Math.max(x1, bounds.x1); y1 = Math.max(y1, bounds.y1); }
  const m = 30; x0 -= m; y0 -= m; x1 += m; y1 += m;
  const s = widthPx / (x1 - x0);
  const cv = document.createElement('canvas');
  cv.width = widthPx; cv.height = Math.round((y1 - y0) * s);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#efe8d8'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
  if (bounds) { ctx.strokeStyle = '#5f5849'; ctx.lineWidth = 1; ctx.setLineDash([8, 6]); ctx.strokeRect(bounds.x0, bounds.y0, bounds.x1 - bounds.x0, bounds.y1 - bounds.y0); ctx.setLineDash([]); }
  for (const sh of shapes) { // lienzos a mano alzada
    ctx.beginPath(); sh.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
    ctx.fillStyle = 'rgba(43,107,88,.10)'; ctx.fill();
    ctx.strokeStyle = '#2b6b58'; ctx.lineWidth = 1.2; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]);
    if (sh.name) { ctx.fillStyle = '#2b6b58'; ctx.font = `800 ${Math.max(8, (x1 - x0) / 70)}px Archivo, "Segoe UI", Arial, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(sh.name.toUpperCase(), Math.min(...sh.pts.map(p => p[0])), Math.min(...sh.pts.map(p => p[1])) - 3); }
  }
  under?.(ctx);
  for (const p of pieces) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang || 0);
    drawPiece(ctx, p, imgs);
    ctx.strokeStyle = '#16130f'; ctx.lineWidth = 0.6; ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  const fs = Math.max(10, Math.min(30, (x1 - x0) / 40));
  ctx.font = `800 ${fs}px Archivo, "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const p of pieces) {
    if (!p.label) continue;
    const tw = ctx.measureText(p.label).width + fs * 0.7;
    ctx.fillStyle = '#ffe14d'; ctx.fillRect(p.x - tw / 2, p.y - fs * 0.65, tw, fs * 1.3);
    ctx.fillStyle = '#16130f'; ctx.fillText(p.label, p.x, p.y + fs * 0.05);
  }
  return cv;
}

// ---------- Íconos y carteles de atajos ----------
const ICONS = {
  move: '<path d="M4 4l7 17 2.5-7.5L21 11z"/><path d="M14 14l6 6"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  size: '<rect x="3" y="9" width="12" height="12" rx="1"/><path d="M13 3h8v8"/><path d="M21 3l-8 8"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8"/><path d="M21 3v5h-5"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  fit: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/>',
  limit: '<rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 2.5"/><path d="M8 16V8l3 4 3-4v8"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  sheets: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h6M4 12h16M12 7v15"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  rows: '<rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  frame: '<rect x="3" y="3" width="18" height="18" rx="1"/><rect x="7.5" y="7.5" width="9" height="9"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="16" cy="16" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="16" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="16" r="1.3" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  up: '<path d="M5 3h14M18 13l-6-6-6 6M12 7v14"/>',
  down: '<path d="M12 17V3M6 11l6 6 6-6M19 21H5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  holes: '<circle cx="12" cy="12" r="9"/><path d="M22 12h-4M6 12H2M12 6V2M12 22v-4"/>',
  filter: '<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  dots: '<circle cx="6" cy="6" r="1.4" fill="currentColor"/><circle cx="12" cy="6" r="1.4" fill="currentColor"/><circle cx="18" cy="6" r="1.4" fill="currentColor"/><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/><circle cx="6" cy="18" r="1.4" fill="currentColor"/><circle cx="12" cy="18" r="1.4" fill="currentColor"/><circle cx="18" cy="18" r="1.4" fill="currentColor"/>',
  lupa: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
  az: '<path d="M3 17l3.5-9 3.5 9M4.3 14h4.4"/><path d="M14 8h6l-6 9h6"/>',
  focal: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v5.5M21 12h-5.5M12 21v-5.5M3 12h5.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
  folderOpen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 7v11a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L22 12H8l-3 8"/>',
  mosaic: '<rect x="3" y="4" width="9" height="11" rx="1" transform="rotate(-10 7.5 9.5)"/><rect x="11" y="7" width="10" height="12" rx="1" transform="rotate(12 16 13)"/><rect x="6" y="13" width="8" height="8" rx="1"/>',
  rotateL: '<path d="M3 12a9 9 0 1 0 9-9c-2.5 0-4.9 1-6.7 2.7L3 8"/><path d="M3 3v5h5"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  lockOpen: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.3"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  dup: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/><path d="M14.5 11.5v6M11.5 14.5h6"/>',
  eyeOff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M2 2l20 20"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/>',
  magnet: '<path d="M6 15l-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="M5 8l4 4M12 15l4 4"/>',
  alignLeft: '<path d="M4 3v18"/><rect x="8" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="7" height="4" rx="1"/>',
  alignHC: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
  alignRight: '<path d="M20 3v18"/><rect x="4" y="6" width="12" height="4" rx="1"/><rect x="9" y="14" width="7" height="4" rx="1"/>',
  alignTop: '<path d="M3 4h18"/><rect x="6" y="8" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="7" rx="1"/>',
  alignVC: '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
  alignBottom: '<path d="M3 20h18"/><rect x="6" y="4" width="4" height="12" rx="1"/><rect x="14" y="9" width="4" height="7" rx="1"/>',
  distH: '<path d="M4 3v18M20 3v18"/><rect x="9" y="7" width="6" height="10" rx="1"/>',
  distV: '<path d="M3 4h18M3 20h18"/><rect x="7" y="9" width="10" height="6" rx="1"/>',
  shapeRect: '<rect x="3.5" y="5" width="17" height="14" rx="1" stroke-dasharray="3 2.6"/>',
  shapeCircle: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.6"/>',
  shapePen: '<path d="M12 2.5l2.6 6 6.4.6-4.9 4.2 1.5 6.3L12 16.3l-5.6 3.3 1.5-6.3L3 9.1l6.4-.6z" stroke-dasharray="2.8 2.4"/>',
  shapeFree: '<path d="M5.5 8C8 3.5 15 3 18.5 6.5s3 9.5-1.5 12-10 2.5-12.5-1S3 11.5 5.5 8z" stroke-dasharray="3 2.6"/>',
  layers: '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>',
  wheel: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="4"/><path d="M12 2.5V8M12 16v5.5M2.5 12H8M16 12h5.5M5.3 5.3l3.9 3.9M14.8 14.8l3.9 3.9M18.7 5.3l-3.9 3.9M9.2 14.8l-3.9 3.9"/>',
  draw: '<path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  eraseShape: '<path d="M7 21h10"/><path d="M5 11c0-4 3-7 7-7s7 3 7 7-3 6-7 6-7-2-7-6z" stroke-dasharray="3 2.5"/><path d="M9 8.5l6 5M15 8.5l-6 5"/>',
  color: '<circle cx="13.5" cy="6.5" r="1.6" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1.6" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1.6" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1.6" fill="currentColor"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A5.6 5.6 0 0 0 22 11c0-5-4.5-9-10-9z"/>',
  date: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  orient: '<rect x="2" y="3" width="8" height="14" rx="1"/><rect x="12" y="10" width="10" height="7" rx="1"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
};
export const icon = name => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
// el título de la izquierda se achica hasta donde empieza la barra centrada (nunca queda debajo)
export function fitBar() {
  const bar = document.querySelector('.bar'), c = bar?.querySelector('.group.center'), logo = bar?.querySelector(':scope > .logo');
  if (!c || !logo || !c.getBoundingClientRect) return;
  logo.style.maxWidth = Math.max(60, c.getBoundingClientRect().left - bar.getBoundingClientRect().left - 12) + 'px';
}
export function mountIcons(root = document) {
  addEventListener('resize', fitBar); document.fonts?.ready.then(fitBar); setTimeout(fitBar, 0);
  root.querySelectorAll('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));
  const tip = document.createElement('div');
  tip.className = 'tip';
  document.body.append(tip);
  document.addEventListener('mouseover', e => {
    const el = e.target.closest?.('[data-tip]');
    if (!el || prefs.tips === 'off') { tip.classList.remove('show'); return; }
    const [title, ...rest] = el.dataset.tip.split('|');
    tip.innerHTML = `<b>${title}</b>` + rest.map(r => `<span>${r}</span>`).join('');
    tip.classList.add('show');
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px';
    tip.style.top = r.bottom + 10 + 'px';
  });
}

// ---------- La mesa (mat con zoom, selección y arrastre) ----------
// h = { list(), images, bounds(), begin(), commit(), cancel(), undo(), redo(), changed(),
//       onSize(refs, back), onRotate(refs, dir), onWheelRotate(refs, dir), onKey(e, mesa, world),
//       onTool(tool), onSelect(), under(ctx,z), over(ctx,z), snap }
// Selección: clic = una · arrastrar en vacío = recuadro · Ctrl = sumar/sacar · Shift = rango.
// Vista: Espacio + arrastrar, botón de la ruedita, o arrastrar con clic derecho.
export const TOOLS = { v: 'move', h: 'pan', s: 'size', r: 'rotate', d: 'draw', z: 'zoom' };

// ---------- Formas a mano alzada ----------
// Simplifica un trazo (Ramer–Douglas–Peucker) para que la forma sea liviana.
export function simplify(pts, eps = 2) {
  if (pts.length < 3) return pts;
  const dist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    if (!L) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = dist(pts[i], pts[0], pts.at(-1)); if (d > max) { max = d; idx = i; } }
  if (max <= eps) return [pts[0], pts.at(-1)];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}
// Puntos de un rectángulo o un círculo/elipse metido en la caja (x0,y0)-(x1,y1).
export function shapePts(shape, x0, y0, x1, y1) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  if (shape === 'circle') {
    const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax) / 2, ry = (by - ay) / 2;
    return Array.from({ length: 72 }, (_, i) => { const t = i / 72 * Math.PI * 2; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)]; });
  }
  return [[ax, ay], [bx, ay], [bx, by], [ax, by]];
}
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Tramos horizontales que quedan dentro de la forma a la altura y.
function spansAt(y, poly) {
  const xs = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y)) xs.push((xj - xi) * (y - yi) / (yj - yi) + xi);
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}
// Tramos donde entra una franja entera de alto y0..y1.
export function spansInBand(y0, y1, poly, step = 5) {
  let cur = null;
  for (let y = y0; ; y = Math.min(y1, y + step)) {
    const s = spansAt(y, poly);
    if (!cur) cur = s;
    else {
      const next = [];
      for (const [a, b] of cur) for (const [c, d] of s) { const lo = Math.max(a, c), hi = Math.min(b, d); if (hi > lo) next.push([lo, hi]); }
      cur = next;
    }
    if (!cur.length || y >= y1) break;
  }
  return cur || [];
}
// ¿La pieza (girada o no) queda entera adentro de la forma?
// tol: lo que se perdona en el borde (mm). Una foto apoyada justo contra la línea del lienzo
// (por ejemplo al alinearla) cuenta como adentro aunque el redondeo la corra una décima.
export function pieceInPoly(p, poly, step = 8, tol = 0.3) {
  const c = Math.cos(p.ang || 0), s = Math.sin(p.ang || 0);
  const chk = (lx, ly) => pointInPoly(p.x + lx * c - ly * s, p.y + lx * s + ly * c, poly);
  const w = Math.max(0.1, p.w - 2 * tol), h = Math.max(0.1, p.h - 2 * tol);
  const nx = Math.max(1, Math.ceil(w / step)), ny = Math.max(1, Math.ceil(h / step));
  for (let i = 0; i <= nx; i++) { const lx = -w / 2 + w * i / nx; if (!chk(lx, -h / 2) || !chk(lx, h / 2)) return false; }
  for (let j = 0; j <= ny; j++) { const ly = -h / 2 + h * j / ny; if (!chk(-w / 2, ly) || !chk(w / 2, ly)) return false; }
  return true;
}
export class Mesa {
  constructor(canvas, h) {
    Object.assign(this, { c: canvas, ctx: canvas.getContext('2d'), h, cam: { x: 0, y: 0, z: 1 }, selection: new Set(), anchor: null, hover: null,
      space: false, dirty: true, drag: null, mouse: { x: 0, y: 0 }, tool: 'move' });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.invalidate(); } });
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('auxclick', e => e.preventDefault());
    window.addEventListener('keydown', e => this.key(e, true));
    window.addEventListener('keyup', e => this.key(e, false));
    window.addEventListener('blur', () => { this.releaseSpace(); this.nudgeEnd(); this.cursor(); });
    const loop = () => { if (this.dirty) { this.dirty = false; this.render(); } requestAnimationFrame(loop); };
    loop();
  }
  invalidate() { this.dirty = true; }
  get W() { return this.c.clientWidth; }
  get H() { return this.c.clientHeight; }
  resize() {
    const d = devicePixelRatio || 1;
    this.c.width = Math.round(this.W * d); this.c.height = Math.round(this.H * d);
    this.invalidate();
  }
  // temp: cambio pasajero (la mano del Espacio): no se pierde la pluma a medio hacer
  setTool(t, temp = false) { if (t === 'draw' && !this.h.onDraw) return; if (t !== 'draw' && !temp) this.pen = null; if (!temp) this.prevTool = null; this.tool = t; this.cursor(); this.h.onTool?.(t); this.invalidate(); }
  releaseSpace() {
    if (!this.space) return;
    this.space = false;
    if (this.prevTool) { const t = this.prevTool; this.prevTool = null; this.setTool(t, true); }
  }
  // flechas: un toque = 1 mm (Shift: 10 mm); mantenerla apretada es un solo paso para Ctrl+Z
  nudge(k, big) {
    const s = big ? 10 : 1;
    const dx = k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0, dy = k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0;
    const refs = this.selRefs();
    if (!refs.length && !this.nudging) { // sin selección: mueven la vista
      this.cam.x += dx * 4 / this.cam.z; this.cam.y += dy * 4 / this.cam.z;
      return this.invalidate();
    }
    if (!this.nudging) { this.h.begin(); this.h.dragStart?.(); this.nudging = { dx: 0, dy: 0, items: refs.map(r => ({ r, ox: r.x, oy: r.y })) }; }
    const n = this.nudging;
    n.dx += dx; n.dy += dy;
    for (const it of n.items) { it.r.x = Math.round((it.ox + n.dx) * 10) / 10; it.r.y = Math.round((it.oy + n.dy) * 10) / 10; }
    this.h.dragMove?.(n.dx, n.dy);
    this.h.changed?.(); this.invalidate();
  }
  nudgeEnd() {
    const n = this.nudging;
    if (!n) return;
    this.nudging = null;
    this.h.commit(n.items.map(i => i.r));
  }
  // pluma: un clic por punto; se cierra tocando el primero, con doble clic o con Enter
  penClick(w, e) {
    const p = this.pen ||= { pts: [] }, first = p.pts[0];
    const nearFirst = first && Math.hypot(w.x - first[0], w.y - first[1]) * this.cam.z < 10;
    if ((nearFirst || e.detail >= 2) && p.pts.length >= 3) return this.penClose();
    p.pts.push([w.x, w.y]);
    this.invalidate();
  }
  penClose() {
    const pts = this.pen?.pts || [];
    this.pen = null; this.invalidate();
    if (pts.length >= 3) this.h.onDraw?.(pts);
  }

  // --- selección ---
  get sel() { return this.anchor && this.selection.has(this.anchor) ? this.anchor : [...this.selection].at(-1) || null; }
  set sel(ref) { this.selection = new Set(ref ? [ref] : []); this.anchor = ref || null; this.selChanged(); }
  selChanged() { this.invalidate(); this.h.onSelect?.(); }
  // las piezas seleccionadas que siguen existiendo (después de deshacer los objetos cambian)
  selRefs() { return this.h.list().filter(p => !p.hidden).map(p => p.ref).filter(r => this.selection.has(r)); }
  selectAll() { this.selection = new Set(this.h.list().filter(p => !p.hidden).map(p => p.ref)); this.selChanged(); }
  // si tocás una pieza seleccionada, la acción va a todas las seleccionadas
  targets(ref) { return this.selection.has(ref) ? this.selRefs() : [ref]; }
  ordered() { return this.h.list().map((p, i) => ({ p, k: p.order ?? i })).filter(o => !o.p.hidden).sort((a, b) => a.k - b.k).map(o => o.p.ref); }

  toWorld(sx, sy) { return { x: (sx - this.W / 2) / this.cam.z + this.cam.x, y: (sy - this.H / 2) / this.cam.z + this.cam.y }; }
  pos(e) { const r = this.c.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  hit(wx, wy) {
    const L = this.h.list();
    for (let i = L.length - 1; i >= 0; i--) {
      if (L[i].hidden) continue;
      const p = L[i], dx = wx - p.x, dy = wy - p.y, a = p.ang || 0;
      const lx = dx * Math.cos(a) + dy * Math.sin(a), ly = -dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= p.w / 2 && Math.abs(ly) <= p.h / 2) return p;
    }
    return null;
  }
  zoomBy(f, sx = this.W / 2, sy = this.H / 2) {
    const before = this.toWorld(sx, sy);
    this.cam.z = Math.min(40, Math.max(0.03, this.cam.z * f));
    this.cam.x = before.x - (sx - this.W / 2) / this.cam.z;
    this.cam.y = before.y - (sy - this.H / 2) / this.cam.z;
    this.invalidate();
  }
  fit(pad = 40) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.h.list()) {
      if (p.hidden) continue;
      const [hw, hh] = extent(p.w, p.h, p.ang);
      x0 = Math.min(x0, p.x - hw); y0 = Math.min(y0, p.y - hh); x1 = Math.max(x1, p.x + hw); y1 = Math.max(y1, p.y + hh);
    }
    const b = this.h.bounds?.();
    if (b) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    if (!isFinite(x0)) return;
    const top = 130; // lugar para la barra de arriba
    this.cam.z = Math.min((this.W - pad * 2) / (x1 - x0), (this.H - pad * 2 - top) / (y1 - y0));
    this.cam.x = (x0 + x1) / 2; this.cam.y = (y0 + y1) / 2 - (top / 2) / this.cam.z;
    this.invalidate();
  }

  // --- mouse ---
  down(e) {
    const { sx, sy } = this.pos(e), w = this.toWorld(sx, sy), ctrl = e.ctrlKey || e.metaKey;
    this.c.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch' && this.touchDown(e)) return;
    const pan = extra => { this.drag = { mode: 'pan', sx, sy, cx: this.cam.x, cy: this.cam.y, ...extra }; this.cursor(); };
    if (e.button === 1) e.preventDefault(); // la ruedita: sin el autodesplazamiento del navegador
    // lupa: clic izquierdo acerca, clic derecho (o Alt+clic) aleja, hacia donde apunta el mouse
    if (this.tool === 'zoom' && !this.space && (e.button === 0 || e.button === 2)) {
      const { sx: zx, sy: zy } = this.pos(e);
      this.zoomBy(e.button === 2 || e.altKey ? 1 / 1.6 : 1.6, zx, zy);
      return;
    }
    if (e.button === 1 || this.space || (e.button === 0 && this.tool === 'pan')) return pan();
    const p = this.hit(w.x, w.y);
    // clic derecho: si arrastrás mueve la vista; si soltás quieto cambia tamaño (Ctrl: rota)
    if (e.button === 2) return pan({ right: true, piece: p, ctrl, shift: e.shiftKey, alt: e.altKey, moved: false, cx0: e.clientX, cy0: e.clientY });
    if (e.button !== 0) return;
    if (this.tool === 'move' && this.h.grabHandle) {
      const ctl = this.h.grabHandle(w, e);
      if (ctl) { this.drag = { mode: 'custom', ctl }; return this.invalidate(); }
    }
    if (this.tool === 'draw') {
      const shape = this.h.drawMode?.() || 'free';
      if (shape === 'pen') return this.penClick(w, e);
      this.drag = { mode: 'draw', shape, pts: [[w.x, w.y]], x0: w.x, y0: w.y, x1: w.x, y1: w.y };
      return this.invalidate();
    }
    if (p && this.tool === 'rotate') { // girar libre arrastrando alrededor del centro (Shift: de a 90°)
      if (!this.selection.has(p.ref)) this.sel = p.ref;
      const L = this.h.list(), items = this.targets(p.ref).map(r => { const q = L.find(x => x.ref === r); return { r, cx: q.x, cy: q.y, a0: r.ang || 0 }; });
      const lead = items.find(i => i.r === p.ref) || items[0];
      this.h.begin();
      this.drag = { mode: 'rot', items, lead, m0: Math.atan2(w.y - lead.cy, w.x - lead.cx), moved: false };
      return this.invalidate();
    }
    if (p && this.tool === 'size') {
      if (!this.selection.has(p.ref)) this.sel = p.ref;
      this.h.onSize?.(this.targets(p.ref), e.shiftKey);
      return this.invalidate();
    }
    if (!p && e.altKey && this.tool === 'move' && this.h.restackEmpty?.(w, 1)) return this.invalidate();
    // agarrar un lienzo por una parte vacía: se mueve entero con sus fotos (Shift/Ctrl: recuadro)
    if (!p && !ctrl && !e.shiftKey && this.h.grabEmpty?.(w)) return this.startMove(null, w);
    // Ctrl/Shift + clic en algo vacío que la app reconoce (la etiqueta de un lienzo): sumarlo a la selección
    if (!p && (ctrl || e.shiftKey) && this.h.toggleEmpty?.(w)) return this.invalidate();
    if (!p && e.pointerType === 'touch') return pan(); // con el dedo, lo vacío mueve la vista
    if (!p) { // recuadro de selección
      const base = ctrl || e.shiftKey ? new Set(this.selection) : new Set();
      if (!ctrl && !e.shiftKey) this.sel = null;
      this.drag = { mode: 'box', x0: w.x, y0: w.y, x1: w.x, y1: w.y, base, toggle: ctrl };
      return this.invalidate();
    }
    if (ctrl) { // sumar o sacar una
      this.selection.has(p.ref) ? this.selection.delete(p.ref) : this.selection.add(p.ref);
      this.anchor = p.ref;
      return this.selChanged();
    }
    if (e.shiftKey && this.anchor) { // rango: todas las del medio
      const ord = this.ordered().filter(r => !this.h.sameGroup || this.h.sameGroup(r, p.ref)), a = ord.indexOf(this.anchor), b = ord.indexOf(p.ref);
      if (a >= 0 && b >= 0) {
        this.selection = new Set(ord.slice(Math.min(a, b), Math.max(a, b) + 1));
        return this.selChanged();
      }
    }
    if (!this.selection.has(p.ref)) this.sel = p.ref; else this.anchor = p.ref;
    this.startMove(p.ref, w);
    if (e.altKey && this.tool === 'move' && this.drag) this.drag.altRef = p.ref;
  }
  startMove(lead, w) {
    const L = this.h.list(), refs = this.selRefs();
    this.h.begin();
    this.h.dragStart?.();
    const items = refs.map(r => { const q = L.find(x => x.ref === r); return { ref: r, ox: r.x, oy: r.y, w: q.w, h: q.h, ang: q.ang }; });
    this.drag = { mode: 'move', lead, wx: w.x, wy: w.y, moved: false, items, ...this.snapSetup(items, L) };
    this.invalidate(); this.cursor();
  }
  // Imán (guías inteligentes): el marco del grupo que se mueve y contra qué se puede pegar:
  // bordes y centros de las demás fotos, y de los lienzos (h.snapTargets).
  snapSetup(items, L) {
    if (!items.length) return {};
    const sel = new Set(items.map(i => i.ref));
    const box = r => { const [hw, hh] = extent(r.w, r.h, r.ang); return { x0: r.x - hw, x1: r.x + hw, y0: r.y - hh, y1: r.y + hh }; };
    const g = items.map(i => box({ x: i.ox, y: i.oy, w: i.w, h: i.h, ang: i.ang }));
    const box0 = { x0: Math.min(...g.map(b => b.x0)), x1: Math.max(...g.map(b => b.x1)), y0: Math.min(...g.map(b => b.y0)), y1: Math.max(...g.map(b => b.y1)) };
    const others = [...L.filter(p => !sel.has(p.ref) && !p.hidden).map(box), ...(this.h.snapTargets?.() || [])];
    const tx = [], ty = [];
    for (const o of others) {
      for (const v of [o.x0, (o.x0 + o.x1) / 2, o.x1]) tx.push({ v, a: o.y0, b: o.y1 });
      for (const v of [o.y0, (o.y0 + o.y1) / 2, o.y1]) ty.push({ v, a: o.x0, b: o.x1 });
    }
    return { box0, tx, ty };
  }
  // busca la guía más cercana (a menos de 8 px en pantalla) para los bordes y el centro del marco
  snapAxis(lo, hi, targets, other) {
    const th = 8 / this.cam.z, mine = [lo, (lo + hi) / 2, hi];
    let best = null;
    for (const t of targets) for (const m of mine) { const dd = t.v - m; if (Math.abs(dd) < th && (!best || Math.abs(dd) < Math.abs(best.dd))) best = { dd, t }; }
    if (!best) return { shift: 0, guides: [] };
    // todas las guías que coinciden con ese corrimiento (p. ej. borde y centro a la vez)
    const guides = [];
    for (const t of targets) for (const m of mine) if (Math.abs(t.v - (m + best.dd)) < 0.05) guides.push({ v: t.v, a: Math.min(t.a, other[0]), b: Math.max(t.b, other[1]) });
    return { shift: best.dd, guides };
  }
  move(e) {
    if (e.pointerType === 'touch' && this.touchMove(e)) return;
    const { sx, sy } = this.pos(e);
    this.mouse = this.toWorld(sx, sy);
    const d = this.drag;
    if (!d) {
      if (this.pen) this.invalidate(); // línea de la pluma hasta el mouse
      const hc = this.tool === 'move' && !this.space ? this.h.handleCursor?.(this.mouse) : null; // cursor sobre un tirador
      this.c.style.cursor = hc || ''; if (!hc) this.cursor();
      const hv = this.hit(this.mouse.x, this.mouse.y)?.ref || null;
      if (hv !== this.hover) { this.hover = hv; this.invalidate(); }
      return;
    }
    if (d.mode === 'pan') {
      if (d.right && !d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 4) return;
      d.moved = true;
      this.cam.x = d.cx - (sx - d.sx) / this.cam.z; this.cam.y = d.cy - (sy - d.sy) / this.cam.z;
      this.cursor();
    } else if (d.mode === 'draw') {
      if (d.shape === 'free') {
        const last = d.pts.at(-1);
        if (Math.hypot(this.mouse.x - last[0], this.mouse.y - last[1]) * this.cam.z >= 3) d.pts.push([this.mouse.x, this.mouse.y]);
      } else { // rectángulo / círculo: de esquina a esquina (Shift: cuadrado / redondo)
        let dx = this.mouse.x - d.x0, dy = this.mouse.y - d.y0;
        if (e.shiftKey) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * s; dy = Math.sign(dy || 1) * s; }
        d.x1 = d.x0 + dx; d.y1 = d.y0 + dy; d.pts = shapePts(d.shape, d.x0, d.y0, d.x1, d.y1);
      }
    } else if (d.mode === 'rot') {
      const Q = Math.PI / 2, da = Math.atan2(this.mouse.y - d.lead.cy, this.mouse.x - d.lead.cx) - d.m0;
      for (const it of d.items) { let a = it.a0 + da; if (e.shiftKey) a = Math.round(a / Q) * Q; it.r.ang = a; }
      d.moved = true; this.h.changed?.();
    } else if (d.mode === 'custom') {
      d.ctl.move(this.mouse, e);
    } else if (d.mode === 'box') {
      d.x1 = this.mouse.x; d.y1 = this.mouse.y;
      const bx0 = Math.min(d.x0, d.x1), bx1 = Math.max(d.x0, d.x1), by0 = Math.min(d.y0, d.y1), by1 = Math.max(d.y0, d.y1);
      const inBox = this.h.list().filter(p => !p.hidden).filter(p => { const [hw, hh] = extent(p.w, p.h, p.ang); return p.x + hw > bx0 && p.x - hw < bx1 && p.y + hh > by0 && p.y - hh < by1; }).map(p => p.ref);
      const sel = new Set(d.base);
      for (const r of inBox) d.toggle && d.base.has(r) ? sel.delete(r) : sel.add(r);
      this.selection = sel;
      this.selChanged();
    } else {
      const lead = d.items.find(it => it.ref === d.lead) || d.items[0];
      let dx = this.mouse.x - d.wx, dy = this.mouse.y - d.wy;
      const sn = this.h.snap;
      this.guides = [];
      if (this.h.magnet?.() && !e.altKey && d.box0) { // imán: se pega a bordes y centros cercanos
        const B = d.box0;
        const sx = this.snapAxis(B.x0 + dx, B.x1 + dx, d.tx, [B.y0 + dy, B.y1 + dy]);
        dx += sx.shift;
        const sy = this.snapAxis(B.y0 + dy, B.y1 + dy, d.ty, [B.x0 + dx, B.x1 + dx]);
        dy += sy.shift;
        // las guías verticales se recalculan con la y ya pegada
        const sx2 = sx.shift ? this.snapAxis(B.x0 + dx, B.x1 + dx, d.tx, [B.y0 + dy, B.y1 + dy]) : sx;
        this.guides = [...sx2.guides.map(g => ({ x: g.v, a: g.a, b: g.b })), ...sy.guides.map(g => ({ y: g.v, a: g.a, b: g.b }))];
      } else if (sn && !e.altKey && lead) { dx = Math.round((lead.ox + dx) / sn) * sn - lead.ox; dy = Math.round((lead.oy + dy) / sn) * sn - lead.oy; }
      const b = this.h.clampToBounds === false ? null : this.h.bounds?.();
      if (b) { // el grupo entero no sale del lienzo
        let lx0 = -Infinity, lx1 = Infinity, ly0 = -Infinity, ly1 = Infinity;
        for (const it of d.items) {
          const [hw, hh] = extent(it.w, it.h, it.ang);
          lx0 = Math.max(lx0, b.x0 + hw - it.ox); lx1 = Math.min(lx1, b.x1 - hw - it.ox);
          ly0 = Math.max(ly0, b.y0 + hh - it.oy); ly1 = Math.min(ly1, b.y1 - hh - it.oy);
        }
        if (lx0 <= lx1) dx = Math.max(lx0, Math.min(lx1, dx));
        if (ly0 <= ly1) dy = Math.max(ly0, Math.min(ly1, dy));
      }
      if (dx || dy || d.moved) {
        for (const it of d.items) { it.ref.x = it.ox + dx; it.ref.y = it.oy + dy; }
        this.h.dragMove?.(dx, dy); // lo que acompaña (p. ej. la forma del lienzo)
        d.moved = true; this.h.changed?.();
      }
    }
    this.invalidate();
  }
  up(e) {
    if (e?.pointerType === 'touch' && this.touchUp(e)) return;
    const d = this.drag;
    this.drag = null;
    this.guides = [];
    if (d?.mode === 'custom') d.ctl.end();
    if (d?.mode === 'rot') d.moved ? this.h.commit(d.items.map(i => i.r)) : this.h.cancel();
    if (d?.mode === 'move') d.moved ? this.h.commit(d.items.map(i => i.ref)) : this.h.cancel();
    if (d?.mode === 'move' && !d.moved && d.altRef) this.h.onRestack?.(d.altRef, 1);
    if (d?.mode === 'draw') {
      if (d.shape === 'free') { if (d.pts.length > 5) this.h.onDraw?.(simplify(d.pts, 1.5 / Math.min(1, this.cam.z))); }
      else if (Math.abs(d.x1 - d.x0) * this.cam.z > 8 && Math.abs(d.y1 - d.y0) * this.cam.z > 8) this.h.onDraw?.(d.pts);
    }
    if (d?.mode === 'pan' && d.right && !d.moved && d.alt && this.h.onRestack) { // Alt + clic derecho: bajar un lugar
      if (d.piece) this.h.onRestack(d.piece.ref, -1); else this.h.restackEmpty?.(this.toWorld(d.sx, d.sy), -1);
    } else if (d?.mode === 'pan' && d.right && !d.moved && d.piece) {
      if (!this.selection.has(d.piece.ref)) this.sel = d.piece.ref;
      const t = this.targets(d.piece.ref);
      if (d.ctrl) this.h.onRotate?.(t, d.shift ? -1 : 1);
      else if (this.h.onContext) this.h.onContext(t, d.cx0, d.cy0, this.toWorld(d.sx, d.sy));
      else this.h.onSize?.(t, d.shift);
    } else if (d?.mode === 'pan' && d.right && !d.moved && this.h.onContext) {
      this.h.onContext(null, d.cx0, d.cy0, this.toWorld(d.sx, d.sy)); // clic derecho en el mat vacío
    }
    this.cursor(); this.invalidate();
  }
  // --- tacto ---
  touchPts() { const r = this.c.getBoundingClientRect(), [a, b] = [...this.touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top }; }
  touchDown(e) {
    this.touches ||= new Map();
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearTimeout(this.lpT);
    if (this.touches.size >= 2) { // segundo dedo: lo que se estaba haciendo termina y empieza el zoom
      const d = this.drag;
      if (d?.mode === 'move') d.moved ? this.h.commit(d.items.map(i => i.ref)) : this.h.cancel();
      else if (d?.mode === 'rot') d.moved ? this.h.commit(d.items.map(i => i.r)) : this.h.cancel();
      else if (d?.mode === 'custom') d.ctl.end();
      const t = this.touchPts();
      this.drag = { mode: 'pinch', d0: t.d, z0: this.cam.z, w0: this.toWorld(t.mx, t.my) };
      this.invalidate();
      return true;
    }
    // mantener apretado (sin mover): el menú, como el clic derecho
    this.lp = { x: e.clientX, y: e.clientY, fired: false };
    this.lpT = setTimeout(() => {
      const d = this.drag;
      if (d?.moved) return;
      if (d?.mode === 'move' || d?.mode === 'rot') this.h.cancel();
      this.drag = null; this.lp.fired = true;
      const { sx, sy } = this.pos(e), w = this.toWorld(sx, sy), p = this.hit(w.x, w.y);
      if (p) { if (!this.selection.has(p.ref)) this.sel = p.ref; this.h.onContext?.(this.targets(p.ref), e.clientX, e.clientY, w); }
      else this.h.onContext?.(null, e.clientX, e.clientY, w);
      navigator.vibrate?.(15);
      this.invalidate();
    }, 550);
    return false;
  }
  touchMove(e) {
    if (!this.touches?.has(e.pointerId)) return false;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.lp && Math.hypot(e.clientX - this.lp.x, e.clientY - this.lp.y) > 8) clearTimeout(this.lpT);
    const d = this.drag;
    if (d?.mode !== 'pinch') return !!this.lp?.fired;
    if (this.touches.size < 2) return true;
    const t = this.touchPts();
    this.cam.z = Math.min(40, Math.max(0.03, d.z0 * t.d / d.d0));
    this.cam.x = d.w0.x - (t.mx - this.W / 2) / this.cam.z; this.cam.y = d.w0.y - (t.my - this.H / 2) / this.cam.z;
    this.invalidate();
    return true;
  }
  touchUp(e) {
    this.touches?.delete(e.pointerId);
    clearTimeout(this.lpT);
    if (this.drag?.mode === 'pinch') { if (!this.touches.size) this.drag = null; return true; }
    if (this.lp?.fired) { this.lp = null; this.drag = null; this.cursor(); return true; }
    return false;
  }
  // ¿mouse o trackpad? El trackpad manda movimientos chicos, con decimales o de costado; la ruedita, saltos grandes y parejos.
  isTrackpad(e) {
    const mode = cfg().pointer;
    if (mode !== 'auto') return mode === 'trackpad';
    const now = performance.now();
    const pad = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 50 || (e.wheelDeltaY && Math.abs(e.wheelDeltaY) % 120 !== 0));
    if (pad) this.padUntil = now + 800;           // seguimos en el mismo gesto
    else if (Math.abs(e.deltaY) >= 100) this.padUntil = 0; // salto típico de ruedita
    return now < (this.padUntil || 0);
  }
  wheel(e) {
    e.preventDefault();
    const { sx, sy } = this.pos(e);
    const pad = this.isTrackpad(e);
    const dy = e.deltaY || e.deltaX;
    if (e.shiftKey && this.h.onWheelRotate && !pad) {
      const w = this.toWorld(sx, sy), p = this.hit(w.x, w.y);
      if (p) { if (!this.selection.has(p.ref)) this.sel = p.ref; this.h.onWheelRotate(this.targets(p.ref), Math.sign(dy)); this.invalidate(); }
      return;
    }
    // pellizcar con dos dedos (llega como Ctrl + ruedita) o Ctrl + ruedita del mouse: zoom donde está el cursor
    if (e.ctrlKey) return this.zoomBy(Math.exp(-e.deltaY * (pad || Math.abs(e.deltaY) < 50 ? 0.012 : 0.0015)), sx, sy);
    // dos dedos en el trackpad: mover la vista (como la mano)
    if (pad) {
      const k = e.deltaMode === 1 ? 16 : 1;
      this.cam.x += e.deltaX * k / this.cam.z; this.cam.y += e.deltaY * k / this.cam.z;
      return this.invalidate();
    }
    this.zoomBy(Math.exp(-dy * 0.0015), sx, sy);
  }
  key(e, isDown) {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
    // Espacio: la mano solo mientras está apretada; al soltar vuelve la herramienta de antes
    if (e.code === 'Space') {
      e.preventDefault();
      if (isDown && !this.space) { this.space = true; if (this.tool !== 'pan') { this.prevTool = this.tool; this.setTool('pan', true); } }
      if (!isDown) this.releaseSpace();
      return this.cursor();
    }
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    // flechas: mover lo seleccionado 1 mm (Shift: 10 mm); sin selección, mueven la vista
    if (k.startsWith('arrow') && !mod) {
      e.preventDefault();
      return isDown ? this.nudge(k, e.shiftKey) : this.nudgeEnd();
    }
    if (!isDown) return;
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); this.h.undo(); return; }
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.h.redo(); return; }
    if (mod && k === 'a') { e.preventDefault(); this.selectAll(); return; }
    // portapapeles: Ctrl+C / Ctrl+X / Ctrl+V (al mouse) / Ctrl+Shift+V o Ctrl+Shift+P (en el mismo lugar)
    if (mod && k === 'c' && this.h.onCopy) { e.preventDefault(); this.h.onCopy(); return; }
    if (mod && k === 'd') { e.preventDefault(); this.sel = null; this.h.onDeselect?.(); return; } // Ctrl+D: deseleccionar (como Photoshop)
    if (mod && k === 'j' && this.h.onDuplicate) { e.preventDefault(); this.h.onDuplicate(); return; } // Ctrl+J: duplicar
    if (mod && k === 'x' && this.h.onCut) { e.preventDefault(); this.h.onCut(); return; }
    if (mod && k === 'v' && this.h.onPaste) { e.preventDefault(); this.h.onPaste(e.shiftKey, this.mouse); return; }
    if (mod && e.shiftKey && k === 'p' && this.h.onPaste) { e.preventDefault(); this.h.onPaste(true, this.mouse); return; }
    if (mod) return;
    if (this.pen) { // pluma en curso
      if (k === 'enter') { e.preventDefault(); return this.penClose(); }
      if (k === 'escape') { this.pen = null; return this.invalidate(); }
      if (k === 'backspace' || k === 'delete') { e.preventDefault(); this.pen.pts.pop(); if (!this.pen.pts.length) this.pen = null; return this.invalidate(); }
    }
    if (k === 'escape') { this.sel = null; return; }
    if (e.altKey) { this.h.onKey?.(e, this, this.mouse); return this.invalidate(); } // Alt+letra: atajos de la app (alinear)
    if (TOOLS[k]) { this.setTool(TOOLS[k]); return; }
    if (k === 'f') { this.fit(); return; }
    if (k === '+' || k === '=') { this.zoomBy(1.25); return; }
    if (k === '-') { this.zoomBy(0.8); return; }
    this.h.onKey?.(e, this, this.mouse);
    this.invalidate();
  }
  cursor() {
    const d = this.drag;
    let c = this.space || this.tool === 'pan' ? 'grab' : this.tool === 'size' ? 'nwse-resize' : this.tool === 'rotate' ? 'alias' : this.tool === 'draw' ? 'crosshair' : this.tool === 'zoom' ? 'zoom-in' : 'default';
    if (d && (d.mode === 'move' || (d.mode === 'pan' && d.moved !== false))) c = 'grabbing';
    if (d?.mode === 'pan' && !d.right) c = 'grabbing';
    this.c.style.cursor = c;
  }
  render() {
    const { ctx, cam } = this, d = devicePixelRatio || 1, z = cam.z;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const mode = matMode();
    ctx.fillStyle = MAT[mode];
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.setTransform(d * z, 0, 0, d * z, d * (this.W / 2 - cam.x * z), d * (this.H / 2 - cam.y * z));
    const a = this.toWorld(0, 0), b = this.toWorld(this.W, this.H);
    const grid = (step, color, px) => {
      if (step * z < 6) return;
      ctx.beginPath();
      for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step) { ctx.moveTo(x, a.y); ctx.lineTo(x, b.y); }
      for (let y = Math.floor(a.y / step) * step; y <= b.y; y += step) { ctx.moveTo(a.x, y); ctx.lineTo(b.x, y); }
      ctx.strokeStyle = color; ctx.lineWidth = px / z; ctx.stroke();
    };
    if (mode === 'dots') { // un punto en cada esquina de la cuadrícula de 1 cm; más marcado cada 5 cm
      const dots = (step, r) => {
        if (step * z < 9) return;
        ctx.fillStyle = MAT.dot;
        const rr = r / z;
        for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step)
          for (let y = Math.floor(a.y / step) * step; y <= b.y; y += step) ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      };
      if (10 * z >= 9) dots(10, 1.1); else dots(50, 1.1);
      dots(50, 1.8);
    } else {
      grid(10, 'rgba(255,255,255,.06)', 1);
      grid(50, 'rgba(255,255,255,.12)', 1);
    }
    const bd = this.h.bounds?.();
    if (bd) {
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      ctx.fillRect(bd.x0, bd.y0, bd.x1 - bd.x0, bd.y1 - bd.y0);
      ctx.setLineDash([10 / z, 7 / z]);
      ctx.strokeStyle = 'rgba(255,250,240,.75)'; ctx.lineWidth = 2 / z;
      ctx.strokeRect(bd.x0, bd.y0, bd.x1 - bd.x0, bd.y1 - bd.y0);
      ctx.setLineDash([]);
      if (!this.h.ownBoundsLabel) {
        ctx.fillStyle = 'rgba(255,250,240,.75)';
        ctx.font = `800 ${13 / z}px Archivo, "Segoe UI", Arial, sans-serif`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(this.h.boundsLabel?.() || 'LIENZO 1 × 1 m', bd.x0, bd.y0 - 6 / z);
      }
    }
    this.h.under?.(ctx, z, this); // se pasa la mesa: en el primer dibujo la app todavía no la tiene guardada
    const L = this.h.list().filter(p => !p.hidden); // las capas ocultas no se dibujan
    for (const p of L) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.ang || 0);
      const pa = p.alpha ?? this.h.pieceAlpha?.() ?? 1; // piezas semitransparentes (para ver lo que hay debajo)
      ctx.globalAlpha = pa;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(-p.w / 2 + 3 / z, -p.h / 2 + 4 / z, p.w, p.h);
      drawPiece(ctx, p, this.h.images);
      ctx.globalAlpha = 1;
      if (p.warn) { ctx.fillStyle = '#d9381a'; ctx.beginPath(); ctx.arc(-p.w / 2 + p.f / 2 + 1, -p.h / 2 + p.f / 2 + 1, Math.max(2, 5 / z), 0, 7); ctx.fill(); }
      if (this.h.isOut ? this.h.isOut(p) : bd && isOutside(p, bd)) { ctx.strokeStyle = '#d9381a'; ctx.lineWidth = 3 / z; ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h); }
      if (this.selection.has(p.ref)) { ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 3 / z; ctx.strokeRect(-p.w / 2 - 2 / z, -p.h / 2 - 2 / z, p.w + 4 / z, p.h + 4 / z); }
      ctx.restore();
    }
    this.h.over?.(ctx, z);
    // marco del grupo: con 2 o más seleccionadas, un recuadro que las encierra a todas
    if (this.selection.size >= 2) {
      const S = L.filter(p => this.selection.has(p.ref));
      if (S.length >= 2) {
        const bx = S.map(p => { const [hw, hh] = extent(p.w, p.h, p.ang); return [p.x - hw, p.y - hh, p.x + hw, p.y + hh]; });
        const pad = 6 / z, x0 = Math.min(...bx.map(b => b[0])) - pad, y0 = Math.min(...bx.map(b => b[1])) - pad, x1 = Math.max(...bx.map(b => b[2])) + pad, y1 = Math.max(...bx.map(b => b[3])) + pad;
        ctx.setLineDash([6 / z, 4 / z]); ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 1.5 / z;
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
        const k = 7 / z; // esquinitas
        for (const [cx, cy] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]) {
          ctx.fillStyle = '#fffaf0'; ctx.fillRect(cx - k / 2, cy - k / 2, k, k);
          ctx.strokeStyle = '#16130f'; ctx.lineWidth = 1.2 / z; ctx.strokeRect(cx - k / 2, cy - k / 2, k, k);
        }
      }
    }
    // guías del imán: líneas rojas finas entre lo que quedó alineado
    if (this.guides?.length) {
      ctx.strokeStyle = '#d9381a'; ctx.lineWidth = 1.2 / z;
      for (const g of this.guides) {
        const e = 14 / z;
        ctx.beginPath();
        if (g.x != null) { ctx.moveTo(g.x, g.a - e); ctx.lineTo(g.x, g.b + e); } else { ctx.moveTo(g.a - e, g.y); ctx.lineTo(g.b + e, g.y); }
        ctx.stroke();
        for (const t of [g.a - e, g.b + e]) { // crucecitas en las puntas
          const s = 3 / z, [px, py] = g.x != null ? [g.x, t] : [t, g.y];
          ctx.beginPath(); ctx.moveTo(px - s, py - s); ctx.lineTo(px + s, py + s); ctx.moveTo(px + s, py - s); ctx.lineTo(px - s, py + s); ctx.stroke();
        }
      }
    }
    // etiqueta con el tamaño (A4 / A5 / A6) arriba de las seleccionadas y de la que está bajo el mouse
    for (const p of L) {
      const isSel = this.selection.has(p.ref), isHover = this.hover === p.ref && !this.drag;
      if (!isSel && !isHover) continue;
      // tamaño fijo en milímetros (como si estuviera impresa en el mat): acompaña al zoom igual que la foto
      const [, hh] = extent(p.w, p.h, p.ang);
      const fs = 9.5, padX = 4.5, th = 16; // mm (como en la mesa a tamaño normal: ~17 % del ancho de una A6)
      if (fs * z < 5) continue; // muy lejos: ilegible, no se dibuja
      ctx.font = `800 ${fs}px Archivo, "Segoe UI", Arial, sans-serif`;
      let txt = p.tag || p.size;
      const maxW = Math.max(p.w, 60) - padX * 2; // nunca más ancha que la foto
      while (txt.length > 6 && ctx.measureText(txt).width > maxW) txt = txt.slice(0, -2) + '…';
      const tw = ctx.measureText(txt).width + padX * 2;
      const tx = p.x - tw / 2, ty = p.y - hh - th - 4;
      ctx.fillStyle = isSel ? '#ffe14d' : 'rgba(255,250,240,.9)';
      ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, th / 2); ctx.fill();
      ctx.fillStyle = '#16130f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, p.x, ty + th / 2 + 0.4);
    }
    const dr = this.drag;
    // mientras se gira: los grados, al lado del mouse
    if (dr?.mode === 'rot' && dr.moved) {
      let deg = Math.round(((dr.lead.r.ang || 0) * 180 / Math.PI) % 360); if (deg > 180) deg -= 360; if (deg <= -180) deg += 360;
      const fs = 13 / z, txt = deg + '°';
      ctx.font = `800 ${fs}px Archivo, "Segoe UI", Arial, sans-serif`;
      const tw = ctx.measureText(txt).width + 12 / z, th = 22 / z, tx = this.mouse.x + 14 / z, ty = this.mouse.y + 10 / z;
      ctx.fillStyle = '#16130f'; ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, th / 2); ctx.fill();
      ctx.fillStyle = '#fffaf0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, tx + tw / 2, ty + th / 2 + 0.5 / z);
    }
    // recuadro de selección / trazo a mano alzada en curso
    if (dr?.mode === 'draw') {
      ctx.beginPath(); dr.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      if (dr.shape !== 'free') ctx.closePath();
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2.5 / z; ctx.lineJoin = ctx.lineCap = 'round'; ctx.stroke();
      if (dr.shape === 'free') {
        ctx.setLineDash([5 / z, 5 / z]); ctx.beginPath(); ctx.moveTo(...dr.pts.at(-1)); ctx.lineTo(...dr.pts[0]);
        ctx.strokeStyle = 'rgba(255,225,77,.6)'; ctx.lineWidth = 1.5 / z; ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (this.pen?.pts.length) { // pluma: tramos hechos, tramo hasta el mouse, cierre punteado y puntos
      const pts = this.pen.pts;
      ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.lineTo(this.mouse.x, this.mouse.y);
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2.5 / z; ctx.lineJoin = ctx.lineCap = 'round'; ctx.stroke();
      if (pts.length >= 2) { ctx.setLineDash([5 / z, 5 / z]); ctx.beginPath(); ctx.moveTo(this.mouse.x, this.mouse.y); ctx.lineTo(...pts[0]); ctx.strokeStyle = 'rgba(255,225,77,.55)'; ctx.lineWidth = 1.5 / z; ctx.stroke(); ctx.setLineDash([]); }
      pts.forEach(([x, y], i) => { const r = (i ? 4 : 7) / z, o = 2 / z; ctx.beginPath(); ctx.arc(x + o, y + o, r, 0, 7); ctx.fillStyle = '#16130f'; ctx.fill(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = i ? '#ffe14d' : '#fffaf0'; ctx.fill(); });
    }
    if (dr?.mode === 'box') {
      const x = Math.min(dr.x0, dr.x1), y = Math.min(dr.y0, dr.y1), w = Math.abs(dr.x1 - dr.x0), h = Math.abs(dr.y1 - dr.y0);
      ctx.fillStyle = 'rgba(255,225,77,.12)'; ctx.fillRect(x, y, w, h);
      ctx.setLineDash([6 / z, 4 / z]); ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 1.5 / z;
      ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    }
  }
}
