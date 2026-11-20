// Un proyecto .neo contiene el armado y su historial. Los JSON viejos sólo se migran.
'use strict';
const fs = require('fs'), path = require('path');
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const validState = s => s && Array.isArray(s.items);
const validHistory = h => h && Array.isArray(h.undos) && Array.isArray(h.redos);
const emptyHistory = () => ({ undos: [], redos: [] });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let serial = 0;

async function atomicWrite(file, data) {
  const temp = `${file}.tmp-${process.pid}-${++serial}`;
  try {
    const fd = fs.openSync(temp, 'wx');
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    for (let i = 0; ; i++) {
      try { fs.renameSync(temp, file); break; }
      catch (error) { if (i >= 12) throw error; await new Promise(r => setTimeout(r, 40 + i * 30)); }
    }
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function createProjectStore({ readReg = () => [], writeReg = () => {}, write = atomicWrite } = {}) {
  const queues = new Map(), versions = new Map();
  const registered = dir => readReg().find(p => p?.path && samePath(p.path, dir));
  function remember(dir, file) {
    const old = registered(dir);
    writeReg([{ ...old, path: dir, neo: file, name: old?.name || path.basename(dir), created: old?.created || new Date().toISOString() },
      ...readReg().filter(p => !p?.path || !samePath(p.path, dir))]);
  }
  function queue(dir, fn) {
    const previous = queues.get(dir) || Promise.resolve();
    const job = previous.then(fn), tail = job.catch(() => {}); queues.set(dir, tail);
    tail.then(() => { if (queues.get(dir) === tail) queues.delete(dir); });
    return job;
  }
  function read(file, dir) {
    if (!/\.neo$/i.test(file)) throw Error('Elegí un archivo .neo.');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.formato !== 'neo' || !validState(data.estado)) throw Error('Ese archivo no es un proyecto .neo válido.');
    if (!data.fotos || !samePath(data.fotos, dir)) throw Error('Ese .neo pertenece a otra carpeta de fotos.');
    if (data.historial != null && !validHistory(data.historial)) throw Error('El historial del .neo no es válido.');
    return data;
  }
  function freeName(dir, name = path.basename(dir) + '.neo') {
    const stem = path.basename(name, path.extname(name)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '') || 'Proyecto';
    let file = path.join(dir, stem + '.neo');
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${stem} (${n}).neo`);
    return file;
  }
  function resolve(dir) {
    const saved = registered(dir)?.neo;
    if (saved && fs.existsSync(saved)) return saved;
    const canonical = path.join(dir, path.basename(dir) + '.neo');
    if (fs.existsSync(canonical)) return canonical;
    const files = fs.readdirSync(dir).filter(f => /\.neo$/i.test(f)).map(f => path.join(dir, f)).filter(file => {
      try { read(file, dir); return true; } catch { return false; }
    });
    if (files.length > 1) throw Error('Hay varios proyectos .neo en esta carpeta. Elegí uno con Abrir proyecto.');
    return files[0] || canonical;
  }
  async function persist(dir, file, estado, historial) {
    if (!/\.neo$/i.test(file) || !validState(estado) || !validHistory(historial)) throw Error('El proyecto o su historial no son válidos.');
    const data = { formato: 'neo', version: 2, app: 'Kyro Neo Board', guardado: new Date().toISOString(), fotos: dir, estado, historial };
    await write(file, JSON.stringify(data, null, 1));
    if (!equal(read(file, dir), data)) throw Error('No se pudo verificar el proyecto guardado.');
    remember(dir, file);
    return { path: file, data };
  }
  function load(dir, file) {
    dir = path.resolve(dir);
    return queue(dir, async () => {
      if (file) {
        file = path.resolve(file); const data = read(file, dir); remember(dir, file);
        return { path: file, data };
      }
      const legacy = [path.join(dir, 'mesa.json'), path.join(dir, 'mesa.historial.json')];
      if (!fs.existsSync(legacy[0]) && fs.existsSync(legacy[1])) throw Error('Está el historial anterior pero falta mesa.json. Se conservó el archivo original.');
      if (fs.existsSync(legacy[0])) {
        const originals = legacy.map(f => fs.existsSync(f) ? fs.readFileSync(f) : null);
        const state = JSON.parse(originals[0]), history = originals[1] ? JSON.parse(originals[1]) : emptyHistory();
        if (!validState(state) || !validHistory(history)) throw Error('El guardado anterior no es válido. Se conservaron los JSON originales.');
        const current = registered(dir)?.neo || path.join(dir, path.basename(dir) + '.neo');
        let existing = null;
        if (fs.existsSync(current)) { try { existing = read(current, dir); } catch {} }
        let result;
        if (existing && equal(existing.estado, state) && equal(existing.historial || emptyHistory(), history)) {
          result = { path: current, data: existing }; remember(dir, current);
        } else result = await persist(dir, freeName(dir), state, history);
        // Sólo retirar los originales si no cambiaron mientras se escribía y verificaba el .neo.
        const unchanged = legacy.every((f, i) => originals[i] ? fs.existsSync(f) && fs.readFileSync(f).equals(originals[i]) : !fs.existsSync(f));
        if (!unchanged) throw Error('Otro programa modificó el guardado anterior. El .neo fue creado y los JSON se conservaron.');
        legacy.forEach((f, i) => { if (originals[i]) fs.unlinkSync(f); });
        return { ...result, migrated: true };
      }
      const target = resolve(dir), data = fs.existsSync(target) ? read(target, dir) : null;
      if (data) remember(dir, target);
      return { path: target, data };
    });
  }
  function save(dir, { estado, historial }, { file, seq = 0 } = {}) {
    dir = path.resolve(dir);
    return queue(dir, async () => {
      const target = file ? path.resolve(file) : resolve(dir);
      if (seq && seq <= (versions.get(target) || 0)) return { path: target, viejo: true };
      const result = await persist(dir, target, estado, historial);
      if (seq) versions.set(target, seq);
      return { path: result.path, ok: true };
    });
  }
  function importBrowser(dir, data, name) {
    dir = path.resolve(dir);
    return queue(dir, async () => {
      const remembered = registered(dir)?.neo;
      const named = file => !name || path.basename(file).toLowerCase() === path.basename(name).toLowerCase();
      const candidates = [...(name ? [path.join(dir, path.basename(name))] : []), remembered,
        ...fs.readdirSync(dir).filter(f => /\.neo$/i.test(f)).map(f => path.join(dir, f))].filter(file => file && named(file));
      for (const file of candidates) {
        try {
          const existing = read(file, dir);
          if (equal(existing.estado, data.estado) && equal(existing.historial || emptyHistory(), data.historial || emptyHistory())) {
            remember(dir, file); return file;
          }
        } catch {}
      }
      const result = await persist(dir, freeName(dir, name), data.estado, data.historial || emptyHistory());
      return result.path;
    });
  }
  return { load, save, importBrowser };
}
module.exports = { createProjectStore, atomicWrite };
