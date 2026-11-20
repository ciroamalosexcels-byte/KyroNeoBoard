import { drawPrintPage, placedHull } from './illusion-engine.js';

// Vista previa de impresión de la ilusión: todas las hojas sobre el mat, como la vista
// previa común. Se toca una pieza y se arrastra una esquina para cambiar el tamaño.
const INK = '#16130f', HL = '#ffe14d', STAMP = '#d9381a', PAPER = '#fffaf0';
const DPI_STEPS = [36, 54, 80, 120, 160];
const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };

export function createSheetBoard(canvas, stage, { onPick = () => {}, onScale = () => {}, onPage = () => {} } = {}) {
  const view = { zoom: 1, panX: 0, panY: 0 };
  let state = null, version = 0, cache = new Map(), grid = null, destroyed = false, raf = 0, sharpen = 0;
  const active = () => !destroyed && stage.classList.contains('is-board') && stage.clientWidth > 0;
  const dpr = () => Math.min(2, devicePixelRatio || 1);

  function arrange() { // columnas que aprovechan mejor el espacio
    const L = state.layout, n = L.pages.length, gap = Math.max(14, L.w * .08), W = stage.clientWidth - 48, H = stage.clientHeight - 64;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols), tw = cols * L.w + (cols - 1) * gap, th = rows * L.h + (rows - 1) * (gap + 22), k = Math.min(W / tw, H / th);
      if (!best || k > best.k) best = { cols, rows, tw, th, k };
    }
    grid = { ...best, gap, n, w: L.w, h: L.h, pos: L.pages.map((_, i) => [(i % best.cols) * (L.w + gap), Math.floor(i / best.cols) * (L.h + gap + 22)]) };
  }
  // mm del tablero ↔ píxeles del canvas
  const scale = () => grid.k * view.zoom * dpr();
  const origin = () => { const s = scale(); return [canvas.width / 2 - grid.tw * s / 2 + view.panX * dpr(), canvas.height / 2 - grid.th * s / 2 + view.panY * dpr()]; };
  const toScreen = (i, p) => { const s = scale(), o = origin(); return [o[0] + (grid.pos[i][0] + p[0]) * s, o[1] + (grid.pos[i][1] + p[1]) * s]; };
  const toBoard = (x, y) => { const s = scale(), o = origin(); return [(x * dpr() - o[0]) / s, (y * dpr() - o[1]) / s]; };

  let hiRes = false;
  function pageBitmap(i) { // cada hoja se dibuja una vez; al acercar se repinta más nítida después de un instante
    const need = scale() * 25.4, step = DPI_STEPS.find(d => d >= need) || DPI_STEPS.at(-1), dpi = state.draft ? Math.min(54, step) : step, hit = cache.get(i);
    if (hit && hit.version === version && (hit.dpi >= dpi || !hiRes)) {
      if (hit.dpi < dpi) { clearTimeout(sharpen); sharpen = setTimeout(() => { hiRes = true; draw(); hiRes = false; }, 160); }
      return hit.cv;
    }
    const cv = hit?.cv || document.createElement('canvas');
    drawPrintPage(cv, state.layout, i, state.texture, { dpi, title: state.title, draft: state.draft, plain: state.plain });
    cache.set(i, { cv, dpi, version });
    return cv;
  }
  function selection() { // contornos y caja de la pieza elegida
    if (!state?.selected) return [];
    const out = [];
    state.layout.pages.forEach((page, i) => page.placements.forEach(p => {
      if (p.piece.key !== state.selected) return;
      const hull = placedHull(p).map(q => toScreen(i, q)), xs = hull.map(q => q[0]), ys = hull.map(q => q[1]);
      out.push({ page: i, tile: !!page.tile, hull, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }));
    return out;
  }
  function draw() {
    if (!active() || !state) return;
    const d = dpr(), cw = Math.round(stage.clientWidth * d), ch = Math.round(stage.clientHeight * d);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    if (!grid || grid.n !== state.layout.pages.length || grid.w !== state.layout.w) arrange();
    const ctx = canvas.getContext('2d'), s = scale(); ctx.clearRect(0, 0, cw, ch);
    state.layout.pages.forEach((page, i) => {
      const [x, y] = toScreen(i, [0, 0]), w = grid.w * s, h = grid.h * s;
      if (x > cw || y > ch || x + w < 0 || y + h + 30 * d < 0) return;
      ctx.fillStyle = INK; ctx.fillRect(x + 4 * d, y + 4 * d, w, h);
      ctx.drawImage(pageBitmap(i), x, y, w, h);
      ctx.font = `800 ${12 * d}px Archivo, sans-serif`; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      ctx.fillStyle = i === state.page ? HL : PAPER; ctx.fillText(page.cover ? 'Guía de armado' : page.tile ? `Hoja ${i} · parte ${page.tile.row * page.tile.cols + page.tile.col + 1}/${page.tile.rows * page.tile.cols}` : `Hoja ${i}`, x, y + h + 9 * d);
    });
    const color = state.atMax ? STAMP : HL;
    for (const sel of selection()) {
      const [px, py] = toScreen(sel.page, [0, 0]);
      ctx.save(); ctx.beginPath(); ctx.rect(px, py, grid.w * scale(), grid.h * scale()); ctx.clip(); ctx.lineWidth = 2 * d; ctx.setLineDash([7 * d, 5 * d]); ctx.strokeStyle = color; ctx.beginPath();
      sel.hull.forEach((q, i) => i ? ctx.lineTo(...q) : ctx.moveTo(...q)); ctx.closePath(); ctx.stroke(); ctx.restore();
      if (sel.tile) continue;
      for (const [hx, hy] of corners(sel.box)) { // esquinas: círculos rellenos con sombra dura, sin contorno
        ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(hx + 2 * d, hy + 2 * d, 7 * d, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(hx, hy, 7 * d, 0, Math.PI * 2); ctx.fill();
      }
    }
    const first = selection().find(x => !x.tile) || selection()[0];
    if (first && state.badge) {
      ctx.font = `700 ${12 * d}px Archivo, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const tw = ctx.measureText(state.badge).width + 20 * d, th = 26 * d, bx = Math.max(6 * d, Math.min(cw - tw - 6 * d, (first.box[0] + first.box[2]) / 2 - tw / 2));
      let by = first.box[1] - th - 14 * d; if (by < 6 * d) by = first.box[3] + 14 * d;
      ctx.fillStyle = state.atMax ? STAMP : INK; ctx.beginPath(); ctx.roundRect(bx, by, tw, th, th / 2); ctx.fill();
      ctx.fillStyle = PAPER; ctx.fillText(state.badge, bx + 10 * d, by + th / 2);
    }
  }
  const corners = b => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  const kick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => draw()); };

  function hitAt(x, y) { // qué hay debajo del puntero (coordenadas CSS del canvas)
    if (!state || !grid) return null;
    const d = dpr(), px = x * d, py = y * d;
    for (const sel of selection()) if (!sel.tile) for (const c of corners(sel.box)) if (Math.hypot(c[0] - px, c[1] - py) <= 13 * d) return { handle: true, sel };
    const p = toBoard(x, y);
    for (let i = state.layout.pages.length - 1; i >= 0; i--) {
      const [ox, oy] = grid.pos[i], lx = p[0] - ox, ly = p[1] - oy;
      if (lx < 0 || ly < 0 || lx > grid.w || ly > grid.h) continue;
      const placement = state.layout.pages[i].placements.find(pl => inside([lx, ly], placedHull(pl)));
      return { page: i, key: placement?.piece.key || null };
    }
    return { page: null, key: null };
  }
  const pointers = new Map(); let drag = null, pinch = null;
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function down(e) {
    if (!active() || e.button !== 0) return;
    stage.setPointerCapture(e.pointerId); pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: view.zoom }; if (drag?.mode === 'scale') onScale('end'); drag = null; return; }
    const [x, y] = local(e), hit = hitAt(x, y);
    if (hit?.handle) {
      const d = dpr(), c = [(hit.sel.box[0] + hit.sel.box[2]) / 2 / d, (hit.sel.box[1] + hit.sel.box[3]) / 2 / d];
      drag = { mode: 'scale', c, d0: Math.max(8, Math.hypot(x - c[0], y - c[1])) }; onScale('start'); return;
    }
    drag = { mode: 'press', x, y, sx: x, sy: y, hit };
  }
  function move(e) {
    if (!active()) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, local(e));
    if (pinch && pointers.size === 2) { const [a, b] = [...pointers.values()]; zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, pinch.dist)); return; }
    if (drag && e.pointerType === 'mouse' && e.buttons === 0) { up(e); return; } // se soltó sin que llegara el aviso
    const [x, y] = local(e);
    if (!drag) { if (!stage.contains(e.target)) return; const hit = hitAt(x, y); canvas.style.cursor = hit?.handle ? 'nwse-resize' : hit?.key ? 'pointer' : 'grab'; return; }
    if (drag.mode === 'scale') { onScale('move', Math.hypot(x - drag.c[0], y - drag.c[1]) / drag.d0); return; }
    if (drag.mode === 'press' && Math.hypot(x - drag.sx, y - drag.sy) > 4) drag.mode = 'pan';
    if (drag.mode === 'pan') { view.panX += x - drag.x; view.panY += y - drag.y; drag.x = x; drag.y = y; canvas.style.cursor = 'grabbing'; kick(); }
  }
  function up(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId); try { stage.releasePointerCapture(e.pointerId); } catch {}
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    if (drag.mode === 'scale') onScale('end');
    else if (drag.mode === 'press' && drag.hit) onPick(drag.hit.key, drag.hit.page);
    drag = null; canvas.style.cursor = '';
  }
  function zoomAt(x, y, z) {
    const before = toBoard(x, y); view.zoom = Math.max(.6, Math.min(10, z));
    const after = toBoard(x, y), s = grid.k * view.zoom; view.panX += (after[0] - before[0]) * s; view.panY += (after[1] - before[1]) * s; kick();
  }
  function wheel(e) { if (!active() || !grid) return; e.preventDefault(); const [x, y] = local(e), k = e.deltaMode === 1 ? 16 : 1; zoomAt(x, y, view.zoom * Math.exp(-e.deltaY * k * (e.ctrlKey ? .01 : .0015))); }
  function reset() { view.zoom = 1; view.panX = view.panY = 0; kick(); }
  function key(e) {
    if (!active() || !state) return;
    if (e.key === 'Home') { e.preventDefault(); reset(); return; }
    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); onPage(e.key === 'ArrowLeft' ? -1 : 1); return; }
    if (state.selected && ['+', '-', '='].includes(e.key)) { e.preventDefault(); onScale('start'); onScale('move', e.key === '-' ? 1 / 1.02 : 1.02); onScale('end'); }
  }
  const dbl = e => { if (active() && !hitAt(...local(e))?.key) reset(); };
  stage.addEventListener('pointerdown', down); addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up); // en toda la ventana: el arrastre sigue aunque el mouse salga del tablero
  stage.addEventListener('wheel', wheel, { passive: false }); stage.addEventListener('dblclick', dbl); stage.addEventListener('keydown', key);
  const resize = new ResizeObserver(() => { grid = null; kick(); }); resize.observe(stage);
  return {
    view,
    set(next) { // layout nuevo → se vuelven a dibujar las hojas; solo selección o leyenda → no
      const changed = !state || next.layout !== state.layout || next.texture !== state.texture || next.draft !== state.draft || next.plain !== state.plain || next.title !== state.title;
      state = { ...state, ...next }; if (changed) version++;
      if (grid && grid.n !== state.layout.pages.length) grid = null;
      draw();
    },
    draw, reset,
    locate(key) { // centro y esquinas de una pieza, en píxeles CSS del canvas
      if (!state || !grid) return null; const prev = state.selected; state.selected = key; const sel = selection().find(x => !x.tile); state.selected = prev;
      if (!sel) return null; const d = dpr(), b = sel.box.map(v => v / d); return { center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], corners: corners(b) };
    },
    destroy() { destroyed = true; cancelAnimationFrame(raf); clearTimeout(sharpen); resize.disconnect(); cache.clear(); stage.removeEventListener('pointerdown', down); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); stage.removeEventListener('wheel', wheel); stage.removeEventListener('dblclick', dbl); stage.removeEventListener('keydown', key); },
  };
}
