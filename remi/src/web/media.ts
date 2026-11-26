/**
 * Optional voice/video: WebRTC mesh (max 4 players) with signalling relayed by the room Durable Object.
 * Independent of gameplay: any failure here only affects media. Nothing is ever recorded.
 */
import { useStore, useMedia, MediaPeer } from './store';
import { onRtc, send } from './net';
import { roomTokens } from './api';

const pcs = new Map<string, { pc: RTCPeerConnection; makingOffer: boolean; ignoreOffer: boolean; analyser?: AnalyserNode }>();
let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
let audioCtx: AudioContext | null = null;
let speakTimer: number | undefined;
let unsub: (() => void) | null = null;
let active = false;

const myPid = () => useStore.getState().you?.pid ?? '';
function patchPeer(pid: string, p: Partial<MediaPeer>) {
  const peers = useMedia.getState().peers;
  const cur = peers[pid] ?? { pid, stream: null, speaking: false, volume: 1, muted: false, hiddenVideo: false, state: 'new' };
  useMedia.setState({ peers: { ...peers, [pid]: { ...cur, ...p } } });
}

let activating: Promise<void> | null = null;
function ensureActive(): Promise<void> { return (activating ??= doActivate()); }
async function doActivate() {
  active = true;
  const room = useStore.getState().room!;
  try {
    const tok = roomTokens.get(room.code);
    const r = await fetch(`/api/rooms/${room.code}/ice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tok?.token }) });
    if (r.ok) iceServers = ((await r.json()) as any).iceServers;
  } catch { /* STUN fallback */ }
  speakTimer = window.setInterval(detectSpeakers, 120);
  syncPeers();
}

/** Connect to every other seated, connected player. The lexicographically smaller pid makes the offer. */
export function syncPeers() {
  if (!active) return;
  const st = useStore.getState(); const me = myPid();
  const others = (st.room?.members ?? []).filter((m) => m.role === 'player' && m.connected && m.pid !== me).map((m) => m.pid);
  for (const pid of others) if (!pcs.has(pid)) createPc(pid);
  for (const pid of [...pcs.keys()]) if (!others.includes(pid)) closePc(pid);
}
useStore.subscribe((s, p) => { if (s.room?.members !== p.room?.members) syncPeers(); });

function createPc(pid: string) {
  const pc = new RTCPeerConnection({ iceServers });
  const entry = { pc, makingOffer: false, ignoreOffer: false } as { pc: RTCPeerConnection; makingOffer: boolean; ignoreOffer: boolean; analyser?: AnalyserNode };
  pcs.set(pid, entry);
  const local = useMedia.getState().local;
  if (local) for (const tr of local.getTracks()) pc.addTrack(tr, local);
  else { pc.addTransceiver('audio', { direction: 'recvonly' }); pc.addTransceiver('video', { direction: 'recvonly' }); }
  pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'rtc', to: pid, data: { candidate: e.candidate.toJSON() } }); };
  pc.onnegotiationneeded = async () => {
    try { entry.makingOffer = true; await pc.setLocalDescription(); send({ t: 'rtc', to: pid, data: { description: pc.localDescription } }); }
    catch { /* ignore */ } finally { entry.makingOffer = false; }
  };
  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    patchPeer(pid, { stream });
    if (e.track.kind === 'audio') attachAnalyser(pid, stream);
  };
  pc.onconnectionstatechange = () => {
    patchPeer(pid, { state: pc.connectionState });
    if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch { closePc(pid); setTimeout(syncPeers, 1500); } }
  };
  patchPeer(pid, { state: 'connecting' });
}

/** Signalling is always listened to and processed strictly in order, per peer. */
const sigQueue = new Map<string, Promise<void>>();
unsub = onRtc((from, data) => {
  const prev = sigQueue.get(from) ?? Promise.resolve();
  const next = prev.then(() => onSignal(from, data)).catch(() => undefined);
  sigQueue.set(from, next);
}) as any;
const offerSince = new Map<string, number>();

async function onSignal(from: string, data: any) {
  const room = useStore.getState().room;
  if (!room || (!room.config.voice && !room.config.video) || useStore.getState().you?.role !== 'player') return;
  await ensureActive();
  let entry = pcs.get(from);
  if (!entry) { createPc(from); entry = pcs.get(from)!; }
  const { pc } = entry;
  const polite = myPid() > from;
  try {
    if (data.description) {
      const collision = data.description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
      entry.ignoreOffer = !polite && collision;
      if (entry.ignoreOffer) return;
      await pc.setRemoteDescription(data.description);
      if (data.description.type === 'offer') { await pc.setLocalDescription(); send({ t: 'rtc', to: from, data: { description: pc.localDescription } }); }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!entry.ignoreOffer) throw e; }
    }
  } catch (e) { useMedia.setState({ error: String(e) }); }
}

function attachAnalyser(pid: string, stream: MediaStream) {
  try {
    audioCtx ??= new AudioContext();
    const an = audioCtx.createAnalyser(); an.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(an);
    const e = pcs.get(pid); if (e) e.analyser = an;
  } catch { /* ignore */ }
}
let localAnalyser: AnalyserNode | null = null;
const buf = new Uint8Array(512);
function level(an: AnalyserNode) { an.getByteTimeDomainData(buf); let m = 0; for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i] - 128)); return m / 128; }
function remoteLevel(e: { pc: RTCPeerConnection; analyser?: AnalyserNode }): number {
  // WebRTC's own per-receiver audio level (reliable for remote streams, no WebAudio needed)
  let lv = 0;
  for (const r of e.pc.getReceivers()) if (r.track?.kind === 'audio') for (const s of r.getSynchronizationSources?.() ?? []) if (performance.timeOrigin + performance.now() - s.timestamp < 1000 || true) lv = Math.max(lv, s.audioLevel ?? 0);
  if (!lv && e.analyser) lv = level(e.analyser);
  return lv;
}
/** Renegotiate if a local track was added during another negotiation and never made it into the session. */
let lastHeal = 0;
function healNegotiation() {
  const now = performance.now(); if (now - lastHeal < 1500) return; lastHeal = now;
  for (const [pid, e] of pcs) {
    const pc = e.pc;
    if (pc.signalingState === 'have-local-offer') {
      // an offer nobody answered (e.g. lost during a reconnect): roll back and offer again
      const since = offerSince.get(pid) ?? now; offerSince.set(pid, since);
      if (now - since > 5000) { offerSince.delete(pid); pc.setLocalDescription({ type: 'rollback' }).then(() => { lastHeal = 0; }).catch(() => null); }
      continue;
    }
    offerSince.delete(pid);
    if (pc.signalingState !== 'stable' || e.makingOffer) continue;
    const stale = pc.getTransceivers().some((t) => t.sender.track && !(t.currentDirection ?? '').includes('send'));
    if (!stale) continue;
    (async () => { try { e.makingOffer = true; await pc.setLocalDescription(); send({ t: 'rtc', to: pid, data: { description: pc.localDescription } }); } catch { /* retry next tick */ } finally { e.makingOffer = false; } })();
  }
}
function detectSpeakers() {
  healNegotiation();
  const peers = useMedia.getState().peers;
  let changed = false; const next = { ...peers };
  if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => null);
  for (const [pid, e] of pcs) {
    if (!next[pid]) continue;
    const sp = !next[pid].muted && remoteLevel(e) > 0.03;
    if (sp !== next[pid].speaking) { next[pid] = { ...next[pid], speaking: sp }; changed = true; }
  }
  if (changed) useMedia.setState({ peers: next });
  if (localAnalyser) { const sp = useMedia.getState().micOn && level(localAnalyser) > 0.06; if (sp !== useMedia.getState().localSpeaking) useMedia.setState({ localSpeaking: sp }); }
}

const VIDEO: Record<string, { h: number; fps: number; br: number }> = { low: { h: 180, fps: 15, br: 150_000 }, balanced: { h: 360, fps: 24, br: 450_000 }, high: { h: 720, fps: 30, br: 1_200_000 } };

const want = { mic: false, cam: false };
async function setLocal(mic: boolean, cam: boolean) {
  const s = useStore.getState().settings;
  const m = useMedia.getState();
  let stream = m.local;
  try {
    if (mic && !stream?.getAudioTracks().length) {
      const a = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: s.micId || undefined } });
      stream = new MediaStream([...(stream?.getTracks() ?? []), ...a.getAudioTracks()]);
      audioCtx ??= new AudioContext(); localAnalyser = audioCtx.createAnalyser(); audioCtx.createMediaStreamSource(new MediaStream(a.getAudioTracks())).connect(localAnalyser);
    }
    if (cam && !stream?.getVideoTracks().length) {
      const q = VIDEO[s.videoQuality];
      const v = await navigator.mediaDevices.getUserMedia({ video: { height: { ideal: q.h }, frameRate: { max: q.fps }, deviceId: s.camId || undefined, facingMode: s.camId ? undefined : 'user' } });
      stream = new MediaStream([...(stream?.getTracks() ?? []), ...v.getVideoTracks()]);
    }
  } catch (e: any) {
    useMedia.setState({ error: e?.name === 'NotAllowedError' ? 'permission_denied' : String(e?.message ?? e) });
    want.mic = m.micOn; want.cam = m.camOn; // roll back only the request that failed
    useStore.getState().toast(e?.name === 'NotAllowedError' ? 'Permisiune refuzată pentru microfon/cameră.' : 'Dispozitiv media indisponibil.', 'error');
    return;
  }
  if (stream) {
    for (const tr of stream.getAudioTracks()) { if (!mic) { tr.stop(); stream.removeTrack(tr); } else tr.enabled = !s.pushToTalk; }
    for (const tr of stream.getVideoTracks()) if (!cam) { tr.stop(); stream.removeTrack(tr); }
  }
  useMedia.setState({ local: stream && stream.getTracks().length ? stream : null, micOn: mic && !!stream?.getAudioTracks().length, camOn: cam && !!stream?.getVideoTracks().length });
  send({ t: 'media', mic: useMedia.getState().micOn, cam: useMedia.getState().camOn });
  await ensureActive();
  // (re)attach tracks to every connection
  for (const [, { pc }] of pcs) {
    const senders = pc.getSenders();
    for (const kind of ['audio', 'video'] as const) {
      const track = stream?.getTracks().find((x) => x.kind === kind) ?? null;
      const sender = senders.find((x) => x.track?.kind === kind) ?? pc.getTransceivers().find((tr) => tr.receiver.track.kind === kind)?.sender;
      if (sender) {
        await sender.replaceTrack(track).catch(() => null);
        const tr = pc.getTransceivers().find((x) => x.sender === sender); if (tr && track) tr.direction = 'sendrecv';
        if (kind === 'video' && track) {
          const q = VIDEO[s.videoQuality]; const p = sender.getParameters();
          p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: Math.round(q.br / Math.max(1, pcs.size / 2)), maxFramerate: q.fps }];
          (p as any).degradationPreference = 'maintain-framerate';
          await sender.setParameters(p).catch(() => null);
        }
      } else if (track && stream) pc.addTrack(track, stream);
    }
  }
}

/** Media changes are queued: rapid taps on mic then camera can never read stale state. */
let chain: Promise<void> = Promise.resolve();
function apply() {
  chain = chain.then(() => setLocal(want.mic, want.cam)).catch(() => undefined);
  return chain;
}
export function toggleMic() { want.mic = !want.mic; return apply(); }
export function toggleCam() { want.cam = !want.cam; return apply(); }
export function muteAll(muted: boolean) { const peers = useMedia.getState().peers; const n: typeof peers = {}; for (const [k, p] of Object.entries(peers)) n[k] = { ...p, muted }; useMedia.setState({ peers: n }); }

// push-to-talk: hold Space
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && useStore.getState().settings.pushToTalk && !(e.target as HTMLElement)?.closest('input,textarea')) useMedia.getState().local?.getAudioTracks().forEach((t) => (t.enabled = true)); });
window.addEventListener('keyup', (e) => { if (e.code === 'Space' && useStore.getState().settings.pushToTalk) useMedia.getState().local?.getAudioTracks().forEach((t) => (t.enabled = false)); });

function closePc(pid: string) { const e = pcs.get(pid); if (e) { e.pc.close(); pcs.delete(pid); } const p = { ...useMedia.getState().peers }; delete p[pid]; useMedia.setState({ peers: p }); }

/** Stop all tracks and connections (leaving the room). */
export function stopMedia() {
  want.mic = false; want.cam = false;
  for (const pid of [...pcs.keys()]) closePc(pid);
  useMedia.getState().local?.getTracks().forEach((t) => t.stop());
  useMedia.setState({ local: null, micOn: false, camOn: false, peers: {}, localSpeaking: false });
  clearInterval(speakTimer); active = false; activating = null; localAnalyser = null; sigQueue.clear();
}
(window as any).__remiPcs = pcs;
