// Compartido por Electron y el navegador: enlaces de salas de la red local.
(function (root) {
  function localHost(host) {
    host = host.toLowerCase();
    if (host === 'localhost' || host === '[::1]' || host.endsWith('.local') || /^[a-z][a-z0-9-]*$/i.test(host)) return true;
    const ip = host.split('.').map(Number);
    if (ip.length !== 4 || ip.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = ip;
    return a === 10 || a === 127 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127;
  }
  function roomLink(value, near = []) {
    value = String(value || '').trim();
    if (/^[a-z0-9]{4,12}$/i.test(value)) {
      const matches = near.filter(n => n.code === value.toUpperCase());
      if (matches.length !== 1) throw new Error('No encontré ese código en la red. Pegá el enlace completo de la sala.');
      value = matches[0].url;
    }
    let u;
    try { u = new URL(/^https?:\/\//i.test(value) ? value : 'http://' + value); } catch { throw new Error('Pegá un enlace de sala válido.'); }
    if (u.protocol !== 'http:' || u.username || u.password || !localHost(u.hostname) || !/^\/sala\/[a-z0-9]{4,12}\/?$/i.test(u.pathname)) throw new Error('Usá el enlace completo de una sala en tu red local.');
    u.pathname = u.pathname.toUpperCase().replace('/SALA/', '/sala/').replace(/\/$/, '');
    u.search = ''; u.hash = '';
    return u;
  }
  const api = { localHost, roomLink };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KyroRoomLink = api;
})(globalThis);
