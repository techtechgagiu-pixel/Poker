/**
 * Optional voice/video: WebRTC mesh (max 4 players) with signalling relayed by the room Durable Object.
 * Independent of gameplay: any failure here only affects media. Nothing is ever recorded.
 */
import { useStore, useMedia, MediaPeer } from './store';
import { onRtc, send } from './net';
import { roomTokens } from './api';

/**
 * Connection per remote player. Roles are FIXED per pair: the player with the smaller id is the offerer and the only one
 * who ever makes offers; the other only answers. Both audio and video lines are created sendrecv from the start, so
 * turning a mic/camera on or off later just swaps tracks (replaceTrack) — no renegotiation, hence no glare between
 * players who toggle at the same time (which broke video in 4-player calls).
 */
type Entry = { pc: RTCPeerConnection; gen: string; remoteGen: string | null; offerer: boolean; analyser?: AnalyserNode; helloTimer?: number; pending: RTCIceCandidateInit[] };
const pcs = new Map<string, Entry>();
const genId = () => Math.random().toString(36).slice(2, 10);
const iAmOfferer = (pid: string) => myPid() < pid;
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

function createPc(pid: string, remoteGen: string | null = null) {
  const pc = new RTCPeerConnection({ iceServers });
  const entry: Entry = { pc, gen: genId(), remoteGen, offerer: iAmOfferer(pid), pending: [] };
  pcs.set(pid, entry);
  const sig = (data: Record<string, unknown>) => send({ t: 'rtc', to: pid, data: { gen: entry.gen, ...data } });
  pc.onicecandidate = (e) => { if (e.candidate) sig({ candidate: e.candidate.toJSON() }); };
  pc.ontrack = (e) => {
    // ONE stream per remote player that collects every track they send
    const stream = useMedia.getState().peers[pid]?.stream ?? new MediaStream();
    if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
    const refresh = () => patchPeer(pid, { stream, rev: ((useMedia.getState().peers[pid] as any)?.rev ?? 0) + 1 } as any);
    for (const ev of ['mute', 'unmute', 'ended'] as const) e.track.addEventListener(ev, refresh);
    refresh();
    if (e.track.kind === 'audio') attachAnalyser(pid, stream);
  };
  pc.onconnectionstatechange = () => {
    patchPeer(pid, { state: pc.connectionState });
    if (pc.connectionState === 'failed') { if (entry.offerer) { try { pc.restartIce(); } catch { /* recreated by syncPeers */ } } else sig({ restart: true }); }
  };
  if (entry.offerer) {
    pc.addTransceiver('audio', { direction: 'sendrecv' });
    pc.addTransceiver('video', { direction: 'sendrecv' });
    pc.onnegotiationneeded = async () => { try { await pc.setLocalDescription(); sig({ description: pc.localDescription }); } catch { /* retried on restart */ } };
    void attachLocal(entry);
  } else {
    // wait for the other side's offer; ask for it until it arrives (messages can be lost during reconnects)
    const ask = () => { if (!pc.remoteDescription && !entry.remoteGen) sig({ hello: true }); else if (!pc.remoteDescription) sig({ hello: true }); };
    ask();
    entry.helloTimer = window.setInterval(() => { if (pc.remoteDescription || !pcs.has(pid) || pcs.get(pid) !== entry) clearInterval(entry.helloTimer); else ask(); }, 2500);
  }
  patchPeer(pid, { state: 'connecting' });
}

/** Put my current microphone/camera tracks on the connection's fixed audio/video lines (no renegotiation needed). */
async function attachLocal(entry: Entry) {
  const s = useStore.getState().settings; const local = useMedia.getState().local;
  for (const t of entry.pc.getTransceivers()) {
    const kind = t.receiver.track.kind as 'audio' | 'video';
    const track = local?.getTracks().find((x) => x.kind === kind && x.readyState === 'live') ?? null;
    if (t.direction !== 'sendrecv' && t.currentDirection !== 'stopped') { try { t.direction = 'sendrecv'; } catch { /* closed */ } }
    await t.sender.replaceTrack(track).catch(() => null);
    if (kind === 'video' && track) {
      const q = VIDEO[s.videoQuality]; const p = t.sender.getParameters();
      p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: Math.round(q.br / Math.max(1, pcs.size / 2)), maxFramerate: q.fps }];
      (p as any).degradationPreference = 'maintain-framerate';
      await t.sender.setParameters(p).catch(() => null);
    }
  }
}

/** Signalling is always listened to and processed strictly in order, per peer. */
const sigQueue = new Map<string, Promise<void>>();
unsub = onRtc((from, data) => {
  const prev = sigQueue.get(from) ?? Promise.resolve();
  const next = prev.then(() => onSignal(from, data)).catch(() => undefined);
  sigQueue.set(from, next);
}) as any;

async function flushCandidates(entry: Entry) {
  while (entry.pending.length && entry.pc.remoteDescription) { const c = entry.pending.shift()!; try { await entry.pc.addIceCandidate(c); } catch { /* stale */ } }
}

async function onSignal(from: string, data: any) {
  const room = useStore.getState().room;
  if (!room || (!room.config.voice && !room.config.video) || useStore.getState().you?.role !== 'player') return;
  await ensureActive();
  const offerer = iAmOfferer(from);
  let entry = pcs.get(from);
  const fresh = (e: Entry | undefined) => !!e && e.remoteGen === data.gen;
  // the other side started a NEW connection object (page reload, reconnect): drop ours and pair with the new one
  if (entry && entry.remoteGen && entry.remoteGen !== data.gen && (data.hello || data.description?.type === 'offer')) { closePc(from); entry = undefined; }
  if (!entry) { createPc(from, data.gen); entry = pcs.get(from)!; }
  if (!entry.remoteGen) entry.remoteGen = data.gen;
  if (!fresh(entry)) return; // stale message from an older connection
  const pc = entry.pc;
  try {
    if (data.hello) {
      // answerer asked for an offer: (re)send ours if it is still waiting for an answer
      if (offerer && pc.signalingState === 'have-local-offer' && pc.localDescription) send({ t: 'rtc', to: from, data: { gen: entry.gen, description: pc.localDescription } });
    } else if (data.restart) {
      if (offerer) pc.restartIce();
    } else if (data.description) {
      const d = data.description as RTCSessionDescriptionInit;
      if (d.type === 'offer' && !offerer) {
        await pc.setRemoteDescription(d);
        await attachLocal(entry); // sets every line to sendrecv and puts my tracks on them
        await pc.setLocalDescription();
        send({ t: 'rtc', to: from, data: { gen: entry.gen, description: pc.localDescription } });
        if (entry.helloTimer) clearInterval(entry.helloTimer);
        await flushCandidates(entry);
      } else if (d.type === 'answer' && offerer && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(d);
        await flushCandidates(entry);
      }
    } else if (data.candidate) {
      if (pc.remoteDescription) { try { await pc.addIceCandidate(data.candidate); } catch { /* stale candidate */ } } else entry.pending.push(data.candidate);
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
function detectSpeakers() {
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
const live = (t: MediaStreamTrack) => t.readyState === 'live';

function constraints(mic: boolean, cam: boolean) {
  const s = useStore.getState().settings; const q = VIDEO[s.videoQuality];
  return {
    audio: mic ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: s.micId || undefined } : false,
    video: cam ? { height: { ideal: q.h }, frameRate: { max: q.fps }, deviceId: s.camId || undefined, facingMode: s.camId ? undefined : 'user' } : false,
  } as MediaStreamConstraints;
}

/**
 * Capture everything that is wanted in ONE getUserMedia call. On phones a second call (e.g. adding the microphone
 * while the camera runs) can end the tracks of the first one, so the whole set is always re-acquired together
 * and swapped in. If the combined call fails, each kind is tried on its own so one broken device never blocks the other.
 */
async function capture(mic: boolean, cam: boolean): Promise<{ stream: MediaStream | null; error: any }> {
  try { return { stream: await navigator.mediaDevices.getUserMedia(constraints(mic, cam)), error: null }; }
  catch (e: any) {
    if (!(mic && cam) || e?.name === 'NotAllowedError') return { stream: null, error: e };
    const tracks: MediaStreamTrack[] = []; let error: any = e;
    for (const [m, c] of [[true, false], [false, true]] as const) { try { tracks.push(...(await navigator.mediaDevices.getUserMedia(constraints(m, c))).getTracks()); } catch (e2) { error = e2; } }
    return { stream: tracks.length ? new MediaStream(tracks) : null, error: tracks.length ? e : error };
  }
}

/** A track ended without us stopping it (app in background, another app took the camera, device unplugged). */
let recoverTimer: number | undefined; let recoverTries = 0;
function watch(stream: MediaStream) {
  for (const tr of stream.getTracks()) tr.addEventListener('ended', () => {
    const cur = useMedia.getState().local;
    if (cur && cur.getTracks().includes(tr)) scheduleRecover(700);
  }, { once: true });
}
function scheduleRecover(delay: number) { clearTimeout(recoverTimer); recoverTimer = window.setTimeout(recover, delay); }
async function recover() {
  const m = useMedia.getState();
  const lostMic = want.mic && !m.local?.getAudioTracks().some(live);
  const lostCam = want.cam && !m.local?.getVideoTracks().some(live);
  if (!lostMic && !lostCam) { recoverTries = 0; return; }
  if (document.visibilityState === 'hidden') return; // browsers refuse capture in the background: retry when visible
  if (++recoverTries > 4) {
    useStore.getState().toast('Camera/microfonul s-a oprit. Apasă din nou pe 📷 / 🎤.', 'error');
    want.mic = false; want.cam = false; useMedia.setState({ micOn: false, camOn: false });
    return;
  }
  await apply();
  scheduleRecover(1500); // verify it stuck
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (want.mic || want.cam)) { recoverTries = 0; scheduleRecover(300); } });

async function setLocal(mic: boolean, cam: boolean) {
  const s = useStore.getState().settings;
  const old = useMedia.getState().local;
  const haveA = !!old?.getAudioTracks().some(live), haveV = !!old?.getVideoTracks().some(live);
  let stream: MediaStream | null = null;
  if ((mic && !haveA) || (cam && !haveV)) {
    const r = await capture(mic, cam);
    if (r.error) {
      useMedia.setState({ error: r.error?.name === 'NotAllowedError' ? 'permission_denied' : String(r.error?.message ?? r.error) });
      useStore.getState().toast(r.error?.name === 'NotAllowedError' ? 'Permisiune refuzată pentru microfon/cameră.' : 'Un dispozitiv media nu este disponibil.', 'error');
    }
    if (!r.stream) { const m = useMedia.getState(); want.mic = m.micOn; want.cam = m.camOn; return; }
    stream = r.stream;
  } else if (old) {
    stream = new MediaStream(old.getTracks().filter((t) => live(t) && (t.kind === 'audio' ? mic : cam)));
  }
  if (stream) {
    // keep only what is wanted
    for (const tr of stream.getTracks()) if (tr.kind === 'audio' ? !mic : !cam) { tr.stop(); stream.removeTrack(tr); }
    for (const tr of stream.getAudioTracks()) tr.enabled = !s.pushToTalk;
    if (stream.getAudioTracks().length && stream !== old) { audioCtx ??= new AudioContext(); localAnalyser = audioCtx.createAnalyser(); audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(localAnalyser); }
    watch(stream);
  }
  const micOn = !!stream?.getAudioTracks().some(live), camOn = !!stream?.getVideoTracks().some(live);
  want.mic = mic && micOn; want.cam = cam && camOn;
  useMedia.setState({ local: stream && stream.getTracks().length ? stream : null, micOn, camOn });
  send({ t: 'media', mic: micOn, cam: camOn });
  await ensureActive();
  // put the new tracks on every connection's fixed lines
  for (const e of pcs.values()) await attachLocal(e);
  // the previous capture is released only now that the new tracks are on every connection
  if (old && old !== stream) for (const tr of old.getTracks()) if (!stream?.getTracks().includes(tr)) tr.stop();
}

// after a reconnect the server forgot our flags: tell the table again
useStore.subscribe((st, prev) => {
  if (st.net.status === 'open' && prev.net.status !== 'open') { const m = useMedia.getState(); if (m.micOn || m.camOn) send({ t: 'media', mic: m.micOn, cam: m.camOn }); }
});

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

function closePc(pid: string) { const e = pcs.get(pid); if (e) { if (e.helloTimer) clearInterval(e.helloTimer); e.pc.close(); pcs.delete(pid); } const p = { ...useMedia.getState().peers }; delete p[pid]; useMedia.setState({ peers: p }); }

/** Stop all tracks and connections (leaving the room). */
export function stopMedia() {
  want.mic = false; want.cam = false;
  for (const pid of [...pcs.keys()]) closePc(pid);
  useMedia.getState().local?.getTracks().forEach((t) => t.stop());
  useMedia.setState({ local: null, micOn: false, camOn: false, peers: {}, localSpeaking: false });
  clearInterval(speakTimer); active = false; activating = null; localAnalyser = null; sigQueue.clear();
}
(window as any).__remiPcs = pcs;
