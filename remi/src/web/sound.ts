/** Original synthesized sound effects and ambience (WebAudio). No third-party audio assets. */
import { useStore } from './store';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambientNode: { stop: () => void; gain: GainNode } | null = null;
function ac() {
  if (!ctx) { ctx = new AudioContext(); master = ctx.createGain(); master.connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => null);
  return ctx;
}
// unlock on first gesture (autoplay policies)
['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, () => { ac(); updateAmbient(); }, { once: true, passive: true }));

/** Shared audio graph for the music engine. */
export function audioOut() { const c = ac(); return { ctx: c, master: master! }; }
export function audioReady() { return !!ctx; }

function vol(kind: 'sfx' | 'notif') { const s = useStore.getState().settings; return s.mute ? 0 : s.master * s[kind]; }

function noiseBuffer(c: AudioContext, seconds: number) {
  const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function click(freq: number, dur: number, v: number, type: 'noise' | 'tone' = 'noise', delay = 0) {
  const c = ac(); const t = c.currentTime + delay; const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (type === 'noise') {
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c, dur + 0.02);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 2.5;
    src.connect(f).connect(g).connect(master!); src.start(t); src.stop(t + dur + 0.02);
  } else {
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(freq, t);
    o.connect(g).connect(master!); o.start(t); o.stop(t + dur + 0.02);
  }
}

export type Sfx = 'draw' | 'discard' | 'move' | 'snap' | 'turn' | 'pass' | 'atu' | 'joker' | 'win' | 'match' | 'error' | 'achievement' | 'notify';
export function sfx(name: Sfx) {
  const v = vol(name === 'notify' || name === 'turn' ? 'notif' : 'sfx');
  if (v <= 0.001) return;
  try {
    switch (name) {
      case 'draw': click(1800, 0.06, 0.5 * v); click(900, 0.08, 0.35 * v, 'noise', 0.04); break;
      case 'discard': click(700, 0.09, 0.8 * v); click(2400, 0.03, 0.3 * v, 'noise', 0.01); break;
      case 'move': click(3000, 0.025, 0.18 * v); break;
      case 'snap': click(1200, 0.035, 0.35 * v); break;
      case 'turn': click(880, 0.18, 0.25 * v, 'tone'); click(1320, 0.22, 0.2 * v, 'tone', 0.12); break;
      case 'pass': [523, 659, 784].forEach((f, i) => click(f, 0.25, 0.25 * v, 'tone', i * 0.09)); break;
      case 'atu': [784, 988].forEach((f, i) => click(f, 0.2, 0.25 * v, 'tone', i * 0.1)); break;
      case 'joker': [659, 880, 1175].forEach((f, i) => click(f, 0.25, 0.25 * v, 'tone', i * 0.07)); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => click(f, 0.3, 0.25 * v, 'tone', i * 0.11)); break;
      case 'match': [392, 523, 659, 784, 1047, 1319].forEach((f, i) => click(f, 0.4, 0.22 * v, 'tone', i * 0.12)); break;
      case 'achievement': [988, 1319, 1568].forEach((f, i) => click(f, 0.3, 0.2 * v, 'tone', i * 0.08)); break;
      case 'notify': click(1046, 0.15, 0.2 * v, 'tone'); break;
      case 'error': click(220, 0.15, 0.2 * v, 'tone'); break;
    }
  } catch { /* audio unavailable */ }
}

/** Ambient: generated crackling fireplace / soft lounge pad / quiet room tone. Disabled by default (music volume 0). */
export function updateAmbient() {
  const s = useStore.getState().settings;
  const v = s.mute ? 0 : s.master * s.music;
  if (v <= 0.001) { if (ambientNode) { ambientNode.stop(); ambientNode = null; } return; }
  if (!ctx) return; // wait for a gesture
  if (ambientNode && (ambientNode as any).kind === s.ambient) { ambientNode.gain.gain.value = v * 0.25; return; }
  if (ambientNode) ambientNode.stop();
  const c = ac(); const g = c.createGain(); g.gain.value = v * 0.25; g.connect(master!);
  const stops: (() => void)[] = [];
  if (s.ambient === 'waves') {
    // surf: low-passed noise whose level and brightness swell slowly, like waves reaching the shore
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c, 6); src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const ng = c.createGain(); ng.gain.value = 0.35;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.09; const lg = c.createGain(); lg.gain.value = 0.32; lfo.connect(lg).connect(ng.gain);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.09; const lf = c.createGain(); lf.gain.value = 450; lfo2.connect(lf).connect(f.frequency);
    src.connect(f).connect(ng).connect(g); src.start(); lfo.start(); lfo2.start();
    stops.push(() => { src.stop(); lfo.stop(); lfo2.stop(); });
  } else if (s.ambient === 'rain') {
    // steady rain bed (band-passed noise) plus random droplets
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c, 4); src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
    const ng = c.createGain(); ng.gain.value = 0.28;
    src.connect(hp).connect(lp).connect(ng).connect(g); src.start(); stops.push(() => src.stop());
    const iv = window.setInterval(() => { for (let k = 0; k < 3; k++) if (Math.random() < 0.7) click(3000 + Math.random() * 5000, 0.008 + Math.random() * 0.02, 0.06 * v, 'noise', Math.random() * 0.1); }, 110);
    stops.push(() => clearInterval(iv));
  } else if (s.ambient === 'lounge') {
    for (const f of [130.8, 196, 246.9]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.07 + Math.random() * 0.05; const lg = c.createGain(); lg.gain.value = 0.3;
      const og = c.createGain(); og.gain.value = 0.25; lfo.connect(lg).connect(og.gain); o.connect(og).connect(g); o.start(); lfo.start();
      stops.push(() => { o.stop(); lfo.stop(); });
    }
  } else {
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c, 4); src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = s.ambient === 'fire' ? 500 : 250;
    const ng = c.createGain(); ng.gain.value = s.ambient === 'fire' ? 0.5 : 0.25;
    src.connect(f).connect(ng).connect(g); src.start(); stops.push(() => src.stop());
    if (s.ambient === 'fire') {
      const iv = window.setInterval(() => { if (Math.random() < 0.6) click(2000 + Math.random() * 3000, 0.02 + Math.random() * 0.03, 0.15 * v); }, 180);
      stops.push(() => clearInterval(iv));
    }
  }
  ambientNode = { gain: g, stop: () => { stops.forEach((x) => x()); g.disconnect(); } };
  (ambientNode as any).kind = s.ambient;
}
useStore.subscribe((st, prev) => { if (st.settings !== prev.settings) updateAmbient(); });
