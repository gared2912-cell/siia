// Sonidos del beagle del semáforo, sintetizados con Web Audio (sin archivos): un ladrido corto y suave (amarillo) y un
// gruñido grave y tenue (rojo). El navegador solo deja sonar audio después de que la persona tocó la página; si aún no
// lo ha hecho, `sonar` regresa false y el semáforo lo intenta de nuevo al primer toque.

import type { VolumenBeagle } from '../../../amplify/functions/shared/beagle';
const NIVEL: Record<VolumenBeagle, number> = { 'muy-bajo': 0.07, bajo: 0.14, medio: 0.26 };

let ctx: AudioContext | null = null;
function contexto(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  return ctx;
}

function ruido(c: AudioContext, segundos: number) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * segundos), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = buf;
  return s;
}

/** Un «guau»: tono que baja rápido, con algo de aire, filtrado para que suene redondo y no chillón. */
function guau(c: AudioContext, salida: AudioNode, t: number, vol: number, tono = 1) {
  const dur = 0.2;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(560 * tono, t);
  o.frequency.exponentialRampToValueAtTime(300 * tono, t + 0.07);
  o.frequency.exponentialRampToValueAtTime(230 * tono, t + dur);
  const aire = ruido(c, dur);
  const gAire = c.createGain();
  gAire.gain.value = 0.25;
  const formante = c.createBiquadFilter();
  formante.type = 'bandpass';
  formante.frequency.setValueAtTime(1300 * tono, t);
  formante.frequency.exponentialRampToValueAtTime(650 * tono, t + dur);
  formante.Q.value = 1.4;
  const suave = c.createBiquadFilter();
  suave.type = 'lowpass';
  suave.frequency.value = 2000;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  env.gain.exponentialRampToValueAtTime(vol * 0.45, t + 0.08);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(formante);
  aire.connect(gAire).connect(formante);
  formante.connect(suave).connect(env).connect(salida);
  o.start(t);
  aire.start(t);
  o.stop(t + dur + 0.02);
  aire.stop(t + dur + 0.02);
}

/** «Grrr»: tono grave con vibración rápida (el «rrr») y un poco de aire, que entra y sale despacio. */
function grrr(c: AudioContext, salida: AudioNode, t: number, vol: number) {
  const dur = 1.5;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(92, t);
  o.frequency.linearRampToValueAtTime(110, t + 0.5);
  o.frequency.linearRampToValueAtTime(86, t + dur);
  // Vibración del gruñido: modula el volumen ~26 veces por segundo.
  const lfo = c.createOscillator();
  lfo.type = 'triangle';
  lfo.frequency.value = 26;
  const prof = c.createGain();
  prof.gain.value = 0.45;
  const trem = c.createGain();
  trem.gain.value = 0.55;
  lfo.connect(prof).connect(trem.gain);
  const aire = ruido(c, dur);
  const gAire = c.createGain();
  gAire.gain.value = 0.18;
  const filtro = c.createBiquadFilter();
  filtro.type = 'lowpass';
  filtro.frequency.value = 520;
  filtro.Q.value = 3;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(vol, t + 0.3);
  env.gain.setValueAtTime(vol, t + dur - 0.45);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(trem);
  aire.connect(gAire).connect(trem);
  trem.connect(filtro).connect(env).connect(salida);
  for (const n of [o, lfo, aire]) {
    n.start(t);
    n.stop(t + dur + 0.05);
  }
}

/**
 * Suena el beagle: «ladrido» (dos guau suaves) o «gruñido». Regresa false si el navegador aún no deja reproducir audio
 * (la persona no ha tocado la página) o no tiene Web Audio.
 */
export async function sonar(tipo: 'ladrido' | 'grunido', volumen: VolumenBeagle = 'bajo'): Promise<boolean> {
  const c = contexto();
  if (!c) return false;
  if (c.state !== 'running') {
    try {
      await c.resume();
    } catch {
      /* bloqueado hasta que la persona toque la página */
    }
  }
  if (c.state !== 'running') return false;
  const vol = NIVEL[volumen] ?? NIVEL.bajo;
  const master = c.createGain();
  master.gain.value = 1;
  master.connect(c.destination);
  const t = c.currentTime + 0.03;
  if (tipo === 'ladrido') {
    guau(c, master, t, vol, 1.05);
    guau(c, master, t + 0.32, vol * 0.9, 1);
  } else grrr(c, master, t, vol * 1.2);
  return true;
}
