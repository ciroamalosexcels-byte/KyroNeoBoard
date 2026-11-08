// Kyro Neo Board · tutorial: pasos cortos que señalan cada parte. Se puede saltar en cualquier momento.
const STEPS = [
  { title: 'Kyro Neo Board', text: 'Armá fotos en tamaños A3 a A7 y exportalas en hojas para recortar.' },
  { el: '.bar > .group.center', title: 'Herramientas', text: 'Seleccionar, mano, tamaño, rotar, lienzo y lupa. Cada una tiene su tecla.' },
  { title: 'Fotos', text: 'Se arrastran desde el explorador o se pegan con Ctrl+V. Clic derecho en una foto: tamaño, recorte y rotación.' },
  { el: '#layers', title: 'Lienzos', text: 'Grupos de fotos con su propia forma. D para dibujar uno.' },
  { el: '#sortBtn', title: 'Ordenar', text: 'Por color, fecha, tamaño, luz, cámara y más.' },
  { el: '#export', title: 'Exportar', text: 'Hojas A3 o A4 en JPG 300 dpi, PDF y mapa de armado.' },
  { el: '#collabBtn', title: 'En equipo', text: 'Una sala en la red local para trabajar de a varios, desde la compu, el celu o la tablet.' },
  { el: '#cfgBtn', title: 'Configuración', text: 'Sonidos, carteles de ayuda, calidad y trackpad.' },
  { el: '#helpBtn', title: 'Atajos', text: 'La lista de atajos. Este tutorial también está ahí.' },
];

export function startTutorial({ onEnd } = {}) {
  if (document.querySelector('.tut')) return;
  const visible = s => { if (!s.el) return true; const e = document.querySelector(s.el); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
  const steps = STEPS.filter(visible);
  const root = document.createElement('div');
  root.className = 'tut';
  root.innerHTML = '<div class="tut-shade"></div><div class="tut-spot"></div><div class="tut-card" role="dialog" aria-live="polite"><div class="tut-n"></div><b class="tut-t"></b><p class="tut-x"></p><div class="tut-btns"><button class="tut-skip">Saltar</button><button class="tut-next"></button></div></div>';
  document.body.append(root);
  const $ = s => root.querySelector(s);
  let i = 0;
  function show() {
    const s = steps[i], target = s.el && document.querySelector(s.el);
    $('.tut-n').textContent = `${i + 1} / ${steps.length}`;
    $('.tut-t').textContent = s.title; $('.tut-x').textContent = s.text;
    $('.tut-next').textContent = i === steps.length - 1 ? 'Listo' : 'Siguiente';
    const card = $('.tut-card'), spot = $('.tut-spot');
    root.classList.toggle('center', !target);
    if (!target) { spot.style.cssText = ''; card.style.left = card.style.top = ''; $('.tut-next').focus(); return; }
    const r = target.getBoundingClientRect(), pad = 6;
    spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    // la tarjeta: abajo del elemento si entra; si no, arriba; nunca afuera de la pantalla
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 16;
    let top = r.bottom + gap; if (top + ch > innerHeight - 12) top = Math.max(12, r.top - gap - ch);
    if (r.height > innerHeight * 0.5) top = Math.min(innerHeight - ch - 12, Math.max(12, r.top + 20)); // elementos altos (lienzos): al costado
    let left = r.left + r.width / 2 - cw / 2;
    if (r.height > innerHeight * 0.5) left = r.right + gap;
    card.style.left = Math.max(12, Math.min(innerWidth - cw - 12, left)) + 'px';
    card.style.top = top + 'px';
    $('.tut-next').focus();
  }
  function end() { root.remove(); removeEventListener('keydown', key, true); removeEventListener('resize', show); onEnd?.(); }
  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); end(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); if (i > 0) { i--; show(); } }
    else e.stopImmediatePropagation(); // mientras dura, las teclas no tocan la mesa
  }
  function next() { if (i < steps.length - 1) { i++; show(); } else end(); }
  $('.tut-skip').onclick = end;
  $('.tut-next').onclick = next;
  addEventListener('keydown', key, true);
  addEventListener('resize', show);
  requestAnimationFrame(show);
}
