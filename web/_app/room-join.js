// El mismo ingreso desde Inicio y desde el panel En equipo.
import { pasteText } from './clipboard.js';
import { icon } from './mesa.js';
import { revealNew } from './motion.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const roomJoinHTML = () => `<section class="room-join" aria-label="Conectarse a una sala">
  <h3>O conectarse a una sala</h3>
  <form class="room-join-form"><label class="ticket room-ticket"><span class="room-ticket-body"><span class="room-ticket-title">Código de la sala</span><span class="room-code-field"><input class="room-code" aria-label="Código de la sala, seis caracteres" minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}" autocomplete="off" autocapitalize="characters" spellcheck="false" required><span class="room-code-slots" aria-hidden="true">${'<span></span>'.repeat(6)}</span></span></span></label><div class="room-join-actions"><button class="room-paste" type="button">${icon('copy')}Pegar código</button><button class="room-connect" type="submit">Entrar</button></div></form>
  <p class="cb-hint room-status" role="status" aria-live="polite">Buscando salas en tu red…</p>
  <div class="room-near"></div>
  <p class="cb-hint">Pedí el código del ticket. Tienen que estar en la misma red wifi o cable.</p>
</section>`;

export function mountRoomJoin(root, { beforeJoin = async () => {}, toast = () => {} } = {}) {
  const form = root.querySelector('.room-join-form');
  if (!form) return;
  const input = form.querySelector('input'), status = root.querySelector('.room-status'), list = root.querySelector('.room-near');
  const slots = [...form.querySelectorAll('.room-code-slots > span')];
  function paintCode() {
    const value = input.value.toUpperCase(), focus = document.activeElement === input;
    slots.forEach((slot, i) => {
      slot.textContent = value[i] || '';
      slot.classList.toggle('active', focus && i === Math.min(input.selectionStart || 0, 5));
      slot.classList.toggle('selected', focus && i >= input.selectionStart && i < input.selectionEnd);
    });
  }
  const setCode = value => { input.value = value; paintCode(); };
  let busy = false, feedback = false;
  const buttons = [...form.querySelectorAll('button')];
  async function refresh() {
    try {
      const r = await fetch('/api/lan/peers');
      if (!r.ok) throw new Error();
      const near = await r.json();
      if (!busy && !feedback) status.textContent = near.length ? 'Salas en tu red' : 'No se detectaron salas todavía.';
      list.innerHTML = near.map(n => `<div class="cb-room"><div><b>${esc(n.project || 'Mesa')}</b><small>${esc(n.name)} · ${esc(n.code)}</small></div><button class="cb-go" type="button" data-room-code="${esc(n.code)}">Entrar</button></div>`).join('');
      revealNew(list, '.cb-room', (_, i) => near[i].code);
    } catch { if (!busy && !feedback) status.textContent = 'No se pudieron buscar salas. Probá pegando el código.'; }
  }
  async function enter(value) {
    if (busy) return;
    const code = String(value).trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) { feedback = true; status.textContent = 'Completá los seis caracteres del ticket de la sala.'; input.focus(); return; }
    busy = true;
    feedback = false;
    buttons.forEach(b => { b.disabled = true; });
    status.textContent = 'Buscando la sala…';
    try {
      const r = await fetch('/api/lan/resolve?code=' + encodeURIComponent(code));
      const room = await r.json();
      if (!r.ok || room.error) throw new Error(room.error || 'No se pudo encontrar la sala.');
      const u = window.KyroRoomLink.roomLink(room.url);
      u.searchParams.set('volver', location.origin + '/');
      status.textContent = 'Entrando…';
      await beforeJoin();
      location.href = u.href;
    } catch (e) { status.textContent = e.message; toast(e.message, 5000); busy = false; feedback = true; buttons.forEach(b => { b.disabled = false; }); }
  }
  input.addEventListener('input', () => { feedback = false; paintCode(); });
  for (const event of ['focus', 'blur', 'keyup', 'select', 'click']) input.addEventListener(event, paintCode);
  form.querySelector('.room-paste').addEventListener('click', async () => {
    try {
      const code = (await pasteText()).trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('El portapapeles no tiene un código de seis caracteres. Copialo desde el ticket.');
      setCode(code); feedback = true; status.textContent = 'Código pegado. Tocá Entrar.'; input.focus();
    } catch (e) { feedback = true; status.textContent = e.message; input.focus(); }
  });
  form.addEventListener('submit', e => { e.preventDefault(); e.stopPropagation(); enter(input.value); });
  root.querySelector('.room-near').addEventListener('click', e => {
    const b = e.target.closest('[data-room-code]'); if (b) { setCode(b.dataset.roomCode); enter(b.dataset.roomCode); }
  });
  // Al volver a dibujar el panel se descarta este sondeo.
  async function poll() {
    if (!root.isConnected || root.querySelector('.room-join-form') !== form) return;
    await refresh();
    if (root.isConnected && root.querySelector('.room-join-form') === form) setTimeout(poll, 3000);
  }
  poll();
}
