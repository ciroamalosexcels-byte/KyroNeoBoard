const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const dgram = require('node:dgram');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createLan } = require('../web/_app/lan.js');
const { roomLink, localHost } = require('../web/_app/room-link.js');

test('enlaces LAN: redes privadas, compartidas 100.64/10, nombres locales y códigos', () => {
  for (const host of ['10.0.0.2', '192.168.0.2', '172.31.1.2', '100.100.7.2', '100.64.0.1', '100.127.255.254', 'equipo.local', 'equipo']) {
    assert.ok(localHost(host), host);
    assert.equal(roomLink(`http://${host}:47830/sala/ABC234?ignorar=1`).origin, `http://${host}:47830`);
  }
  for (const bad of ['http://100.128.0.1:47830/sala/ABC234', 'http://8.8.8.8/sala/ABC234', 'https://192.168.0.2/sala/ABC234', 'http://192.168.0.2/api/file', 'http://user:pass@10.0.0.2/sala/ABC234', 'javascript:alert(1)']) assert.throws(() => roomLink(bad), bad);
  assert.equal(roomLink('abc234', [{ code: 'ABC234', url: 'http://192.168.0.2:47830/sala/ABC234' }]).pathname, '/sala/ABC234');
  assert.throws(() => roomLink('ABC234', []), /enlace completo/);
});

test('un código encuentra otra sala LAN sin que el invitado conozca la dirección', async t => {
  const root = path.resolve(__dirname, '../web');
  // Simular dos computadoras por UDP local: no depender de que el router devuelva
  // a esta misma PC sus propios broadcasts, que varía según la red y Windows.
  const reserved = [dgram.createSocket('udp4'), dgram.createSocket('udp4')];
  await Promise.all(reserved.map(s => new Promise(resolve => s.bind(0, '127.0.0.1', resolve))));
  const [hostPort, guestPort] = reserved.map(s => s.address().port);
  await Promise.all(reserved.map(s => new Promise(resolve => s.close(resolve))));
  const host = createLan({ safe: { root }, handler: (_req, res) => res.end('mesa'), discoveryOptions: { listenPort: hostPort, targets: [{ address: '127.0.0.1', port: guestPort }] } });
  const guest = createLan({ safe: { root }, handler: (_req, res) => res.end('mesa'), discoveryOptions: { listenPort: guestPort, targets: [{ address: '127.0.0.1', port: hostPort }] } });
  t.after(() => { guest.close(); host.close(); });
  const room = await host.start(root, 'Código sin enlace', { approval: true });
  const result = await guest.resolve('  ' + room.code.toLowerCase() + '  ');
  assert.equal(result.code, room.code, result.error);
  assert.equal(new URL(result.url).port, String(room.port));
  assert.equal(new URL(result.url).pathname, '/sala/' + room.code);
  assert.match((await guest.resolve('http://100.100.7.2/')).error, /código/);
});

const request = (base, route, cookie = '', data) => fetch(base + route, {
  redirect: 'manual', headers: { Connection: 'close', ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
  ...(data ? { method: 'POST', body: JSON.stringify(data) } : {}),
});
const cookieFrom = r => r.headers.get('set-cookie').split(';')[0];
function socket(url, cookie = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Cookie: cookie }, handshakeTimeout: 2000 });
    ws.once('open', () => resolve(ws)); ws.once('error', reject);
  });
}

test('admisión real HTTP/WS: directo, contraseña, aprobación, rechazo, aislamiento y reinicio', async t => {
  const root = path.resolve(__dirname, '../web');
  const lan = createLan({ safe: { root }, handler: (_req, res) => res.end('contenido del proyecto') });
  const hostServer = http.createServer();
  hostServer.on('upgrade', (req, sock, head) => lan.upgrade(req, sock, head, false));
  hostServer.listen(0, '127.0.0.1'); await once(hostServer, 'listening');
  const sockets = [];
  t.after(() => { for (const ws of sockets) ws.terminate(); lan.close(); hostServer.close(); });
  let info = await lan.start(root, 'Prueba');
  let base = `http://127.0.0.1:${info.port}`;
  let r = await request(base, `/sala/${info.code}?volver=${encodeURIComponent('http://127.0.0.1:47821/')}`);
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /volver=/);
  const directCookie = cookieFrom(r);
  assert.notEqual(directCookie, `kyro_sala=${info.code}`);
  assert.equal((await request(base, '/api/img?path=' + encodeURIComponent(path.join(root, 'foto.jpg')), directCookie)).status, 200);
  assert.equal((await request(base, '/api/file', directCookie)).status, 403);
  assert.equal((await request(base, '/api/lan/requests', directCookie)).status, 403);
  assert.equal((await request(base, '/api/img?path=' + encodeURIComponent(path.resolve(root, '../main.js')), directCookie)).status, 403);
  const guest = await socket(base.replace('http:', 'ws:') + '/ws?id=guest', directCookie); sockets.push(guest);
  lan.stop();

  info = await lan.start(root, 'Privada', { password: 'clave', approval: true }); base = `http://127.0.0.1:${info.port}`;
  r = await request(base, `/sala/${info.code}`);
  assert.equal(r.status, 200); assert.match(await r.text(), /Contraseña de la sala/);
  assert.equal((await request(base, '/api/img', directCookie)).status, 403, 'la cookie vieja no sirve');
  r = await request(base, '/api/lan/admission', '', { name: 'Ana', password: 'incorrecta' }); assert.equal(r.status, 403);
  r = await request(base, '/api/lan/admission', '', { name: 'Ana', password: 'clave' });
  const waitingCookie = cookieFrom(r); assert.equal((await r.json()).status, 'waiting');
  assert.equal((await request(base, '/api/list', waitingCookie)).status, 403);
  await assert.rejects(socket(base.replace('http:', 'ws:') + '/ws?id=waiting', waitingCookie));
  const pending = lan.requests(); assert.equal(pending.length, 1); assert.equal(pending[0].name, 'Ana');
  assert.equal(lan.decide(pending[0].id, true).ok, true);
  assert.equal((await (await request(base, '/api/lan/admission', waitingCookie)).json()).status, 'accepted');
  assert.equal((await request(base, '/api/list', waitingCookie)).status, 200);
  const host = await socket(`ws://127.0.0.1:${hostServer.address().port}/ws?id=host`); sockets.push(host);
  const admitted = await socket(base.replace('http:', 'ws:') + '/ws?id=ana', waitingCookie); sockets.push(admitted);
  const message = new Promise(resolve => host.on('message', raw => { const msg = JSON.parse(raw); if (msg.t === 'bc') resolve(msg); }));
  admitted.send(JSON.stringify({ t: 'bc', payload: { k: 'chat', text: 'Hola' } }));
  assert.equal((await message).payload.text, 'Hola');
  const impersonator = await socket(base.replace('http:', 'ws:') + '/ws?id=host', waitingCookie); sockets.push(impersonator);
  const [code] = await once(impersonator, 'close'); assert.equal(code, 4001);
  r = await request(base, '/api/lan/admission', '', { name: 'Otra', password: 'clave' }); const deniedCookie = cookieFrom(r);
  lan.decide(lan.requests()[0].id, false);
  assert.equal((await (await request(base, '/api/lan/admission', deniedCookie)).json()).status, 'denied');
  assert.equal((await request(base, '/api/list', deniedCookie)).status, 403);
  lan.stop();

  info = await lan.start(root, 'Solo contraseña', { password: 'clave', approval: false }); base = `http://127.0.0.1:${info.port}`;
  r = await request(base, '/api/lan/admission', '', { name: 'Ana', password: 'clave' });
  assert.equal((await r.json()).status, 'accepted');
  assert.equal((await request(base, '/api/list', cookieFrom(r))).status, 200);
  assert.equal((await request(base, '/api/list', waitingCookie)).status, 403);
});
