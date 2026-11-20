import { BRUSHES, drawStrokes, drawPageText, layoutText, hsvToRgb, rgbToHsv, rgbToHex, hexToRgb } from './art-engine.js';
import { prefs, savePrefs, icon } from './mesa.js';

// Dibujo y texto sobre la mesa. Los motores (pinceles, presión, texto) y la forma de trabajar son los de
// Kyro Zine Generator; el panel sigue el sistema de Neo Board.
// Cada capa de dibujo es un solo objeto con todos sus trazos; los textos son objetos aparte.

export const editingArt = new WeakSet(); // textos en edición: la mesa no los dibuja (se ve el borrador con tiradores)

// Se pinta a la resolución real de la pantalla (antes tenía un tope de 12 px/mm y se pixelaba al acercar).
// Si el dibujo entero entra en 4096 px se guarda en caché; si no, se pinta solo la parte visible.
const paintCache = new WeakMap();
export function paintArt(ctx, art) {
  if (art.kind === 'text') return drawPageText(ctx, art.text, 0, 0, art.w, art.h, 1, false);
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b); if (!k || !art.strokes?.length) return;
  const MAX = 4096; let x0 = 0, y0 = 0, x1 = art.w, y1 = art.h, kk = k;
  if (art.w * k > MAX || art.h * k > MAX) {
    const inv = m.inverse(), W = ctx.canvas.width, H = ctx.canvas.height;
    const pts = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => [inv.a * x + inv.c * y + inv.e, inv.b * x + inv.d * y + inv.f]);
    x0 = Math.max(0, Math.min(...pts.map(p => p[0]))); y0 = Math.max(0, Math.min(...pts.map(p => p[1])));
    x1 = Math.min(art.w, Math.max(...pts.map(p => p[0]))); y1 = Math.min(art.h, Math.max(...pts.map(p => p[1])));
    if (x1 <= x0 || y1 <= y0) return;
    kk = Math.min(k, MAX / (x1 - x0), MAX / (y1 - y0));
  }
  const whole = x0 === 0 && y0 === 0 && x1 === art.w && y1 === art.h, key = kk.toFixed(4);
  let hit = whole && paintCache.get(art);
  if (!hit || hit.key !== key || hit.n !== art.strokes.length) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil((x1 - x0) * kk)); cv.height = Math.max(1, Math.ceil((y1 - y0) * kk));
    drawStrokes(cv.getContext('2d'), art.strokes, 0, 0, cv.width, cv.height, kk, x0 * kk, y0 * kk);
    hit = { key, n: art.strokes.length, cv };
    if (whole) paintCache.set(art, hit);
  }
  ctx.drawImage(hit.cv, x0, y0, hit.cv.width / kk, hit.cv.height / kk);
}

export async function artPNG(art) {
  const c = document.createElement('canvas'), k = Math.min(300 / 25.4, 4096 / Math.max(art.w, art.h));
  c.width = Math.max(1, Math.ceil(art.w * k)); c.height = Math.max(1, Math.ceil(art.h * k));
  const ctx = c.getContext('2d'); ctx.scale(k, k); paintArt(ctx, art);
  return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(Error('No se pudo crear la imagen.')), 'image/png'));
}

const QUICK = ['#16130f', '#fffaf0', '#d9381a', '#ffe14d', '#2b6b58', '#2f5aa8', '#e86aa6', '#f08a24'];
const FONTS = [['ui', 'Archivo', 'Archivo'], ...['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Segoe Print', 'Consolas'].map(f => ['sys:' + f, f, `'${f}'`])];
const DEF = {
  brush: { preset: 'pencil', size: 1.6, opacity: 100, pressure: 100, pressureOpacity: 40, minSize: 8, curve: 100, smoothing: 0, sampling: 70, color: '#16130f' },
  eraser: { preset: 'brush', size: 6, opacity: 100, pressure: 100, pressureOpacity: 0, minSize: 8, curve: 100, smoothing: 0, sampling: 70 },
  text: { font: 'ui', size: 28, color: '#16130f', align: 'left' },
};
// campos numéricos: [etiqueta, unidad, mínimo, máximo, paso de la ruedita]
const FIELDS = {
  size: ['Tamaño', 'mm', .2, 60, .1], opacity: ['Opacidad', '%', 5, 100, 1], smoothing: ['Estabilizar', '%', 0, 90, 1], sampling: ['Muestreo', '%', 0, 100, 1],
  pressure: ['Tamaño', '%', 0, 100, 1], pressureOpacity: ['Opacidad', '%', 0, 100, 1], minSize: ['Mínimo', '%', 0, 90, 1], curve: ['Curva', '%', 30, 250, 5],
  tsize: ['Tamaño', 'pt', 6, 400, 1], trot: ['Rotación', '°', -360, 360, 1],
};
const fmt = v => String(Math.round(v * 10) / 10).replace('.', ',');
const ink = hex => { const [r, g, b] = hexToRgb(hex); return .2126 * r + .7152 * g + .0722 * b > 150 ? '#16130f' : '#fffaf0'; };
const TEXT_PAD = 2; // mm alrededor del texto
const HANDLES = [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]];
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', rot: 'alias' };

function brushSample(canvas, id, color) { // la muestra de cada pincel, con el motor real
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, pts = [];
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push([(W * .08 + t * W * .84) / 3, (H / 2 + Math.sin(t * Math.PI * 2) * H * .2) / 3, .25 + .75 * Math.sin(t * Math.PI)]); }
  let a = 7; BRUSHES[id].draw(ctx, { b: id, c: color, w: H * .28 / 3, o: 1, pr: 1, e: false, seed: 7, p: pts }, 3, color, 1, () => ((a = (a * 16807) % 2147483647) / 2147483647));
}
// Texto libre como en Zine: se ubica por su esquina superior izquierda. fw = ancho de una caja de texto
// (corta las líneas adentro); sin fw es texto de punto (solo corta con Enter).
function textBox(text) {
  const t = { ...text, fx: TEXT_PAD, fy: TEXT_PAD, fw: text.fw || null }, L = layoutText(document.createElement('canvas').getContext('2d'), t, 1, 1, 1);
  return { text: t, w: (t.fw || Math.max(L.sizePx * 2, L.rect.w)) + TEXT_PAD * 2, h: Math.max(L.lineHeight, L.rect.h) + TEXT_PAD * 2 };
}
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

export function mountArtTools({ mesa, commit, commitMany, toast, getList }) {
  const saved = prefs.art || {}, S = { brush: { ...DEF.brush, ...saved.brush }, eraser: { ...DEF.eraser, ...saved.eraser }, text: { ...DEF.text, ...saved.text } };
  if (!saved.brush && prefs.artColor) S.brush.color = prefs.artColor;
  const keep = () => { prefs.art = S; savePrefs(); };
  const nf = key => { const [l, u] = FIELDS[key]; return `<label class="art-nf" data-nf="${key}"><span class="art-nf-l">${l}</span><input type="text" inputmode="decimal" aria-label="${l}"><i>${u}</i></label>`; };
  const panel = document.createElement('aside'); panel.className = 'art-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Dibujo y texto');
  panel.innerHTML = `<header class="art-head"><b data-title>Dibujo</b>
    <div class="art-seg" role="group" aria-label="Herramienta">
      <button type="button" data-mode="brush" aria-label="Pincel" data-tip="Pincel · B|Alt + ruedita: tamaño">${icon('pencil')}</button>
      <button type="button" data-mode="eraser" aria-label="Goma" data-tip="Goma · E|Borra solo dibujos">${icon('eraser')}</button>
      <button type="button" data-mode="text" aria-label="Texto" data-tip="Texto · T|Clic: texto · Arrastrar: caja de texto">${icon('type')}</button>
    </div><button type="button" class="cb-x" data-close aria-label="Cerrar" data-tip="Cerrar · Esc">${icon('x')}</button></header>
    <div class="art-row art-top" data-sec="top"><button type="button" class="art-color" data-colorbtn aria-label="Color" data-tip="Color"></button>
      <div class="art-layer" data-sec="layer"><span data-layer></span><button type="button" class="art-round" data-newlayer aria-label="Capa nueva" data-tip="Capa nueva|Los próximos trazos van a otro dibujo">${icon('plus')}</button></div></div>
    <section class="art-cp" data-sec="picker" hidden><div class="art-quick">${QUICK.map(c => `<button type="button" class="art-sw" data-color="${c}" style="--c:${c};--i:${ink(c)}" aria-label="Color ${c}">${icon('check')}</button>`).join('')}</div>
      <canvas data-sv width="368" height="220" aria-label="Saturación y luz"></canvas><canvas data-hue width="368" height="24" aria-label="Tono"></canvas>
      <div class="art-row"><input data-hex maxlength="7" aria-label="Color hexadecimal" spellcheck="false"><button type="button" class="art-round" data-drop aria-label="Cuentagotas" data-tip="Cuentagotas|Tomá un color de la pantalla">${icon('pipette')}</button></div></section>
    <section data-sec="draw"><div class="art-brushes">${Object.entries(BRUSHES).map(([id, b]) => `<button type="button" class="art-brush" data-brush="${id}"><canvas width="150" height="42"></canvas><span>${b.name}</span></button>`).join('')}</div>
      <div class="art-group"><span class="art-sub">Trazo</span>${nf('size')}${nf('opacity')}${nf('smoothing')}${nf('sampling')}</div>
      <div class="art-group"><span class="art-sub">Presión<span class="art-pen" data-pen></span></span>${nf('pressure')}${nf('pressureOpacity')}${nf('minSize')}${nf('curve')}</div></section>
    <section data-sec="text"><div class="art-group0"><span class="art-sub">Contenido</span><textarea rows="3" maxlength="8000" aria-label="Contenido del texto" spellcheck="true"></textarea></div>
      <div class="art-group"><span class="art-sub">Letra</span><select data-font aria-label="Fuente">${FONTS.map(([v, l, css]) => `<option value="${v}" style="font-family:${css}">${l}</option>`).join('')}</select>${nf('tsize')}${nf('trot')}</div>
      <div class="art-group"><span class="art-sub">Párrafo</span><div class="art-seg art-align" role="group" aria-label="Alineación">
        <button type="button" data-align="left" aria-label="A la izquierda" data-tip="A la izquierda">${icon('alignLeft')}</button>
        <button type="button" data-align="center" aria-label="Centrado" data-tip="Centrado">${icon('alignHC')}</button>
        <button type="button" data-align="right" aria-label="A la derecha" data-tip="A la derecha">${icon('alignRight')}</button></div></div></section>`;
  document.body.append(panel);
  const q = s => panel.querySelector(s), all = s => [...panel.querySelectorAll(s)], area = q('textarea');
  let saving = Promise.resolve(), pending = [], mode = 'brush', draft = null, tdraft = null, op = null, busy = false, cpHSV = [0, 0, 0], pen = '', layerId = null;
  const drawMode = () => mode === 'brush' || mode === 'eraser';
  const colorOf = () => mode === 'text' ? (tdraft?.text.color || S.text.color) : S.brush.color;
  const pieceOf = id => getList().find(p => p.ref.id === id) || null;
  const currentLayer = () => { const p = layerId && pieceOf(layerId); return p && p.ref.art?.kind === 'ink' && !p.hidden ? p : null; };

  // ---------- panel ----------
  function render() {
    q('[data-title]').textContent = mode === 'text' ? 'Texto' : mode === 'eraser' ? 'Goma' : 'Dibujo';
    all('[data-mode]').forEach(b => { b.classList.toggle('on', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
    const c = colorOf().toLowerCase(), btn = q('[data-colorbtn]');
    btn.style.setProperty('--c', c); btn.hidden = mode === 'eraser'; if (mode === 'eraser') q('[data-sec=picker]').hidden = true;
    all('[data-color]').forEach(b => b.classList.toggle('on', b.dataset.color === c));
    const layer = currentLayer(); q('[data-sec=layer]').hidden = !drawMode(); q('[data-layer]').textContent = layer ? layer.ref.art.name || 'Capa' : 'Capa nueva';
    q('[data-sec=top]').hidden = mode === 'text';
    q('[data-sec=draw]').hidden = !drawMode(); q('[data-sec=text]').hidden = mode !== 'text';
    if (drawMode()) {
      const st = S[mode];
      all('[data-brush]').forEach(b => { b.classList.toggle('on', b.dataset.brush === st.preset); brushSample(b.querySelector('canvas'), b.dataset.brush, mode === 'eraser' ? '#5f5849' : st.color); });
    } else {
      const t = tdraft?.text || S.text; q('[data-font]').value = t.font; q('[data-font]').style.fontFamily = (FONTS.find(f => f[0] === t.font) || FONTS[0])[2];
      all('[data-align]').forEach(b => b.classList.toggle('on', b.dataset.align === t.align));
      if (document.activeElement !== area) area.value = tdraft?.text.content || '';
      q('[data-tcolor]').style.setProperty('--c', c);
    }
    all('[data-nf]').forEach(el => { const input = el.querySelector('input'); if (document.activeElement !== input) input.value = fmt(get(el.dataset.nf)); });
    q('[data-pen]').textContent = pen;
  }
  // en Texto, el color va al lado de la fuente (como en Zine)
  { const sel = q('[data-font]'), row = document.createElement('div'); row.className = 'art-row'; sel.replaceWith(row); row.append(sel);
    row.insertAdjacentHTML('beforeend', `<button type="button" class="art-color" data-tcolor aria-label="Color del texto" data-tip="Color"></button>`); }
  function get(key) {
    if (key === 'tsize') return tdraft?.text.size ?? S.text.size;
    if (key === 'trot') return tdraft ? Math.round(tdraft.ang * 180 / Math.PI * 10) / 10 : 0;
    return S[mode === 'eraser' ? 'eraser' : 'brush'][key];
  }
  function set(key, v) {
    const [, , min, max] = FIELDS[key], grain = key === 'size' ? .1 : 1; v = Math.round(Math.max(min, Math.min(max, v)) / grain) * grain;
    if (key === 'tsize') { S.text.size = v; if (tdraft) { tdraft.text.size = v; mesa.invalidate(); } }
    else if (key === 'trot') { if (tdraft) { const c = center(tdraft); tdraft.ang = v * Math.PI / 180; placeCenter(tdraft, c); mesa.invalidate(); } }
    else S[mode === 'eraser' ? 'eraser' : 'brush'][key] = +v.toFixed(2);
    keep(); render();
  }
  // Campos como en Zine: escribir, ruedita (Shift: de a más), flechas, o arrastrar la etiqueta hacia los costados.
  all('[data-nf]').forEach(el => {
    const key = el.dataset.nf, input = el.querySelector('input'), lab = el.querySelector('.art-nf-l');
    const step = () => key === 'size' ? (get(key) < 3 ? .1 : get(key) < 10 ? .5 : 1) : FIELDS[key][4];
    input.addEventListener('change', () => { const v = parseFloat(input.value.replace(',', '.')); if (Number.isFinite(v)) set(key, v); else input.value = fmt(get(key)); });
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(key, get(key) + (e.key === 'ArrowUp' ? 1 : -1) * step() * (e.shiftKey ? 10 : 1)); } });
    el.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); if (document.activeElement === input) input.blur(); set(key, get(key) + (e.deltaY < 0 ? 1 : -1) * step() * (e.shiftKey ? 5 : 1)); }, { passive: false });
    lab.addEventListener('pointerdown', e => {
      e.preventDefault(); const x0 = e.clientX, v0 = get(key), s0 = step(); lab.setPointerCapture(e.pointerId);
      const move = ev => set(key, v0 + (ev.clientX - x0) * s0 * (ev.shiftKey ? 5 : .5));
      const up = () => { lab.removeEventListener('pointermove', move); lab.removeEventListener('pointerup', up); lab.removeEventListener('pointercancel', up); };
      lab.addEventListener('pointermove', move); lab.addEventListener('pointerup', up); lab.addEventListener('pointercancel', up);
    });
  });
  function setColor(hex) {
    hex = hex.toLowerCase();
    if (mode === 'text') { S.text.color = hex; if (tdraft) { tdraft.text.color = hex; mesa.invalidate(); } } else S.brush.color = hex;
    keep(); render();
  }
  // color: muestras rápidas, cuadro de saturación/luz, barra de tono, código y cuentagotas
  const sv = q('[data-sv]'), hue = q('[data-hue]'), hexIn = q('[data-hex]');
  function paintPicker() {
    const [h, s, v] = cpHSV, a = sv.getContext('2d'), W = sv.width, H = sv.height;
    a.fillStyle = rgbToHex(...hsvToRgb(h, 1, 1)); a.fillRect(0, 0, W, H);
    let g = a.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); a.fillStyle = g; a.fillRect(0, 0, W, H);
    g = a.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000'); a.fillStyle = g; a.fillRect(0, 0, W, H);
    const x = s * W, y = (1 - v) * H; a.fillStyle = '#16130f'; a.beginPath(); a.arc(x + 3, y + 3, 11, 0, 7); a.fill(); a.fillStyle = rgbToHex(...hsvToRgb(h, s, v)); a.beginPath(); a.arc(x, y, 11, 0, 7); a.fill();
    const b = hue.getContext('2d'); g = b.createLinearGradient(0, 0, hue.width, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, rgbToHex(...hsvToRgb(i * 60 % 360, 1, 1)));
    b.clearRect(0, 0, hue.width, hue.height); b.fillStyle = g; b.beginPath(); b.roundRect(0, 4, hue.width, hue.height - 8, 8); b.fill();
    b.fillStyle = '#16130f'; b.fillRect(h / 360 * hue.width - 3, 0, 8, hue.height); b.fillStyle = '#fffaf0'; b.fillRect(h / 360 * hue.width - 4, 0, 6, hue.height - 2);
    if (document.activeElement !== hexIn) hexIn.value = rgbToHex(...hsvToRgb(h, s, v));
  }
  function togglePicker(anchor) {
    const p = q('[data-sec=picker]'), open = p.hidden || p.previousElementSibling !== anchor.closest('.art-row, .art-top');
    if (!open) { p.hidden = true; return; }
    anchor.closest('.art-row').after(p); p.hidden = false; // el selector se abre debajo del botón que se tocó
    cpHSV = rgbToHsv(...hexToRgb(colorOf())); paintPicker();
  }
  const drag = (el, fn) => el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId); const pick = ev => { const r = el.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))); paintPicker(); setColor(rgbToHex(...hsvToRgb(...cpHSV))); };
    pick(e); const up = () => { el.removeEventListener('pointermove', pick); el.removeEventListener('pointerup', up); }; el.addEventListener('pointermove', pick); el.addEventListener('pointerup', up);
  });
  drag(sv, (x, y) => { cpHSV[1] = x; cpHSV[2] = 1 - y; }); drag(hue, x => { cpHSV[0] = Math.min(359.9, x * 360); });
  hexIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') hexIn.blur(); });
  hexIn.addEventListener('change', () => { let h = hexIn.value.trim(); if (!h.startsWith('#')) h = '#' + h; if (/^#[0-9a-f]{6}$/i.test(h)) { cpHSV = rgbToHsv(...hexToRgb(h)); paintPicker(); setColor(h); } else hexIn.value = colorOf(); });
  const drop = q('[data-drop]'); drop.hidden = !('EyeDropper' in window);
  drop.onclick = async () => { try { const r = await new EyeDropper().open(); cpHSV = rgbToHsv(...hexToRgb(r.sRGBHex)); paintPicker(); setColor(r.sRGBHex); } catch {} };

  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.mode) return mesa.setTool(b.dataset.mode);
    if (b.hasAttribute('data-close')) return close();
    if (b.dataset.color) { cpHSV = rgbToHsv(...hexToRgb(b.dataset.color)); paintPicker(); return setColor(b.dataset.color); }
    if (b.hasAttribute('data-colorbtn') || b.hasAttribute('data-tcolor')) return togglePicker(b);
    if (b.hasAttribute('data-newlayer')) return newLayer();
    if (b.dataset.brush) { S[mode === 'eraser' ? 'eraser' : 'brush'].preset = b.dataset.brush; keep(); return render(); }
    if (b.dataset.align) { S.text.align = b.dataset.align; if (tdraft) { tdraft.text.align = b.dataset.align; mesa.invalidate(); } keep(); return render(); }
  });
  q('[data-font]').onchange = e => { S.text.font = e.target.value; if (tdraft) { tdraft.text.font = e.target.value; document.fonts.ready.then(() => mesa.invalidate()); } keep(); render(); };
  area.addEventListener('input', () => { if (tdraft) { tdraft.text.content = area.value; mesa.invalidate(); } });
  area.addEventListener('keydown', e => {
    e.stopPropagation();
    if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || e.key === 'Escape') { e.preventDefault(); finishText(); }
  });

  function close() { finishText(); panel.hidden = true; mesa.setTool('move'); }
  const show = t => { mode = t; panel.hidden = false; q('[data-sec=picker]').hidden = true; render(); };
  function newLayer() { finishText(); layerId = null; if (!drawMode()) mesa.setTool('brush'); mesa.selection = new Set(); mesa.selChanged?.(); render(); mesa.invalidate(); }
  const oldTool = mesa.h.onTool;
  mesa.h.onTool = t => {
    oldTool?.(t);
    document.querySelector('.bar [data-tool=brush]')?.classList.toggle('on', t === 'brush' || t === 'eraser');
    if (t !== 'text' && tdraft) finishText();
    if (['brush', 'eraser', 'text'].includes(t)) show(t); else { panel.hidden = true; q('[data-sec=picker]').hidden = true; }
    mesa.invalidate();
  };
  const oldSelect = mesa.h.onSelect; // elegir una capa de dibujo (en la mesa o en el panel): ahí van los trazos siguientes
  mesa.h.onSelect = () => { oldSelect?.(); const sel = mesa.selRefs(); if (sel.length === 1 && sel[0].art?.kind === 'ink') { layerId = sel[0].id; if (!panel.hidden) render(); } };

  // ---------- dibujo ----------
  const world = e => { const r = mesa.c.getBoundingClientRect(); return mesa.toWorld(e.clientX - r.left, e.clientY - r.top); };
  const stop = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  function pressure(e) {
    const info = e.pointerType === 'pen' ? `Tableta · ${Math.round((e.pressure || 0) * 100)}%` : e.pointerType === 'touch' ? 'Dedo' : 'Mouse';
    if (info !== pen) { pen = info; q('[data-pen]').textContent = info; }
    return e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : .5) : null;
  }
  // de la mesa a las coordenadas de un objeto (y al revés), con su giro y su escala
  function frame(p) {
    const it = p.ref, art = it.art, odd = it.rot % 2, k = ((odd ? p.h : p.w) / art.w) || 1, a = (p.ang || 0) + it.rot * Math.PI / 2;
    return {
      k, toLocal: (x, y) => { const [lx, ly] = rot(x - p.x, y - p.y, -a); return [lx / k + art.w / 2, ly / k + art.h / 2]; },
      toWorld: (lx, ly) => { const [dx, dy] = rot((lx - art.w / 2) * k, (ly - art.h / 2) * k, a); return [p.x + dx, p.y + dy]; },
    };
  }
  mesa.c.addEventListener('pointerdown', e => {
    if (!['brush', 'eraser', 'text'].includes(mesa.tool) || e.button !== 0 || (busy && mesa.tool === 'text')) return;
    stop(e); const p = world(e);
    if (mesa.tool === 'text') return textDown(e, p);
    const bs = S[mesa.tool], eraser = mesa.tool === 'eraser';
    draft = {
      st: { b: bs.preset, c: eraser ? '#000000' : bs.color, w: bs.size, o: bs.opacity / 100, pr: bs.pressure / 100, po: bs.pressureOpacity / 100, pm: bs.minSize / 100, pg: bs.curve / 100, e: eraser, seed: (Math.random() * 1e9) | 0, p: [[p.x, p.y, pressure(e)]] },
      // muestreo 0..100 → distancia mínima entre puntos guardados: 1,2 mm … 0,04 mm
      minD: 1.2 * Math.pow(.04 / 1.2, bs.sampling / 100), sm: Math.min(.92, bs.smoothing / 100),
    };
    mesa.c.setPointerCapture(e.pointerId); mesa.invalidate();
  }, true);
  const onMove = e => {
    if (e.currentTarget === window && e.target === mesa.c) return; // ya lo atendió la mesa
    if (op) { stop(e); textMove(e, world(e)); return; }
    if (mesa.tool === 'text' && tdraft) { const h = textHit(tdraft, world(e)); if (h) { stop(e); mesa.c.style.cursor = CURSORS[h]; return; } }
    if (!draft) { if (drawMode() && !panel.hidden) mesa.invalidate(); return; } // el anillo del tamaño sigue al puntero
    stop(e);
    const evs = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];
    for (const ev of evs) {
      const w = world(ev), pt = [w.x, w.y, pressure(ev)], last = draft.st.p.at(-1);
      if (draft.sm) { pt[0] = last[0] + (pt[0] - last[0]) * (1 - draft.sm); pt[1] = last[1] + (pt[1] - last[1]) * (1 - draft.sm); } // estabilizador
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) > draft.minD) draft.st.p.push(pt);
    }
    mesa.invalidate();
  };
  // mientras se dibuja o se mueve un texto, el puntero se sigue en toda la ventana (aunque pase por encima del panel)
  mesa.c.addEventListener('pointermove', onMove, true); addEventListener('pointermove', e => { if (draft || op) onMove(e); }, true);
  mesa.c.addEventListener('pointercancel', () => { draft = null; op = null; mesa.invalidate(); }, true);
  const onUp = e => {
    if (op) { stop(e); textUp(world(e)); return; }
    if (!draft) return; stop(e); const st = draft.st; draft = null;
    try { mesa.c.releasePointerCapture(e.pointerId); } catch {}
    pending.push(st); mesa.invalidate();
    // en fila: el trazo siguiente se puede empezar mientras se guarda el anterior, y ninguno se pierde
    saving = saving.then(async () => { try { if (st.e) await erase(st); else await addStroke(st); } catch (error) { toast(error.message, 5000); } finally { pending.splice(pending.indexOf(st), 1); mesa.invalidate(); } });
  };
  mesa.c.addEventListener('pointerup', onUp, true); addEventListener('pointerup', e => { if ((draft || op) && e.target !== mesa.c) onUp(e); }, true);
  mesa.c.addEventListener('pointerleave', () => { if (drawMode()) mesa.invalidate(); });
  // Alt + ruedita sobre la mesa: tamaño del pincel o de la goma (la ruedita sola sigue moviendo la vista)
  mesa.c.addEventListener('wheel', e => {
    if (!e.altKey || !drawMode() || panel.hidden) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const v = S[mode].size, step = v < 3 ? .1 : v < 10 ? .5 : 1;
    set('size', v + (e.deltaY < 0 ? 1 : -1) * step * (e.shiftKey ? 5 : 1)); mesa.invalidate();
  }, { capture: true, passive: false });
  // El trazo se suma a la capa actual (que crece si hace falta); si no hay, se crea una capa nueva.
  async function addStroke(st) {
    const layer = currentLayer();
    if (!layer) {
      const pad = st.w * 3, xs = st.p.map(p => p[0]), ys = st.p.map(p => p[1]), x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
      const w = Math.max(...xs) - x0 + pad, h = Math.max(...ys) - y0 + pad, used = new Set(getList().map(p => p.ref.art?.name));
      let n = 1; while (used.has('Capa ' + n)) n++;
      const item = await commit({ kind: 'ink', name: 'Capa ' + n, w, h, strokes: [{ ...st, p: st.p.map(([x, y, p]) => [x - x0, y - y0, p]) }] }, { x: x0 + w / 2, y: y0 + h / 2 }, null, { select: false });
      layerId = item?.id || null; render(); return;
    }
    const it = layer.ref, art = it.art, f = frame(layer), w = st.w / f.k, pad = w * 3;
    const pts = st.p.map(([x, y, pr]) => [...f.toLocal(x, y), pr]), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(0, Math.min(...xs) - pad), y0 = Math.min(0, Math.min(...ys) - pad), x1 = Math.max(art.w, Math.max(...xs) + pad), y1 = Math.max(art.h, Math.max(...ys) + pad);
    const shift = s => ({ ...s, p: s.p.map(([x, y, pr]) => [x - x0, y - y0, pr]) });
    const next = { ...art, w: x1 - x0, h: y1 - y0, strokes: [...art.strokes.map(s => x0 || y0 ? shift(s) : s), shift({ ...st, w, p: pts })] };
    const [cx, cy] = f.toWorld((x0 + x1) / 2, (y0 + y1) / 2);
    await commit(next, { x: cx, y: cy }, it, { select: false });
  }
  // La goma suma un trazo que borra (destination-out) a cada capa que toca, en las coordenadas de esa capa.
  async function erase(st) {
    const xs = st.p.map(p => p[0]), ys = st.p.map(p => p[1]), r = st.w;
    const box = { x0: Math.min(...xs) - r, y0: Math.min(...ys) - r, x1: Math.max(...xs) + r, y1: Math.max(...ys) + r }, changes = [];
    for (const p of getList()) {
      const it = p.ref, art = it.art; if (art?.kind !== 'ink' || p.hidden) continue;
      const rad = Math.hypot(p.w, p.h) / 2; if (p.x + rad < box.x0 || p.x - rad > box.x1 || p.y + rad < box.y0 || p.y - rad > box.y1) continue;
      const f = frame(p), pts = st.p.map(([x, y, pr]) => [...f.toLocal(x, y), pr]), m = st.w / f.k;
      if (!pts.some(([x, y]) => x > -m && y > -m && x < art.w + m && y < art.h + m)) continue;
      changes.push({ art: { ...art, strokes: [...art.strokes, { ...st, w: st.w / f.k, p: pts }] }, existing: it });
    }
    if (changes.length) await commitMany(changes);
  }

  // ---------- texto (como en Zine) ----------
  // tdraft = { text, ang, tl (esquina superior izquierda en la mesa), existing }
  const boxOf = d => textBox(d.text);
  function center(d) { const b = boxOf(d), [dx, dy] = rot(b.w / 2, b.h / 2, d.ang); return { x: d.tl.x + dx, y: d.tl.y + dy }; }
  function placeCenter(d, c) { const b = boxOf(d), [dx, dy] = rot(b.w / 2, b.h / 2, d.ang); d.tl = { x: c.x - dx, y: c.y - dy }; }
  const fromBox = (d, x, y) => { const [dx, dy] = rot(x, y, d.ang); return { x: d.tl.x + dx, y: d.tl.y + dy }; };
  function textHit(d, P) {
    const b = boxOf(d), z = mesa.cam.z, [lx, ly] = rot(P.x - d.tl.x, P.y - d.tl.y, -d.ang), tol = 8 / z;
    for (const [id, hx, hy] of HANDLES) if (Math.hypot(lx - hx * b.w, ly - hy * b.h) < tol) return id;
    if (lx >= 0 && ly >= 0 && lx <= b.w && ly <= b.h) return 'move';
    for (const [, hx, hy] of HANDLES) if (hx !== .5 && hy !== .5 && Math.hypot(lx - hx * b.w, ly - hy * b.h) < 30 / z) return 'rot'; // afuera de una esquina: girar
    return null;
  }
  function editItem(it) {
    const p = pieceOf(it.id); if (!p) return;
    const art = it.art, k = ((it.rot % 2 ? p.h : p.w) / art.w) || 1, t = art.text || {};
    const text = { content: t.content || '', font: t.font || 'ui', size: (t.size || 28) * k, color: t.color || '#16130f', align: t.align || 'left', fw: t.fx != null ? (t.fw ? t.fw * k : null) : Math.max(8, art.w - 16) * k };
    tdraft = { text, ang: (p.ang || 0) + it.rot * Math.PI / 2, existing: it, tl: { x: 0, y: 0 } };
    placeCenter(tdraft, { x: p.x, y: p.y }); editingArt.add(it);
    mesa.selection = new Set(); mesa.selChanged?.();
  }
  function textDown(e, P) {
    mesa.c.setPointerCapture(e.pointerId);
    if (tdraft) { const h = textHit(tdraft, P); if (h) { op = startOp(h, P); return; } }
    const hit = mesa.hit(P.x, P.y);
    finishText();
    if (hit?.ref.art?.kind === 'text') { editItem(hit.ref); op = startOp('move', P); render(); mesa.invalidate(); return; }
    op = { type: 'new', P0: P, P1: P };
  }
  function startOp(type, P) {
    const d = tdraft, b = boxOf(d);
    const o = { type, P0: P, tl0: { ...d.tl }, ang0: d.ang, size0: d.text.size, fw0: d.text.fw, w0: b.w, h0: b.h, c0: center(d), moved: false };
    const hd = HANDLES.find(h => h[0] === type);
    if (hd) { o.hx = hd[1]; o.hy = hd[2]; o.ax = 1 - hd[1]; o.ay = 1 - hd[2]; o.anchor = fromBox(d, o.ax * b.w, o.ay * b.h); }
    return o;
  }
  function textMove(e, P) {
    if (op.type === 'new') { op.P1 = P; mesa.invalidate(); return; }
    const d = tdraft; if (!d) return; op.moved = true;
    if (op.type === 'move') d.tl = { x: op.tl0.x + P.x - op.P0.x, y: op.tl0.y + P.y - op.P0.y };
    else if (op.type === 'rot') {
      let a = op.ang0 + Math.atan2(P.y - op.c0.y, P.x - op.c0.x) - Math.atan2(op.P0.y - op.c0.y, op.P0.x - op.c0.x);
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      d.ang = a; placeCenter(d, op.c0);
    } else {
      const [lx, ly] = rot(P.x - op.anchor.x, P.y - op.anchor.y, -d.ang);
      if (op.hy === .5) d.text.fw = Math.max(8, Math.abs(lx) - TEXT_PAD * 2); // costados: ancho de la caja (el texto se reacomoda)
      else {
        const dx = op.hx === .5 ? 0 : (op.hx - op.ax) * op.w0, dy = (op.hy - op.ay) * op.h0;
        const k = Math.max(.05, (lx * dx + ly * dy) / (dx * dx + dy * dy || 1));
        d.text.size = Math.max(6, Math.min(400, Math.round(op.size0 * k * 10) / 10)); if (op.fw0) d.text.fw = op.fw0 * k;
      }
      const b = boxOf(d), [ax, ay] = rot(op.ax * b.w, op.ay * b.h, d.ang); d.tl = { x: op.anchor.x - ax, y: op.anchor.y - ay }; // la esquina opuesta queda quieta
    }
    render(); mesa.invalidate();
  }
  function textUp(P) {
    const o = op; op = null;
    if (o.type === 'new') {
      const dx = P.x - o.P0.x, isArea = Math.abs(dx) > Math.max(5, 12 / mesa.cam.z);
      tdraft = { text: { content: '', font: S.text.font, size: S.text.size, color: S.text.color, align: S.text.align, fw: isArea ? Math.abs(dx) - TEXT_PAD * 2 : null }, ang: 0, existing: null, tl: { x: Math.min(P.x, o.P0.x), y: isArea ? Math.min(P.y, o.P0.y) : o.P0.y } };
      render(); mesa.invalidate();
    }
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(area.value.length, area.value.length); });
  }
  async function finishText() {
    if (!tdraft || busy) return; const d = tdraft; tdraft = null; op = null;
    if (document.activeElement === area) area.blur();
    const content = d.text.content, b = boxOf(d), c = center(d), it = d.existing;
    render();
    if (!content.trim()) { if (it) editingArt.delete(it); mesa.invalidate(); return; }
    const art = { kind: 'text', w: b.w, h: b.h, text: b.text };
    const same = it && JSON.stringify(it.art.text) === JSON.stringify(b.text) && Math.abs(it.x - c.x) < .01 && Math.abs(it.y - c.y) < .01 && Math.abs((it.ang || 0) + it.rot * Math.PI / 2 - d.ang) < 1e-6;
    if (same) { editingArt.delete(it); mesa.invalidate(); return; }
    busy = true;
    try { await document.fonts.ready; await commit(art, { x: c.x, y: c.y, ang: d.ang }, it); }
    catch (error) { toast(error.message, 5000); } finally { if (it) editingArt.delete(it); busy = false; mesa.invalidate(); }
  }
  mesa.c.addEventListener('dblclick', e => {
    const p = world(e), hit = mesa.hit(p.x, p.y);
    if (hit?.ref.art?.kind !== 'text') return;
    stop(e); finishText(); if (mesa.tool !== 'text') mesa.setTool('text');
    editItem(hit.ref); render(); mesa.invalidate(); requestAnimationFrame(() => area.focus());
  }, true);

  // ---------- vista previa sobre la mesa ----------
  function previewStroke(ctx, st) {
    const pad = st.w * 3, xs = st.p.map(p => p[0]), ys = st.p.map(p => p[1]), x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    ctx.save(); ctx.translate(x0, y0); paintArt(ctx, { kind: 'ink', w: Math.max(...xs) - x0 + pad, h: Math.max(...ys) - y0 + pad, strokes: [{ ...st, p: st.p.map(([x, y, p]) => [x - x0, y - y0, p]) }] }); ctx.restore();
  }
  const over = mesa.h.over;
  mesa.h.over = (ctx, z) => {
    over?.(ctx, z);
    for (const st of pending) if (!st.e) previewStroke(ctx, st);
    if (draft) {
      const st = draft.st, pad = st.w * 3, xs = st.p.map(p => p[0]), ys = st.p.map(p => p[1]), x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
      const art = { kind: 'ink', w: Math.max(...xs) - x0 + pad, h: Math.max(...ys) - y0 + pad, strokes: [{ ...st, e: false, c: st.e ? '#fffaf0' : st.c, o: st.e ? .85 : st.o, p: st.p.map(([x, y, p]) => [x - x0, y - y0, p]) }] };
      ctx.save(); ctx.translate(x0, y0); paintArt(ctx, art); ctx.restore();
    } else if (drawMode() && !panel.hidden && mesa.mouse && mesa.c.matches(':hover')) { // anillo con el tamaño del pincel
      const r = Math.max(1.5 / z, S[mode].size / 2);
      ctx.save(); ctx.lineWidth = 2 / z; ctx.strokeStyle = '#fffaf0'; ctx.beginPath(); ctx.arc(mesa.mouse.x, mesa.mouse.y, r, 0, 7); ctx.stroke();
      ctx.lineWidth = 1 / z; ctx.strokeStyle = '#16130f'; ctx.beginPath(); ctx.arc(mesa.mouse.x, mesa.mouse.y, r, 0, 7); ctx.stroke(); ctx.restore();
    }
    if (op?.type === 'new') { const a = op.P0, b = op.P1; ctx.save(); ctx.lineWidth = 1.5 / z; ctx.setLineDash([6 / z, 4 / z]); ctx.strokeStyle = '#d9381a'; ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.restore(); }
    if (tdraft) { // el texto con su caja punteada y los ocho tiradores, como en Zine
      const b = boxOf(tdraft);
      ctx.save(); ctx.translate(tdraft.tl.x, tdraft.tl.y); ctx.rotate(tdraft.ang);
      drawPageText(ctx, b.text, 0, 0, b.w, b.h, 1, true);
      ctx.lineWidth = 1.5 / z; ctx.setLineDash([6 / z, 4 / z]); ctx.strokeStyle = '#d9381a'; ctx.strokeRect(0, 0, b.w, b.h); ctx.setLineDash([]);
      const s = 8 / z; ctx.lineWidth = 1.2 / z; ctx.strokeStyle = '#16130f'; ctx.fillStyle = '#fff';
      for (const [, hx, hy] of HANDLES) { ctx.fillRect(hx * b.w - s / 2, hy * b.h - s / 2, s, s); ctx.strokeRect(hx * b.w - s / 2, hy * b.h - s / 2, s, s); }
      ctx.restore();
    }
  };

  document.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Escape' && !panel.hidden) { close(); return; }
    const t = { b: 'brush', t: 'text', e: 'eraser' }[e.key.toLowerCase()];
    if (t) { e.preventDefault(); mesa.setTool(t); }
  });
  return {
    get draft() { return draft; }, get text() { return tdraft && { ...tdraft.text, ang: tdraft.ang }; }, get layer() { return layerId; }, finishText, newLayer, settings: S,
    textHandles: () => tdraft && HANDLES.map(([id, hx, hy]) => { const b = boxOf(tdraft); return [id, fromBox(tdraft, hx * b.w, hy * b.h)]; }),
  };
}
