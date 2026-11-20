const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createProjectStore, atomicWrite } = require('../web/_app/project-store.js');

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-store-test-'));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'neo-store-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let registry = [];
  const config = { readReg: () => registry, writeReg: value => { registry = value; }, ...options };
  return { dir, store: createProjectStore(config), restart: () => createProjectStore(config) };
}
const state = name => ({ title: name, frame: 6, migrated1m: true, items: [{ id: 'foto', file: 'foto.jpg', x: 213, y: -87, rot: 3, size: 'A6' }], lienzos: [], hidden: [] });
const history = name => ({ undos: [JSON.stringify(state(name + ' antes'))], redos: [JSON.stringify(state(name + ' después'))] });
function legacy(dir, s, h) {
  fs.writeFileSync(path.join(dir, 'mesa.json'), JSON.stringify(s));
  fs.writeFileSync(path.join(dir, 'mesa.historial.json'), JSON.stringify(h));
}

test('migra armado e historial completos a un solo .neo y retira los dos JSON verificados', async t => {
  const { dir, store, restart } = fixture(t), s = state('Prueba'), h = history('Prueba');
  legacy(dir, s, h);
  const saved = await store.load(dir);
  assert.equal(saved.migrated, true); assert.equal(path.extname(saved.path), '.neo');
  assert.deepEqual(saved.data.estado, s); assert.deepEqual(saved.data.historial, h);
  assert.deepEqual(fs.readdirSync(dir), [path.basename(saved.path)]);
  assert.deepEqual((await restart().load(dir)).data, saved.data);
});

test('cada autoguardado reemplaza juntos el estado y el historial, sin recrear JSON', async t => {
  const { dir, store } = fixture(t);
  const a = await store.save(dir, { estado: state('Primero'), historial: history('Primero') }, { seq: 10 });
  await Promise.all([
    store.save(dir, { estado: state('Más reciente'), historial: history('Más reciente') }, { file: a.path, seq: 30 }),
    store.save(dir, { estado: state('Tardío'), historial: history('Tardío') }, { file: a.path, seq: 20 }),
  ]);
  const saved = JSON.parse(fs.readFileSync(a.path));
  assert.deepEqual(saved.estado, state('Más reciente')); assert.deepEqual(saved.historial, history('Más reciente'));
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('Guardar como cambia el archivo activo y recientes lo recupera después de reiniciar', async t => {
  const { dir, store, restart } = fixture(t);
  const original = await store.save(dir, { estado: state('Original'), historial: history('Original') });
  const other = path.join(dir, 'Copia.neo');
  await store.save(dir, { estado: state('Copia'), historial: history('Copia') }, { file: other });
  await restart().save(dir, { estado: state('Copia editada'), historial: history('Copia editada') });
  assert.equal(JSON.parse(fs.readFileSync(original.path)).estado.title, 'Original');
  assert.equal((await restart().load(dir)).path, other);
  assert.equal(JSON.parse(fs.readFileSync(other)).estado.title, 'Copia editada');
});

test('una migración no pisa otro .neo que ya existe en la carpeta', async t => {
  const { dir, store } = fixture(t);
  const old = await store.save(dir, { estado: state('Otro proyecto'), historial: history('Otro proyecto') });
  const original = fs.readFileSync(old.path);
  legacy(dir, state('Recuperado'), history('Recuperado'));
  const converted = await store.load(dir);
  assert.notEqual(converted.path, old.path); assert.deepEqual(fs.readFileSync(old.path), original);
  assert.equal(converted.data.estado.title, 'Recuperado');
});

test('si falla la escritura o el historial es inválido, se conservan los JSON originales', async t => {
  const { dir, store } = fixture(t, { write: async () => { throw Error('Disco no disponible'); } });
  legacy(dir, state('Seguro'), history('Seguro'));
  const before = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f)).toString());
  await assert.rejects(store.load(dir), /Disco no disponible/);
  assert.deepEqual(fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f)).toString()), before);
  fs.writeFileSync(path.join(dir, 'mesa.historial.json'), '{roto');
  await assert.rejects(store.load(dir)); assert.ok(fs.existsSync(path.join(dir, 'mesa.json')));
});

test('no elimina un JSON modificado por otra sesión durante la conversión', async t => {
  let source;
  const { dir, store } = fixture(t, { write: async (file, data) => {
    await atomicWrite(file, data); fs.writeFileSync(source, JSON.stringify(state('Cambio concurrente')));
  } });
  source = path.join(dir, 'mesa.json'); legacy(dir, state('Inicial'), history('Inicial'));
  await assert.rejects(store.load(dir), /Otro programa/);
  assert.equal(JSON.parse(fs.readFileSync(source)).title, 'Cambio concurrente');
  assert.ok(fs.readdirSync(dir).some(f => f.endsWith('.neo')));
});

test('abre .neo anteriores, conserva historial e identifica el archivo del selector del navegador', async t => {
  const { dir, store } = fixture(t), file = path.join(dir, 'Diseño.neo');
  const data = { formato: 'neo', version: 1, fotos: dir, estado: state('Diseño') };
  fs.writeFileSync(file, JSON.stringify(data));
  assert.deepEqual((await store.load(dir, file)).data, data);
  assert.equal(await store.importBrowser(dir, data, 'Diseño.neo'), file);
  assert.equal(fs.readdirSync(dir).length, 1);
  await store.save(dir, { estado: state('Actualizado'), historial: history('Actualizado') }, { file });
  assert.equal(JSON.parse(fs.readFileSync(file)).version, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).historial, history('Actualizado'));
});

test('un .neo dañado no se reemplaza por un proyecto vacío', async t => {
  const { dir, store } = fixture(t), file = path.join(dir, path.basename(dir) + '.neo');
  fs.writeFileSync(file, '{incompleto');
  await assert.rejects(store.load(dir)); assert.equal(fs.readFileSync(file, 'utf8'), '{incompleto');
});

test('el selector respeta el nombre elegido aunque dos .neo tengan el mismo contenido', async t => {
  const { dir, store } = fixture(t);
  const data = { formato: 'neo', version: 1, fotos: dir, estado: state('Mismo armado') };
  const first = path.join(dir, 'Primero.neo'), second = path.join(dir, 'Segundo.neo');
  fs.writeFileSync(first, JSON.stringify(data)); fs.writeFileSync(second, JSON.stringify(data));
  await store.load(dir, first);
  assert.equal(await store.importBrowser(dir, data, 'Segundo.neo'), second);
  await store.save(dir, { estado: data.estado, historial: { undos: [], redos: [] } });
  assert.equal(await store.importBrowser(dir, data, 'Segundo.neo'), second);
  assert.equal(fs.readdirSync(dir).length, 2);
});
