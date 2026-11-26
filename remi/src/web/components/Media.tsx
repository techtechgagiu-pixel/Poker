import { memo, useEffect, useRef } from 'react';
import { useMedia, useStore } from '../store';

/** Avatar that turns into the player's video when they enable a camera. Speaking ring from audio level. */
const FLAMES: [number, number, number, number][] = [ // left %, top %, tilt deg, delay s
  [50, -6, 0, 0], [34, -1, -12, .12], [66, -1, 12, .27], [19, 5, -22, .05], [81, 5, 22, .2], [6, 16, -30, .33], [94, 16, 30, .09],
  [-2, 36, -34, .21], [102, 36, 34, .38], [0, 56, -26, .15], [100, 56, 26, .3], [22, 80, -14, .4], [78, 80, 14, .07],
];
function Flames() {
  return (
    <div className="flames" aria-hidden>
      {FLAMES.map(([l, t, a, d], i) => <i key={i} style={{ ['--l' as any]: `${l}%`, ['--t' as any]: `${t}%`, ['--a' as any]: `${a}deg`, animationDelay: `${d}s` }} />)}
    </div>
  );
}

export const PlayerAvatar = memo(function PlayerAvatar({ pid, name, isBot, flaming }: { pid: string | null; name: string; isBot: boolean; flaming?: boolean }) {
  const myPid = useStore((s) => s.you?.pid);
  const isMe = pid !== null && pid === myPid;
  const peer = useMedia((s) => (pid && !isMe ? s.peers[pid] : undefined));
  const local = useMedia((s) => (isMe ? s.local : null));
  const speaking = useMedia((s) => (isMe ? s.localSpeaking : !!(pid && s.peers[pid]?.speaking)));
  const allHidden = useMedia((s) => s.allVideoHidden);
  const expanded = useMedia((s) => pid !== null && s.expanded === pid);
  const member = useStore((s) => (pid ? s.room?.members.find((m) => m.pid === pid) : undefined));
  const volume = useStore((s) => s.settings.voice * s.settings.master * (s.settings.mute ? 0 : 1));
  const speakerId = useStore((s) => s.settings.speakerId);
  const mirror = useStore((s) => s.settings.mirror);
  const vref = useRef<HTMLVideoElement>(null);
  const aref = useRef<HTMLAudioElement>(null);
  const stream = isMe ? local : peer?.stream ?? null;
  const hasVideo = !!stream?.getVideoTracks().some((t) => t.readyState === 'live' && (isMe || !t.muted)) && !(peer?.hiddenVideo || (!isMe && allHidden));
  useEffect(() => { const v = vref.current; if (!v) return; if (v.srcObject !== stream) v.srcObject = stream; v.play?.().catch(() => null); }, [stream, hasVideo]);
  useEffect(() => {
    const a = aref.current; if (!a || isMe) return;
    if (a.srcObject !== stream) a.srcObject = stream;
    a.volume = Math.max(0, Math.min(1, volume * (peer?.volume ?? 1)));
    a.muted = !!peer?.muted;
    if (speakerId && (a as any).setSinkId) (a as any).setSinkId(speakerId).catch(() => null);
  }, [stream, volume, peer?.muted, peer?.volume, speakerId]);
  const initials = isBot ? '🤖' : name.slice(0, 2).toUpperCase();
  return (
    <div className={`avatar-wrap ${flaming ? 'flaming' : ''}`}>
      {flaming && <Flames />}
    <div className={`avatar ${speaking ? 'speaking' : ''} ${expanded ? 'expanded' : ''} ${hasVideo ? 'has-video' : ''}`} onClick={() => hasVideo && useMedia.setState({ expanded: expanded ? null : pid })}>
      {hasVideo ? <video ref={vref} autoPlay playsInline muted={isMe} className={isMe && mirror ? 'mirror' : ''} /> : <span>{initials}</span>}
      {!isMe && <audio ref={aref} autoPlay />}
      {member && (member.mic || member.cam) && <span className={`mic-ind ${member.mic ? 'on' : ''}`}>{member.mic ? '🎙' : '📷'}</span>}
      {!isMe && peer && <button className="peer-mute" onClick={(e) => { e.stopPropagation(); const peers = useMedia.getState().peers; useMedia.setState({ peers: { ...peers, [pid!]: { ...peer, muted: !peer.muted } } }); }} title="Mute">{peer.muted ? '🔇' : '🔈'}</button>}
    </div>
    </div>
  );
});
