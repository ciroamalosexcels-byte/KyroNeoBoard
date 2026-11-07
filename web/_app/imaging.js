// Fotos de cualquier formato para la mesa: JPG, PNG, WebP, TIFF, HEIC/HEIF, AVIF y RAW de cámara.
// - Vista previa: chica y rápida (en caché), es lo que se ve en pantalla.
// - Completa: la resolución original (con un tope en megapíxeles), es lo que se exporta.
// RAW: se usa la JPG de tamaño completo que la cámara guarda adentro del archivo (la misma que muestra la cámara).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

let sharp = null;
try { sharp = require('sharp'); sharp.cache(false); } catch { /* motor viejo (Windows 7): solo JPG, PNG y WebP */ }
let heicDecode = null;
const heic = () => (heicDecode ??= require('heic-decode'));

const WEB = /\.(jpe?g|png|webp)$/i;
const RAW = /\.(nef|nrw|cr2|cr3|crw|arw|srf|sr2|dng|raf|orf|rw2|pef|srw|3fr|erf|kdc|mos|mrw|iiq|x3f|rwl)$/i;
const OTHER = /\.(tiff?|heic|heif|avif)$/i;
const IMG = sharp ? new RegExp(`(${WEB.source})|(${RAW.source})|(${OTHER.source})`, 'i') : WEB;
const isImage = f => IMG.test(f);

const CACHE = process.env.MESA_CACHE || path.join(os.tmpdir(), 'kyro-neo-board-cache');
fs.mkdirSync(CACHE, { recursive: true });

// --- caché: se borra lo que no se usó en 60 días, y si pasa de 3 GB, lo más viejo
function pruneCache() {
  try {
    const files = fs.readdirSync(CACHE).map(f => { const p = path.join(CACHE, f), s = fs.statSync(p); return { p, t: s.mtimeMs, n: s.size }; }).sort((a, b) => b.t - a.t);
    let total = 0; const old = Date.now() - 60 * 864e5;
    for (const f of files) { total += f.n; if (f.t < old || total > 3e9) try { fs.unlinkSync(f.p); } catch {} }
  } catch {}
}
setTimeout(pruneCache, 5000);

const keyOf = (file, variant) => { const s = fs.statSync(file); return crypto.createHash('sha1').update(`${path.resolve(file)}|${s.size}|${s.mtimeMs}|${variant}`).digest('hex'); };
const touch = p => { try { const t = new Date(); fs.utimesSync(p, t, t); } catch {} };

// --- RAW: buscar la JPG más grande que tiene adentro
function sofOf(b, i) { // ancho/alto de una JPG que empieza en i (o null si no es una JPG común)
  let p = i + 2;
  for (let k = 0; k < 80 && p + 9 < b.length; k++) {
    if (b[p] !== 0xff) return null;
    const m = b[p + 1], len = b.readUInt16BE(p + 2);
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) return { h: b.readUInt16BE(p + 5), w: b.readUInt16BE(p + 7) };
    if ((m >= 0xc3 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) || m === 0xda) return null; // sin pérdida (datos del sensor): no sirve
    p += 2 + len;
  }
  return null;
}
function embeddedJpegs(b) {
  const out = [], sig = Buffer.from([0xff, 0xd8, 0xff]), eoi = Buffer.from([0xff, 0xd9]);
  for (let i = b.indexOf(sig); i >= 0; i = b.indexOf(sig, i + 2)) {
    const d = sofOf(b, i);
    if (!d || d.w < 160 || d.h < 120) continue;
    const end = b.indexOf(eoi, i + 4);
    if (end > i) out.push({ start: i, end: end + 2, ...d });
  }
  return out.sort((a, c) => c.w * c.h - a.w * a.h);
}
function tiffOrientation(b) { // orientación guardada en el RAW (los basados en TIFF: NEF, CR2, ARW, DNG, ORF, PEF…)
  try {
    const le = b.toString('latin1', 0, 2) === 'II'; if (!le && b.toString('latin1', 0, 2) !== 'MM') return 1;
    const u16 = o => le ? b.readUInt16LE(o) : b.readUInt16BE(o), u32 = o => le ? b.readUInt32LE(o) : b.readUInt32BE(o);
    const ifd = u32(4), n = u16(ifd);
    for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (u16(e) === 0x0112) return u16(e + 8) || 1; }
  } catch {}
  return 1;
}
const ROT = { 3: 180, 6: 90, 8: 270 };

// --- abrir cualquier foto como "sharp", ya derecha (orientación aplicada)
const opts = { limitInputPixels: false, failOn: 'none' };
async function source(file) {
  if (!sharp) throw new Error('este formato necesita Windows 10 u 11');
  if (RAW.test(file)) {
    const b = fs.readFileSync(file), orient = tiffOrientation(b);
    for (const j of embeddedJpegs(b).slice(0, 3)) {
      const jpg = b.subarray(j.start, j.end);
      try {
        const m = await sharp(jpg, opts).metadata();
        let img = sharp(jpg, opts);
        img = m.orientation && m.orientation > 1 ? img.rotate() : ROT[orient] ? img.rotate(ROT[orient]) : img;
        const swap = (m.orientation >= 5) || (!(m.orientation > 1) && (orient === 6 || orient === 8));
        return { img, w: swap ? m.height : m.width, h: swap ? m.width : m.height, raw: true };
      } catch { /* esa no se pudo leer: la siguiente */ }
    }
    throw new Error('ese RAW no trae una foto adentro que se pueda leer');
  }
  if (/\.(heic|heif)$/i.test(file)) {
    try { const m = await sharp(file, opts).metadata(); if (m.width && m.compression === "av1") return upright(sharp(file, opts), m); } catch {} // HEIC del celular (HEVC): lo decodifica libheif
    const { width, height, data } = await heic()({ buffer: fs.readFileSync(file) });
    return { img: sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } }), w: width, h: height };
  }
  return upright(sharp(file, opts), await sharp(file, opts).metadata());
}
function upright(img, m) {
  const swap = (m.orientation || 1) >= 5;
  return { img: img.rotate(), w: swap ? m.height : m.width, h: swap ? m.width : m.height };
}

// de a poco: decodificar fotos grandes consume mucha memoria
let busy = 0; const waiting = [];
async function slot(fn) {
  if (busy >= 2) await new Promise(r => waiting.push(r));
  busy++;
  try { return await fn(); } finally { busy--; waiting.shift()?.(); }
}

const dimsFile = key => path.join(CACHE, key + '.json');
function fitCap(w, h, capMP) { const k = Math.min(1, Math.sqrt(capMP * 1e6 / (w * h))); return { w: Math.round(w * k), h: Math.round(h * k), k }; }

// Vista previa: JPG del lado más largo maxPx. Devuelve { file, w, h } (w/h = lo que se va a exportar, con el tope).
async function preview(file, maxPx, capMP) {
  const key = keyOf(file, `p${maxPx}`), out = path.join(CACHE, key + '.jpg'), dj = dimsFile(key);
  if (fs.existsSync(out) && fs.existsSync(dj)) { touch(out); touch(dj); const d = JSON.parse(fs.readFileSync(dj, 'utf8')); return { file: out, ...fitCap(d.w, d.h, capMP), ow: d.w, oh: d.h }; }
  return slot(async () => {
    const s = await source(file);
    await s.img.resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: false }).toFile(out + '.tmp');
    fs.renameSync(out + '.tmp', out);
    fs.writeFileSync(dj, JSON.stringify({ w: s.w, h: s.h }));
    return { file: out, ...fitCap(s.w, s.h, capMP), ow: s.w, oh: s.h };
  });
}

// Completa (para exportar): la original si el navegador la lee y no pasa el tope; si no, una JPG de máxima calidad.
async function full(file, capMP) {
  if (WEB.test(file) && (!sharp || await (async () => { const m = await sharp(file, opts).metadata(); return m.width * m.height <= capMP * 1e6; })())) return { file, original: true };
  const key = keyOf(file, `f${capMP}`), out = path.join(CACHE, key + '.jpg');
  if (fs.existsSync(out)) { touch(out); return { file: out }; }
  return slot(async () => {
    const s = await source(file), c = fitCap(s.w, s.h, capMP);
    let img = s.img;
    if (c.k < 1) img = img.resize({ width: c.w, height: c.h, fit: 'fill' });
    await img.flatten({ background: '#ffffff' }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(out + '.tmp');
    fs.renameSync(out + '.tmp', out);
    return { file: out };
  });
}

module.exports = { isImage, WEB, RAW, hasSharp: !!sharp, preview, full, embeddedJpegs, CACHE,
  extsLabel: sharp ? 'JPG, PNG, WebP, TIFF, HEIC o RAW' : 'JPG, PNG o WebP' };
