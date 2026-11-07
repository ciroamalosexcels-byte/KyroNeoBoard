// Servidor local de Kyro Neo Board: sirve la mesa y guarda proyectos, hojas JPG y PDF.
// Lo arranca el programa (main.js) en un puerto libre. Sin dependencias.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 5178;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
};
const imaging = require('./imaging.js'); // JPG, PNG, WebP, TIFF, HEIC y RAW
const IMG = { test: f => imaging.isImage(f) };

// Fuera del proyecto solo se puede escribir/leer donde el usuario eligió con el explorador de Windows.
const allowed = new Set();
if (process.env.MESA_ALLOW) allowed.add(path.resolve(process.env.MESA_ALLOW)); // solo para pruebas automáticas
// Proyectos creados con "Nueva mesa": se recuerdan (y se permiten) aunque se reinicie el servidor.
const REG = process.env.MESA_REG || path.join(__dirname, 'proyectos.json');
const readReg = () => { try { return JSON.parse(fs.readFileSync(REG, 'utf8')); } catch { return []; } };
const writeReg = list => fs.writeFileSync(REG, JSON.stringify(list, null, 1));
for (const p of readReg()) if (p?.path) allowed.add(path.resolve(p.path));
function httpsFetch(url, opt = {}, hops = 0) { // reemplazo mínimo de fetch para Node 16
  return new Promise((ok, ko) => {
    const lib = url.startsWith('https:') ? require('https') : require('http');
    lib.get(url, { headers: opt.headers || {} }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) { res.resume(); return ok(httpsFetch(new URL(res.headers.location, url).href, opt, hops + 1)); }
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const buf = Buffer.concat(chunks);
        ok({ ok: res.statusCode < 400, status: res.statusCode, headers: { get: k => res.headers[k.toLowerCase()] }, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
      });
    }).on('error', ko);
  });
}
const IMG_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const inside = (p, base) => p === base || p.startsWith(base + path.sep);
function safe(rel) {
  const p = path.resolve(ROOT, rel || '.');
  if (inside(p, ROOT) || [...allowed].some(a => inside(p, a))) return p;
  throw new Error('ruta no permitida (elegila con el explorador)');
}

// Ventanas del explorador de Windows (las modernas, como Photoshop), con PowerShell 7.
// kind: folder (elegir carpeta) · save (guardar .neo) · open (abrir .neo)
const { execFile } = require('child_process');
const os = require('os');
let dialogProvider = null, revealProvider = null;
function winDialog(kind, { name = '', start = '' } = {}) {
  if (dialogProvider) return Promise.resolve(dialogProvider(kind, { name, start })).then(p => p || '');
  const q = s => "'" + String(s).replace(/'/g, "''") + "'";
  const init = start && fs.existsSync(start) ? start : path.join(os.homedir(), 'Downloads');
  const dlg = {
    folder: `$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Elegí dónde crear la carpeta de la exportación'; $d.UseDescriptionForTitle = $true; $d.ShowNewFolderButton = $true; $d.InitialDirectory = ${q(init)}; if ($d.ShowDialog($w) -eq 'OK') { $d.SelectedPath }`,
    save: `$d = New-Object System.Windows.Forms.SaveFileDialog; $d.Title = 'Guardar proyecto'; $d.Filter = 'Proyecto Neo (*.neo)|*.neo'; $d.DefaultExt = 'neo'; $d.AddExtension = $true; $d.FileName = ${q(name)}; $d.InitialDirectory = ${q(init)}; $d.OverwritePrompt = $true; if ($d.ShowDialog($w) -eq 'OK') { $d.FileName }`,
    open: `$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Abrir proyecto'; $d.Filter = 'Proyecto Neo (*.neo)|*.neo'; $d.InitialDirectory = ${q(init)}; if ($d.ShowDialog($w) -eq 'OK') { $d.FileName }`,
  }[kind];
  // una ventana invisible "siempre adelante" como dueña, para que el explorador no quede detrás del navegador
  const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::EnableVisualStyles(); $w = New-Object System.Windows.Forms.Form; $w.TopMost = $true; $w.ShowInTaskbar = $false; $w.Opacity = 0; $w.StartPosition = 'CenterScreen'; $w.Show(); $w.Activate(); ${dlg}; $w.Close()`;
  return new Promise(ok => {
    const run = exe => execFile(exe, ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 10 * 60 * 1000 }, (err, out) => {
      if (err && exe === 'pwsh') return run('powershell'); // sin PowerShell 7: el de Windows
      ok((out || '').trim().split(/\r?\n/).pop() || '');
    });
    run('pwsh');
  });
}
// guardar sin dejar archivos a medias (si se corta la luz o se cierra en el medio)
function writeSafe(f, data) {
  const tmp = f + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, f); } // OneDrive o el antivirus a veces traban el archivo: entonces se escribe directo
  catch { fs.writeFileSync(f, data); try { fs.unlinkSync(tmp); } catch {} }
}
function body(req) {
  return new Promise((ok, ko) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', ko);
  });
}
function send(res, code, data, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

// PDF mínimo: una página por JPG (DCTDecode), sin recomprimir.
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('JPG inválido');
}
function buildPdf(jpgs, wPt, hPt) {
  const objs = [];
  const add = b => { objs.push(b); return objs.length; };
  const kids = [];
  const pagesId = 2 + jpgs.length * 3; // reservado al final
  add(null); // 1: catalog (se completa luego)
  jpgs.forEach((buf, k) => {
    const { w, h } = jpegSize(buf);
    const imgId = add(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${buf.length} >>\nstream\n`),
      buf, Buffer.from('\nendstream')]));
    const cs = `q ${wPt} 0 0 ${hPt} 0 0 cm /Im${k} Do Q`;
    const csId = add(Buffer.from(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    const pgId = add(Buffer.from(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im${k} ${imgId} 0 R >> >> /Contents ${csId} 0 R >>`));
    kids.push(`${pgId} 0 R`);
  });
  add(Buffer.from(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`));
  objs[0] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let off = parts[0].length;
  const xref = [];
  objs.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    xref.push(off); off += b.length; parts.push(b);
  });
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  xref.forEach(o => { x += String(o).padStart(10, '0') + ' 00000 n \n'; });
  x += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${off}\n%%EOF`;
  parts.push(Buffer.from(x));
  return Buffer.concat(parts);
}

// EXIF mínimo: fecha de toma y cámara (para acomodar por fecha / cámara).
function exifInfo(file) {
  const out = {};
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, b, 0, b.length, 0);
    fs.closeSync(fd);
    const tag = b.toString('latin1', 0, 4);
    if (tag === 'II*\0' || tag === 'MM\0*') { parseTiff(b, 0, out); return out; } // TIFF, NEF, CR2, ARW, DNG…
    if (b[0] !== 0xff || b[1] !== 0xd8) return out;
    let i = 2;
    while (i + 4 < n && b[i] === 0xff) {
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m === 0xe1 && b.toString('latin1', i + 4, i + 10) === 'Exif\0\0') { parseTiff(b, i + 10, out); break; }
      if (m === 0xda) break;
      i += 2 + len;
    }
  } catch { /* sin EXIF */ }
  return out;
}
function parseTiff(b, t, out) {
  const le = b.toString('latin1', t, t + 2) === 'II';
  const u16 = o => le ? b.readUInt16LE(o) : b.readUInt16BE(o);
  const u32 = o => le ? b.readUInt32LE(o) : b.readUInt32BE(o);
  const str = e => { const c = u32(e + 4), off = c <= 4 ? e + 8 : t + u32(e + 8); return b.toString('latin1', off, off + c).replace(/\0[\s\S]*$/, '').trim(); };
  const ifd = (o, cb) => {
    if (!o || t + o + 2 > b.length) return;
    const c = u16(t + o);
    for (let k = 0; k < c; k++) { const e = t + o + 2 + k * 12; if (e + 12 > b.length) return; cb(u16(e), e); }
  };
  let exifPtr = 0;
  ifd(u32(t + 4), (tag, e) => {
    if (tag === 0x010f) out.make = str(e);
    if (tag === 0x0110) out.model = str(e);
    if (tag === 0x0132 && !out.date) out.date = str(e);
    if (tag === 0x8769) exifPtr = u32(e + 8);
  });
  const rat = e => { const o = t + u32(e + 8), d = u32(o + 4); return d ? u32(o) / d : null; }; // número con coma (racional)
  ifd(exifPtr, (tag, e) => {
    if (tag === 0x9003) out.date = str(e);
    if (tag === 0x920a) out.focal = rat(e);          // distancia focal (mm)
    if (tag === 0xa405) out.focal35 = u16(e + 8);     // equivalente en 35 mm
    if (tag === 0x9209) out.flash = !!(u16(e + 8) & 1); // se disparó el flash
  });
}

const srv = http.createServer(async (req, res) => {
  try {
    // solo la propia mesa puede usar el servidor (ni otras páginas web ni otros sitios disfrazados de localhost)
    const host = String(req.headers.host || '').replace(/:\d+$/, ''), origin = req.headers.origin;
    if (!/^(127\.0\.0\.1|localhost)$/.test(host)) return send(res, 403, { error: 'acceso no permitido' });
    if (origin && origin !== 'null') { let oh = ''; try { oh = new URL(origin).host; } catch {} if (oh !== req.headers.host) return send(res, 403, { error: 'acceso no permitido' }); }
    const u = new URL(req.url, 'http://x');
    const q = k => u.searchParams.get(k);
    if (u.pathname === '/api/new-project' && req.method === 'POST') { // crear la carpeta del proyecto
      const parent = safe(q('parent')); // tiene que ser una carpeta elegida con el explorador
      const name = (q('name') || 'Proyecto nuevo').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || 'Proyecto nuevo';
      let dir = path.join(parent, name);
      for (let k = 2; fs.existsSync(dir); k++) dir = path.join(parent, `${name} (${k})`); // nunca usa una carpeta que ya existe
      fs.mkdirSync(dir, { recursive: true });
      allowed.add(dir);
      writeReg([{ path: dir, name: path.basename(dir), created: new Date().toISOString() }, ...readReg().filter(p => p.path !== dir)]);
      return send(res, 200, { path: dir, name: path.basename(dir) });
    }
    if (u.pathname === '/api/adopt' && req.method === 'POST') { // abrir un .neo: permitir su carpeta de fotos
      const neo = safe(q('neo'));
      const d = JSON.parse(fs.readFileSync(neo, 'utf8'));
      const fotos = d?.fotos && path.resolve(d.fotos);
      if (!fotos || !fs.existsSync(fotos)) throw new Error('no encuentro la carpeta de fotos de ese proyecto');
      const root = fotos === path.join(ROOT, 'Fotos MDP');
      if (!root) { allowed.add(fotos); writeReg([{ path: fotos, name: path.basename(fotos), created: new Date().toISOString() }, ...readReg().filter(p => path.resolve(p.path) !== fotos)]); }
      return send(res, 200, { fotos, root });
    }
    if (u.pathname === '/api/projects') { // proyectos recientes (los que siguen existiendo)
      const list = readReg().filter(p => p?.path && fs.existsSync(p.path));
      if (req.method === 'POST') { // marcar como abierto recién (va primero en la lista)
        const p = path.resolve(q('path')), it = list.find(x => path.resolve(x.path) === p);
        if (it) { it.opened = new Date().toISOString(); writeReg([it, ...list.filter(x => x !== it)]); }
        return send(res, 200, { ok: true });
      }
      return send(res, 200, list.map(p => ({ ...p, photos: fs.readdirSync(p.path).filter(x => IMG.test(x)).length })));
    }
    if (u.pathname === '/api/img') { // una foto: vista previa (w = lado más largo) o completa (full=1) con tope en megapíxeles
      const p = safe(q('path')), cap = Math.max(4, Math.min(100, Number(q('cap')) || 40));
      if (!IMG.test(p) || !fs.existsSync(p)) return send(res, 404, 'no encontrada', 'text/plain; charset=utf-8');
      const head = { 'Cache-Control': 'no-store' };
      let f = p;
      if (q('full')) f = (await imaging.full(p, cap)).file;
      else if (q('w') && imaging.hasSharp) {
        const r = await imaging.preview(p, Math.max(400, Math.min(4000, Number(q('w')) || 2000)), cap);
        f = r.file; Object.assign(head, { 'X-Img-W': r.w, 'X-Img-H': r.h, 'X-Orig-W': r.ow, 'X-Orig-H': r.oh });
      } else if (!imaging.WEB.test(p)) f = (await imaging.full(p, cap)).file;
      head['Content-Type'] = IMG_TYPES[path.extname(f).toLowerCase()] || 'image/jpeg';
      res.writeHead(200, head);
      return fs.createReadStream(f).pipe(res);
    }
    if (u.pathname === '/api/formats') return send(res, 200, { label: imaging.extsLabel, all: imaging.hasSharp });
    if (u.pathname === '/api/dialog' && req.method === 'POST') { // explorador de Windows
      const kind = q('kind'), p = await winDialog(kind, { name: q('name') || '', start: q('start') || '' });
      if (!p) return send(res, 200, { cancel: true });
      allowed.add(kind === 'folder' ? path.resolve(p) : path.resolve(p)); // se permite solo lo elegido
      return send(res, 200, { path: path.resolve(p) });
    }
    if (u.pathname === '/api/file') { // leer / escribir un archivo elegido (proyecto .neo)
      const p = safe(q('path'));
      if (!/\.neo$/i.test(p)) throw new Error('solo archivos .neo');
      if (req.method === 'POST') { writeSafe(p, await body(req)); return send(res, 200, { ok: true }); }
      return send(res, 200, fs.readFileSync(p));
    }
    if (u.pathname === '/api/reveal' && req.method === 'POST') { // abrir una carpeta en el explorador
      const p = safe(q('path'));
      if (revealProvider) revealProvider(p); else execFile('explorer.exe', [p], () => {});
      return send(res, 200, { ok: true });
    }
    // fotos nuevas: arrastradas desde el explorador / pegadas (archivo) o desde internet (url)
    if ((u.pathname === '/api/upload' || u.pathname === '/api/import-url') && req.method === 'POST') {
      const dir = safe(q('dir'));
      fs.mkdirSync(dir, { recursive: true });
      let buf, name, type = '';
      if (u.pathname === '/api/upload') { buf = await body(req); name = q('name') || 'pegada.png'; type = req.headers['content-type'] || ''; }
      else {
        const url = q('url');
        if (!/^https?:\/\//i.test(url)) throw new Error('no es una dirección de internet');
        const r = await (globalThis.fetch || httpsFetch)(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MesaDeFotos/1.0', Accept: 'image/*,*/*;q=0.8' }, redirect: 'follow' });
        if (!r.ok) throw new Error(`no se pudo descargar (${r.status}${r.status === 401 || r.status === 403 ? ': ese sitio pide iniciar sesión, descargala y arrastrala' : ''})`);
        type = r.headers.get('content-type') || '';
        buf = Buffer.from(await r.arrayBuffer());
        name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'de internet';
      }
      // extensión: la del nombre, o la del tipo de archivo; solo fotos que el navegador muestra
      const ext = (imaging.isImage(name) && name.match(/\.([a-z0-9]+)$/i) || [])[1] || { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type.split(';')[0].trim()];
      if (!ext) throw new Error('solo fotos ' + imaging.extsLabel);
      let stem = path.basename(name).replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
      if (!stem || /^(image|imagen|clipboard|blob)$/i.test(stem)) stem = 'pegada ' + new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
      let file = `${stem}.${ext.toLowerCase()}`;
      for (let k = 2; fs.existsSync(path.join(dir, file)); k++) file = `${stem} (${k}).${ext.toLowerCase()}`; // nunca pisa otra foto
      fs.writeFileSync(path.join(dir, file), buf);
      return send(res, 200, { name: file });
    }
    if (u.pathname === '/api/version') return send(res, 200, { v: 2 }); // la mesa compara con la suya
    if (u.pathname === '/api/root') return send(res, 200, { root: ROOT, photos: path.join(ROOT, 'Fotos MDP') });
    if (u.pathname === '/api/list') {
      const dir = safe(q('dir'));
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => IMG.test(f)).sort((a, b) => a.localeCompare(b, 'es', { numeric: true })) : [];
      return send(res, 200, files);
    }
    if (u.pathname === '/api/exif') {
      const dir = safe(q('dir')), info = {};
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => IMG.test(f))) {
        const p = path.join(dir, f), x = exifInfo(p);
        info[f] = { date: x.date || fs.statSync(p).mtime.toISOString().replace('T', ' ').slice(0, 19).replace(/-/g, ':'), camera: (x.model && x.make && x.model.toUpperCase().startsWith(x.make.split(' ')[0].toUpperCase()) ? x.model : [x.make, x.model].filter(Boolean).join(' ')) || 'Sin datos', exif: !!x.date, focal: x.focal35 || (x.focal ? Math.round(x.focal * 10) / 10 : null), focalReal: x.focal ? Math.round(x.focal * 10) / 10 : null, flash: x.flash ?? null };
      }
      return send(res, 200, info);
    }
    if (u.pathname === '/api/state') {
      const f = safe(q('file'));
      if (req.method === 'POST') { writeSafe(f, await body(req)); return send(res, 200, { ok: true }); }
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f)) : send(res, 200, 'null');
    }
    if (u.pathname === '/api/save' && req.method === 'POST') {
      const dir = safe(q('dir'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, path.basename(q('name'))), await body(req));
      return send(res, 200, { ok: true });
    }
    if (u.pathname === '/api/clear' && req.method === 'POST') {
      // Borra solo las hojas generadas por la mesa ("<prefijo>A3 hoja NN.jpg").
      const dir = safe(q('dir')), pre = (q('prefix') || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${pre}A[34] hoja \\d+\\.jpg$`);
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (re.test(f)) fs.unlinkSync(path.join(dir, f));
      return send(res, 200, { ok: true });
    }
    if (u.pathname === '/api/pdf' && req.method === 'POST') {
      const dir = safe(q('dir'));
      const { files, name, wPt, hPt } = JSON.parse(await body(req));
      const pdf = buildPdf(files.map(f => fs.readFileSync(path.join(dir, path.basename(f)))), wPt, hPt);
      fs.writeFileSync(path.join(dir, path.basename(name)), pdf);
      return send(res, 200, { ok: true });
    }
    // estáticos
    let p = safe(decodeURIComponent(u.pathname).replace(/^\/+/, ''));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) return send(res, 404, 'no encontrado', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});
if (require.main === module) srv.listen(PORT, '127.0.0.1', () => console.log(`Kyro Neo Board en http://localhost:${PORT}/`));
module.exports = {
  start: (port = 0) => new Promise((ok, ko) => { srv.once('error', ko); srv.listen(port, '127.0.0.1', () => ok(srv.address().port)); }),
  allowPath: p => allowed.add(path.resolve(p)),       // permitir un archivo/carpeta (p. ej. un .neo abierto con doble clic)
  setDialog: fn => { dialogProvider = fn; },           // explorador nativo del programa
  setReveal: fn => { revealProvider = fn; },           // abrir una carpeta
};

