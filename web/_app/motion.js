// Papel, sellos y sombras: movimientos breves, compartidos por toda la mesa.
import { play } from './sound.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const active = new WeakMap(), lists = new WeakMap();
const ease = 'cubic-bezier(.22,1,.36,1)';

export function paperIn(el, { delay = 0, side = false } = {}) {
  if (!el || reduced.matches || !el.getClientRects().length) return;
  active.get(el)?.cancel();
  const opacity = getComputedStyle(el).opacity;
  // Propiedades independientes: conservar el transform que posiciona la pieza.
  const animation = el.animate([
    { opacity: 0, translate: side ? '14px 0' : '0 10px', rotate: side ? '1deg' : '-1deg', scale: '.96' },
    { opacity, translate: '0 -1px', rotate: '.25deg', scale: '1.012', offset: .65 },
    { opacity, translate: '0 0', rotate: '0deg', scale: '1' },
  ], { duration: 420, delay, easing: ease, fill: 'backwards' });
  active.set(el, animation);
}

// Animar solamente las filas nuevas, aunque la lista se reconstruya al editar o sondear.
export function revealNew(root, selector, key = el => el.dataset.id) {
  if (!root) return;
  const groups = lists.get(root) || new Map();
  const previous = groups.get(selector) || new Set(), next = new Set();
  let arriving = 0;
  root.querySelectorAll(selector).forEach((el, i) => {
    const id = key(el, i); next.add(id);
    if (!previous.has(id)) paperIn(el, { delay: Math.min(arriving++ * 35, 140) });
  });
  groups.set(selector, next); lists.set(root, groups);
}

export function mountMotion() {
  reduced.addEventListener('change', () => {
    if (reduced.matches) document.getAnimations().filter(a => a.effect?.target && active.get(a.effect.target) === a).forEach(a => a.cancel());
  });
  document.querySelectorAll('.menu,.help,.collab-panel,.art-panel,.cb-qr,.cb-gate').forEach(el => {
    let visible = !el.hidden && getComputedStyle(el).display !== 'none';
    new MutationObserver(() => {
      const open = !el.hidden && getComputedStyle(el).display !== 'none';
      if (open && !visible && navigator.userActivation?.hasBeenActive) play('papel');
      visible = open;
    }).observe(el, { attributes: true, attributeFilter: ['class', 'hidden'] });
  });
  document.addEventListener('click', e => {
    const button = e.target.closest?.('button');
    if (!button || button.disabled || !e.isTrusted) return;
    if (button.matches('[data-cfg] button,.cb-sw,.cb-ic,.lz-btn,.pv-lz,.pv-all button,#magnetBtn,#night')) play('tocar');
    if (reduced.matches || !button.isConnected || button.matches('.ticket-stub,.room-paste,.new-create,[data-snd]')) return;
    active.get(button)?.cancel();
    const animation = button.animate([
      { scale: '.94 1.03' }, { scale: '1.035 .98', offset: .45 }, { scale: '1' },
    ], { duration: 320, easing: ease });
    active.set(button, animation);
  });
}
