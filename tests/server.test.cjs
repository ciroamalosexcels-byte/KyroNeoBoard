const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('servidor de la app: crear sala, pedir ingreso, responder y conservar compatibilidad', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'knb-lan-test-'));
  const serverFile = process.env.KNB_TEST_ARCHIVE ? path.resolve(process.env.KNB_TEST_ARCHIVE, 'web/_app/server.js') : path.resolve(__dirname, '../web/_app/server.js');
  const child = spawn(process.env.KNB_TEST_ELECTRON || process.execPath, [...(process.env.KNB_TEST_ELECTRON ? ['--preserve-symlinks', '--preserve-symlinks-main'] : []), '-e', `require(${JSON.stringify(serverFile)}).start(0).then(p => console.log('TEST_PORT=' + p))`], {
    cwd: path.resolve(__dirname, '..'), windowsHide: true,
    env: { ...process.env, ...(process.env.KNB_TEST_ELECTRON ? { ELECTRON_RUN_AS_NODE: '1' } : {}), MESA_ALLOW: folder, MESA_REG: path.join(folder, 'projects.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  t.after(async () => {
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    for (const name of fs.readdirSync(folder)) {
      assert.match(name, /\.(neo|json)$/i);
      fs.unlinkSync(path.join(folder, name));
    }
    fs.rmdirSync(folder);
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('El servidor no arrancó: ' + errors)), 10000);
    let out = '';
    child.stdout.on('data', data => { out += data; const m = out.match(/TEST_PORT=(\d+)/); if (m) { clearTimeout(timeout); resolve(Number(m[1])); } });
    child.once('exit', code => { clearTimeout(timeout); reject(Error('Servidor cerrado: ' + code + ' ' + errors)); });
    child.once('error', reject);
  });
  const local = `http://127.0.0.1:${port}`;
  const get = (base, route, options = {}) => fetch(base + route, { redirect: 'manual', ...options, headers: { Connection: 'close', ...options.headers } });
  const post = (route, data) => get(local, route, { method: 'POST', ...(data ? { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } } : {}) });
  const project = { formato: 'neo', version: 1, fotos: folder, estado: { title: 'Proyecto elegido', items: [], lienzos: [] } };
  const opened = await post('/api/adopt', project);
  assert.equal(opened.status, 200);
  const adopted = await opened.json();
  assert.equal(adopted.fotos, folder);
  assert.match(adopted.token, /^[a-f0-9]{48}$/);
  assert.deepEqual(await (await get(local, '/api/opened-project?token=' + adopted.token)).json(), project);
  assert.equal((await get(local, '/api/opened-project?token=' + adopted.token)).status, 404);
  assert.notEqual((await post('/api/adopt', { fotos: folder, estado: { items: [] } })).status, 200);
  const target = '/api/project?dir=' + encodeURIComponent(folder);
  const snapshot = { estado: project.estado, historial: { undos: [JSON.stringify({ ...project.estado, title: 'Anterior' })], redos: [] } };
  assert.equal((await post(target + '&seq=100', snapshot)).status, 200);
  const saved = await (await get(local, target)).json();
  assert.equal(saved.data.formato, 'neo'); assert.deepEqual(saved.data.historial, snapshot.historial);
  assert.equal(fs.readdirSync(folder).filter(f => /\.neo$/i.test(f)).length, 1);
  assert.equal((await post('/api/state?file=' + encodeURIComponent(path.join(folder, 'mesa.json')), project.estado)).status, 409);
  assert.equal(fs.existsSync(path.join(folder, 'mesa.json')), false);
  let response = await post(`/api/lan/start?dir=${encodeURIComponent(folder)}&name=Integracion`, { approval: true, password: 'prueba' });
  assert.equal(response.status, 200);
  const room = await response.json(); assert.equal(room.approval, true); assert.equal(room.password, true);
  response = await get(local, '/api/lan/resolve?code=' + encodeURIComponent('http://100.100.7.2/'));
  assert.equal(response.status, 404); assert.match((await response.json()).error, /código/);
  const remote = `http://127.0.0.1:${room.port}`;
  response = await get(remote, `/sala/${room.code}`);
  assert.match(await response.text(), /Pedir entrar/);
  assert.equal((await get(remote, '/_app/fonts/archivo.css')).status, 200);
  assert.equal((await get(remote, '/_app/collab.js')).status, 403);
  assert.equal((await get(remote, '/api/lan/resolve?code=' + room.code)).status, 403);
  assert.equal((await get(remote, '/api/opened-project?token=' + adopted.token)).status, 403);
  assert.equal((await get(remote, '/api/adopt', { method: 'POST', body: JSON.stringify(project) })).status, 403);
  assert.equal((await get(remote, target)).status, 403);
  assert.equal((await get(remote, target, { method: 'POST', body: JSON.stringify(snapshot) })).status, 403);
  response = await get(remote, '/api/lan/admission', { method: 'POST', body: JSON.stringify({ name: 'Invitado', password: 'prueba' }) });
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await response.json()).status, 'waiting');
  const pending = await (await get(local, '/api/lan/requests')).json(); assert.equal(pending.length, 1);
  assert.equal((await get(remote, '/api/lan/decide?id=' + pending[0].id + '&allow=1', { method: 'POST', headers: { Cookie: cookie } })).status, 403);
  assert.equal((await get(local, '/api/lan/decide?id=' + pending[0].id + '&allow=1', { method: 'POST', headers: { Origin: 'http://otra-pagina.example' } })).status, 403);
  assert.equal((await (await get(remote, '/api/lan/admission', { headers: { Cookie: cookie } })).json()).status, 'waiting');
  assert.equal((await (await post('/api/lan/decide?id=' + pending[0].id + '&allow=1')).json()).ok, true);
  const admitted = await (await get(remote, '/api/lan/admission', { headers: { Cookie: cookie } })).json();
  assert.equal(admitted.status, 'accepted');
  response = await get(remote, admitted.next, { headers: { Cookie: cookie } });
  const html = await response.text(); assert.equal(response.status, 200); assert.match(html, /_app\/room-link.js/);
  assert.match(await (await get(local, '/')).text(), /wRoomJoin/);
  await post('/api/lan/stop');
  response = await post('/api/lan/start?dir=' + encodeURIComponent(folder));
  const oldClient = await response.json(); assert.equal(oldClient.on, true); assert.equal(oldClient.approval, false);
  await post('/api/lan/stop');
});
