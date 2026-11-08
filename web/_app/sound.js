// Kyro Neo Board · sonidos hechos con frecuencias (sin archivos de audio).
// Cada sonido: tres notas seguidas (nunca un acorde), onda pura con un armónico suave,
// ataque corto y caída larga, a veces una pulsación leve, y un eco corto con filtro.
import { cfg } from './mesa.js';

// [frecuencias (Hz), separación entre notas (s), caída de cada nota (s), volumen, pulsación (Hz)]
export const SOUNDS = {
  hola:    { name: 'Bienvenida',        f: [523.25, 659.25, 987.77],    gap: 0.15, d: 1.6,  v: 0.9 },  // do · mi · si
  sala:    { name: 'Sala abierta',      f: [587.33, 880.00, 1174.66],   gap: 0.11, d: 1.1,  v: 0.8 },  // re · la · re
  entra:   { name: 'Entra alguien',     f: [659.25, 830.61, 987.77],    gap: 0.08, d: 0.7,  v: 0.7 },  // mi · sol# · si
  sale:    { name: 'Sale alguien',      f: [987.77, 830.61, 659.25],    gap: 0.09, d: 0.7,  v: 0.55 },
  mensaje: { name: 'Mensaje',           f: [1046.50, 1318.51, 1567.98], gap: 0.06, d: 0.5,  v: 0.6, pulse: 11 },
  lienzo:  { name: 'Lienzo nuevo',      f: [392.00, 587.33, 783.99],    gap: 0.07, d: 0.45, v: 0.45 }, // sol · re · sol, bajito
  listo:   { name: 'Exportación lista', f: [523.25, 783.99, 1046.50],   gap: 0.13, d: 1.3,  v: 0.8 },
  cerrada: { name: 'Sala cerrada',      f: [783.99, 587.33, 392.00],    gap: 0.12, d: 0.9,  v: 0.6 },
};

// cadena: voces → filtro suave → (directo + eco) → volumen general
function chain(ctx, dest) {
  const master = ctx.createGain(); master.gain.value = 1.6;
  const soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 5200; soft.Q.value = 0.4;
  const delay = ctx.createDelay(1); delay.delayTime.value = 0.19;
  const fb = ctx.createGain(); fb.gain.value = 0.28;
  const wet = ctx.createGain(); wet.gain.value = 0.22;
  const dampen = ctx.createBiquadFilter(); dampen.type = 'lowpass'; dampen.frequency.value = 2600;
  soft.connect(master);
  soft.connect(delay); delay.connect(dampen); dampen.connect(fb); fb.connect(delay); dampen.connect(wet); wet.connect(master);
  master.connect(dest);
  return soft;
}
// una nota: frecuencia f, en el segundo t, con caída d, volumen v y pulsación opcional
function note(ctx, out, f, t, d, v = 1, pulse = 0) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22 * v, t + 0.012);   // ataque corto
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);          // caída larga
  const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.005; // armónico apenas desafinado: tibio
  const g2 = ctx.createGain(); g2.gain.value = 0.12;
  o1.connect(g); o2.connect(g2); g2.connect(g);
  let last = g;
  if (pulse) { // pulsación: el volumen late suave
    const trem = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = pulse; depth.gain.value = 0.35; trem.gain.value = 0.65;
    lfo.connect(depth); depth.connect(trem.gain); g.connect(trem); last = trem;
    lfo.start(t); lfo.stop(t + d + 0.05);
  }
  last.connect(out);
  o1.start(t); o2.start(t); o1.stop(t + d + 0.05); o2.stop(t + d + 0.05);
}
function schedule(ctx, out, s, t0) { s.f.forEach((f, i) => note(ctx, out, f, t0 + i * s.gap, s.d, s.v, s.pulse || 0)); }

let live = null, liveOut = null;
export function play(name, force) {
  if (!force && cfg().sound === 'off') return;
  const s = SOUNDS[name]; if (!s) return;
  if (!live) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    live = new AC(); liveOut = chain(live, live.destination);
  }
  if (live.state === 'suspended') live.resume();
  schedule(live, liveOut, s, live.currentTime + 0.03);
}

// para escucharlos sin abrir el programa (pruebas): el sonido como WAV
export async function renderWav(name, rate = 44100) {
  const s = SOUNDS[name], len = s.gap * 2 + s.d + 1.2;
  const off = new OfflineAudioContext(2, Math.ceil(len * rate), rate);
  schedule(off, chain(off, off.destination), s, 0.02);
  const buf = await off.startRendering(), n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1);
  const out = new DataView(new ArrayBuffer(44 + n * 4)), str = (o, t) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 4, true);
  let peak = 0;
  for (let i = 0; i < n; i++) { for (const [k, ch] of [[0, L], [1, R]]) { const v = Math.max(-1, Math.min(1, ch[i])); peak = Math.max(peak, Math.abs(ch[i])); out.setInt16(44 + i * 4 + k * 2, v * 32767, true); } }
  return { wav: new Uint8Array(out.buffer), peak, seconds: len };
}
