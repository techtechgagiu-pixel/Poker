/**
 * Generative background music (original, synthesized in the browser — no recordings, no licences needed).
 * Four styles that never loop: chords follow a Markov chain, melodies are built from motifs with variation,
 * and the key modulates every few minutes. Volume = master × music; off when the music slider is 0.
 */
import { useStore } from './store';
import { audioOut, audioReady } from './sound';

type Track = 'piano' | 'jazz' | 'guitar' | 'calm';
const A4 = 440;
const hz = (midi: number) => A4 * 2 ** ((midi - 69) / 12);
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rnd(a.length)];

let bus: GainNode | null = null;
let verb: ConvolverNode | null = null;
let timer: number | undefined;
let playing: Track | null = null;
let nextTime = 0;
let step = 0;
let state: any = {};

function makeReverb(c: AudioContext, seconds = 2.8) {
  const len = c.sampleRate * seconds; const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3; }
  const v = c.createConvolver(); v.buffer = b; return v;
}

function out(c: AudioContext, wet = 0.25) {
  const g = c.createGain(); const dry = c.createGain(); const w = c.createGain();
  dry.gain.value = 1 - wet; w.gain.value = wet;
  g.connect(dry).connect(bus!); g.connect(w).connect(verb!);
  return g;
}

// ------------------------------------------------------------------ instruments
function piano(c: AudioContext, midi: number, t: number, dur: number, vel = 0.5, wet = 0.3) {
  const o = out(c, wet); const g = c.createGain(); g.connect(o);
  const f = hz(midi); const decay = Math.min(4, 1.2 + (84 - midi) * 0.05);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel * 0.32, t + 0.008);
  g.gain.exponentialRampToValueAtTime(vel * 0.12, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(decay, dur + 0.8));
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800 + midi * 25; lp.connect(g);
  for (const [mult, amp, type] of [[1, 1, 'sine'], [2, 0.32, 'sine'], [3, 0.12, 'triangle'], [1.003, 0.4, 'triangle']] as const) {
    const osc = c.createOscillator(); osc.type = type; osc.frequency.value = f * mult;
    const a = c.createGain(); a.gain.value = amp; osc.connect(a).connect(lp); osc.start(t); osc.stop(t + decay + 0.1);
  }
}
function epiano(c: AudioContext, midi: number, t: number, dur: number, vel = 0.4) {
  const o = out(c, 0.22); const g = c.createGain(); g.connect(o);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel * 0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.2);
  const car = c.createOscillator(); car.frequency.value = hz(midi);
  const mod = c.createOscillator(); mod.frequency.value = hz(midi) * 1; const mg = c.createGain();
  mg.gain.setValueAtTime(hz(midi) * 1.6, t); mg.gain.exponentialRampToValueAtTime(hz(midi) * 0.15, t + 0.4);
  mod.connect(mg).connect(car.frequency); car.connect(g);
  car.start(t); mod.start(t); car.stop(t + dur + 1.3); mod.stop(t + dur + 1.3);
}
function bass(c: AudioContext, midi: number, t: number, dur: number, vel = 0.6) {
  const o = out(c, 0.08); const g = c.createGain(); g.connect(o);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel * 0.45, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.95);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.connect(g);
  const osc = c.createOscillator(); osc.type = 'triangle'; osc.frequency.value = hz(midi); osc.connect(lp); osc.start(t); osc.stop(t + dur);
}
let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext) { if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return noiseBuf; }
function brush(c: AudioContext, t: number, vel = 0.2, len = 0.12) {
  const o = out(c, 0.1); const s = c.createBufferSource(); s.buffer = noise(c);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5500; bp.Q.value = 0.8;
  const g = c.createGain(); g.gain.setValueAtTime(vel * 0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  s.connect(bp).connect(g).connect(o); s.start(t, Math.random() * 0.5); s.stop(t + len + 0.02);
}
/** Plucked string (Karplus–Strong with a feedback delay line). */
function guitar(c: AudioContext, midi: number, t: number, vel = 0.5, ring = 2.6) {
  const o = out(c, 0.28); const f = hz(midi);
  const s = c.createBufferSource(); s.buffer = noise(c);
  const exc = c.createGain(); exc.gain.setValueAtTime(vel * 0.5, t); exc.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
  const d = c.createDelay(0.05); d.delayTime.value = 1 / f;
  const fb = c.createGain(); fb.gain.value = 0.986; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
  const outG = c.createGain(); outG.gain.setValueAtTime(0.6, t); outG.gain.setValueAtTime(0.6, t + ring - 0.3); outG.gain.linearRampToValueAtTime(0, t + ring);
  s.connect(exc).connect(d); d.connect(lp).connect(fb).connect(d); d.connect(outG).connect(o);
  s.start(t); s.stop(t + 0.04);
  setTimeout(() => { try { fb.disconnect(); d.disconnect(); } catch { /* */ } }, (t - c.currentTime + ring + 0.2) * 1000);
}
function pad(c: AudioContext, midis: number[], t: number, dur: number, vel = 0.25) {
  const o = out(c, 0.45); const g = c.createGain(); g.connect(o);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel * 0.12, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.connect(g);
  for (const m of midis) for (const det of [-6, 5]) { const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = hz(m); osc.detune.value = det; osc.connect(lp); osc.start(t); osc.stop(t + dur * 1.1); }
}

// ------------------------------------------------------------------ harmony
const MAJ = [0, 2, 4, 5, 7, 9, 11];
const deg = (key: number, scale: number[], d: number, oct = 0) => key + scale[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
/** Markov chain over scale degrees (0 = I). */
const NEXT: Record<number, number[]> = { 0: [3, 4, 5, 1, 3], 1: [4, 4, 6], 2: [5, 3], 3: [4, 0, 1, 4], 4: [0, 0, 5, 3], 5: [3, 1, 4], 6: [0, 2] };
const triad = (key: number, root: number, oct = 0, seventh = false) => [0, 2, 4, ...(seventh ? [6] : [])].map((x) => deg(key, MAJ, root + x, oct));

function newState(track: Track) {
  const keys = [60, 65, 67, 62, 58, 63];
  return { key: pick(keys), chord: 0, bar: 0, motif: Array.from({ length: 4 }, () => rnd(5)), modulateAt: 48 + rnd(32), track };
}

/** Schedule one beat of the current track at time t. */
function beat(c: AudioContext, t: number, spb: number) {
  const s = state; const b = step % 4; const bar = Math.floor(step / 4);
  if (b === 0) {
    if (bar > 0) s.chord = pick(NEXT[s.chord]);
    if (bar % 8 === 0) s.motif = s.motif.map((x: number) => (Math.random() < 0.35 ? rnd(6) : x)); // vary the motif each phrase
    if (bar >= s.modulateAt) { s.key = (s.key + pick([5, 7, -5, 2])) % 12 + 58; s.modulateAt = bar + 48 + rnd(40); }
  }
  const chordTones = triad(s.key, s.chord, -1);
  if (s.track === 'piano') {
    if (b === 0) { piano(c, chordTones[0] - 12, t, spb * 4, 0.45); chordTones.forEach((m, i) => piano(c, m, t + i * 0.03, spb * 3.5, 0.3)); }
    if (b === 2 && Math.random() < 0.6) chordTones.slice(1).forEach((m) => piano(c, m, t, spb * 2, 0.22));
    // melody: motif notes on beats, occasional eighth-note fills and rests
    if (Math.random() < 0.82) {
      const d = s.chord + s.motif[(b + bar) % 4] + (bar % 4 === 3 ? 0 : 0);
      piano(c, deg(s.key, MAJ, d, 1), t, spb * (Math.random() < 0.3 ? 2 : 1), 0.38 + Math.random() * 0.12);
      if (Math.random() < 0.25) piano(c, deg(s.key, MAJ, d + pick([1, -1, 2]), 1), t + spb / 2, spb / 2, 0.3);
    }
  } else if (s.track === 'jazz') {
    const sev = triad(s.key, s.chord, -1, true);
    // walking bass: chord tones and approach notes
    const walk = [sev[0] - 12, sev[1] - 12, sev[2] - 12, triad(s.key, pick(NEXT[s.chord]), -1)[0] - 12 + pick([-1, 1])];
    bass(c, walk[b], t, spb * 0.95, 0.55);
    brush(c, t, 0.25, 0.18); brush(c, t + spb * 0.66, 0.15, 0.08); // swung brushes
    if (b === 1 || (b === 3 && Math.random() < 0.6)) sev.slice(1).forEach((m) => epiano(c, m, t + spb * 0.66, spb * 0.6, 0.28));
    if (bar % 2 === 1 && Math.random() < 0.7) epiano(c, deg(s.key, MAJ, s.chord + s.motif[b] + 2, 1), t + (Math.random() < 0.5 ? 0 : spb * 0.66), spb, 0.33);
  } else if (s.track === 'guitar') {
    // Andalusian cadence in A minor-ish: i–VII–VI–V, with arpeggios and occasional rasgueado
    const AND = [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]];
    const ch = AND[bar % 4].map((m) => m + ((s.key - 60) % 5));
    const root = ch[0] - 12;
    if (b === 0) guitar(c, root, t, 0.6, 3);
    if (bar % 8 === 7 && b === 0) { for (let k = 0; k < 6; k++) guitar(c, [root, ...ch, ch[0] + 12][k % 5], t + k * 0.018, 0.45, 1.6); }
    else {
      const pattern = [ch[0], ch[2], ch[1] + 12, ch[2]];
      guitar(c, pattern[b] , t, 0.4); guitar(c, pattern[(b + 2) % 4] + (Math.random() < 0.2 ? 12 : 0), t + spb / 2, 0.32);
    }
  } else {
    if (b === 0 && bar % 2 === 0) pad(c, triad(s.key, s.chord, -1).concat(triad(s.key, s.chord, 0)[1]), t, spb * 8, 0.3);
    if (Math.random() < 0.18) piano(c, deg(s.key, [0, 2, 4, 7, 9, 12, 14], rnd(7), 1), t + Math.random() * spb, spb * 4, 0.22, 0.6);
  }
  step++;
}

const TEMPO: Record<Track, number> = { piano: 72, jazz: 92, guitar: 84, calm: 54 };

function schedule() {
  if (!playing || !bus) return;
  const { ctx: c } = audioOut();
  const spb = 60 / TEMPO[playing];
  while (nextTime < c.currentTime + 0.35) { try { beat(c, nextTime, spb); } catch { /* skip */ } nextTime += spb; }
}

function level() { const s = useStore.getState().settings; return s.mute ? 0 : s.master * s.music * 0.9; }

export function updateMusic() {
  const s = useStore.getState().settings;
  const want: Track | null = s.musicTrack !== 'none' && level() > 0.001 && audioReady() ? s.musicTrack : null;
  if (bus) bus.gain.setTargetAtTime(level(), audioOut().ctx.currentTime, 0.3);
  if (want === playing) return;
  stop();
  if (!want) return;
  const { ctx: c, master } = audioOut();
  bus = c.createGain(); bus.gain.value = 0; bus.connect(master); bus.gain.setTargetAtTime(level(), c.currentTime, 0.8);
  verb = makeReverb(c); verb.connect(bus);
  playing = want; state = newState(want); step = 0; nextTime = c.currentTime + 0.1;
  timer = window.setInterval(schedule, 100); schedule();
}

function stop() {
  clearInterval(timer); timer = undefined;
  if (bus) { const b = bus; const c = audioOut().ctx; b.gain.setTargetAtTime(0, c.currentTime, 0.4); setTimeout(() => b.disconnect(), 2500); }
  bus = null; verb = null; playing = null;
}

useStore.subscribe((st, prev) => { if (st.settings !== prev.settings) updateMusic(); });
['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, () => setTimeout(updateMusic, 50), { once: true, passive: true }));
(window as any).__remiMusic = () => ({ playing, step, key: state.key, chord: state.chord });
