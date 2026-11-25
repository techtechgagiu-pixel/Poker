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

async function ensureActive() {
  if (active) return;
  active = true;
  const room = useStore.getState().room!;
  try {
    const tok = roomTokens.get(room.code);
    const r = await fetch(`/api/rooms/${room.code}/ice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tok?.token }) });
    if (r.ok) iceServers = ((await r.json()) as any).iceServers;
  } catch { /* STUN fallback */ }
  unsub = onRtc(onSignal) as any;
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

async function onSignal(from: string, data: any) {
  if (!active) await ensureActive();
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
function detectSpeakers() {
  const peers = useMedia.getState().peers;
  let changed = false; const next = { ...peers };
  for (const [pid, e] of pcs) {
    if (!e.analyser || !next[pid]) continue;
    const sp = level(e.analyser) > 0.06;
    if (sp !== next[pid].speaking) { next[pid] = { ...next[pid], speaking: sp }; changed = true; }
  }
  if (changed) useMedia.setState({ peers: next });
  if (localAnalyser) { const sp = useMedia.getState().micOn && level(localAnalyser) > 0.06; if (sp !== useMedia.getState().localSpeaking) useMedia.setState({ localSpeaking: sp }); }
}

const VIDEO: Record<string, { h: number; fps: number; br: number }> = { low: { h: 180, fps: 15, br: 150_000 }, balanced: { h: 360, fps: 24, br: 450_000 }, high: { h: 720, fps: 30, br: 1_200_000 } };

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

export async function toggleMic() { const m = useMedia.getState(); await setLocal(!m.micOn, m.camOn); }
export async function toggleCam() { const m = useMedia.getState(); await setLocal(m.micOn, !m.camOn); }
export function muteAll(muted: boolean) { const peers = useMedia.getState().peers; const n: typeof peers = {}; for (const [k, p] of Object.entries(peers)) n[k] = { ...p, muted }; useMedia.setState({ peers: n }); }

// push-to-talk: hold Space
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && useStore.getState().settings.pushToTalk && !(e.target as HTMLElement)?.closest('input,textarea')) useMedia.getState().local?.getAudioTracks().forEach((t) => (t.enabled = true)); });
window.addEventListener('keyup', (e) => { if (e.code === 'Space' && useStore.getState().settings.pushToTalk) useMedia.getState().local?.getAudioTracks().forEach((t) => (t.enabled = false)); });

function closePc(pid: string) { const e = pcs.get(pid); if (e) { e.pc.close(); pcs.delete(pid); } const p = { ...useMedia.getState().peers }; delete p[pid]; useMedia.setState({ peers: p }); }

/** Stop all tracks and connections (leaving the room). */
export function stopMedia() {
  for (const pid of [...pcs.keys()]) closePc(pid);
  useMedia.getState().local?.getTracks().forEach((t) => t.stop());
  useMedia.setState({ local: null, micOn: false, camOn: false, peers: {}, localSpeaking: false });
  clearInterval(speakTimer); unsub?.(); unsub = null; active = false; localAnalyser = null;
}
