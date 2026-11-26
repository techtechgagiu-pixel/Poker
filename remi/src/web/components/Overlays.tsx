import { useEffect, useRef, useState } from 'react';
import { useStore, useMedia, defaultSettings } from '../store';
import { useT, TKey } from '../i18n';
import { send } from '../net';
import { Tile } from './Tile';
import { useRack, reshape } from '../rack';
import type { CategoryKey } from '../../engine/config';

const CAT_KEY = (c: CategoryKey | null) => (c ? (('cat_' + c) as TKey) : ('round_draw' as TKey));

function Countdown({ at }: { at: number | null }) {
  const off = useStore((s) => s.net.serverOffset);
  const [n, setN] = useState(0);
  useEffect(() => { const i = setInterval(() => setN(at ? Math.max(0, Math.ceil((at - Date.now() - off) / 1000)) : 0), 250); return () => clearInterval(i); }, [at, off]);
  return <b>{n}</b>;
}

export function RoundResult() {
  const t = useT();
  const v = useStore((s) => s.game)!; const room = useStore((s) => s.room)!; const you = useStore((s) => s.you)!;
  const r = v.result!;
  const ready = room.nextReady.includes(you.pid);
  return (
    <div className="modal-backdrop result-in">
      <div className="modal result">
        {r.kind === 'win' ? (
          <>
            <h2><span className="gold">{v.seats[r.winner!].name}</span> {t('round_won')}</h2>
            <div className="cat-chip">{t(CAT_KEY(r.category))}{r.jokerDiscard ? ' · ' + t('opt_closeByJoker') : ''} · <b>{t('penalty')}: {r.penalty}</b></div>
            <div className="formations">
              {r.formations.map((f, i) => (
                <div key={i} className="formation">{f.tiles.map((id) => <Tile key={id} id={id} joker={v.joker} w={38} h={52} />)}</div>
              ))}
              {r.discard !== null && <div className="formation discard-f"><small>{t('discarded')}</small><Tile id={r.discard} joker={v.joker} w={38} h={52} /></div>}
            </div>
            {r.formations.some((f) => f.jokers.length) && (
              <div className="jokers-used">{t('jokers_used')}: {r.formations.flatMap((f) => f.jokers).map((j) => `${['🔴', '🔵', '🟡', '⚫'][j.color]} ${j.num || ''}`).join(', ')}</div>
            )}
          </>
        ) : <h2>{r.drawReason === 'agreed' ? t('draw_agreed') : t('round_draw')}</h2>}
        {(r.collected > 0 || r.potWon > 0 || r.potAdded > 0) && (
          <div className="cumul-line">
            {r.collected > 0 && <span>🪙 {t('collected')}: <b className="gold">+{r.collected}</b></span>}
            {r.potWon > 0 && <span>🏺 {t('corner_won')}: <b className="gold">+{r.potWon}</b></span>}
            {r.potAdded > 0 && <span>🏺 {t('corner_added')}: <b>{r.potAdded}</b> · {t('corner')}: <b className="gold">{v.pot}</b></span>}
          </div>
        )}
        <table className="score-table">
          <thead><tr><th /><th>{t('score_before')}</th><th>{t('score_after')}</th></tr></thead>
          <tbody>{v.seats.map((s) => (
            <tr key={s.seat} className={r.eliminated.includes(s.seat) ? 'elim' : ''}><td>{s.name}{r.eliminated.includes(s.seat) ? ` · ${t('eliminated')}` : ''}</td><td>{Math.max(0, r.before[s.seat])}</td><td><b>{Math.max(0, r.after[s.seat])}</b></td></tr>
          ))}</tbody>
        </table>
        <div className="modal-actions">
          <span>{t('next_round_in')} <Countdown at={v.nextRoundAt} />s</span>
          {you.role === 'player' && <button className="btn-green" disabled={ready} onClick={() => send({ t: 'nextReady' })}>{t('ready_next')}{ready ? ' ✓' : ''}</button>}
        </div>
      </div>
    </div>
  );
}

export function MatchResult() {
  const t = useT();
  const v = useStore((s) => s.game)!; const room = useStore((s) => s.room)!; const you = useStore((s) => s.you)!; const navigate = useStore((s) => s.navigate);
  const ranking = v.seats.slice().sort((a, b) => (a.seat === v.winner ? -1 : b.seat === v.winner ? 1 : b.score - a.score));
  const mins = Math.round(((v.finishedAt ?? Date.now()) - v.startedAt) / 60000);
  return (
    <div className="modal-backdrop result-in">
      <div className="modal result match">
        <div className="trophy">🏆</div>
        <h2>{t('match_over')}</h2>
        <h3>{t('winner')}: <span className="gold">{v.winner !== null ? v.seats[v.winner].name : '-'}</span></h3>
        <table className="score-table">
          <thead><tr><th>#</th><th /><th>Pct.</th><th>{t('rounds_won')}</th><th>{t('joker_closes')}</th><th>PASS</th><th>Atu</th><th>{t('formations')}</th></tr></thead>
          <tbody>{ranking.map((s, i) => (
            <tr key={s.seat}><td>{i + 1}</td><td>{s.name}</td><td>{s.score}</td><td>{s.stats.roundsWon}</td><td>{s.stats.jokerCloses}</td><td>{s.stats.passActivations}</td><td>{s.stats.atuDeclarations}</td>
              <td className="small">{Object.entries(s.stats.categories).map(([k, n]) => `${t(('cat_' + k) as TKey)} ×${n}`).join(', ') || '—'}</td></tr>
          ))}</tbody>
        </table>
        <p className="muted">{t('rounds')}: {v.round} · {t('duration')}: {mins} min</p>
        <div className="modal-actions">
          {you.isHost && <button className="btn-gold big" onClick={() => send({ t: 'rematch' })}>{t('rematch')}</button>}
          {!you.isHost && <span className="muted">{t('waiting_host')}</span>}
          <button className="btn-wood" onClick={() => navigate('/')}>{t('leave')}</button>
        </div>
      </div>
    </div>
  );
}

export function VoteDialog() {
  const t = useT();
  const room = useStore((s) => s.room)!; const you = useStore((s) => s.you)!;
  const vote = room.vote;
  if (!vote || !vote.needed.includes(you.pid) || vote.yes.includes(you.pid)) return null;
  const by = room.members.find((m) => m.pid === vote.by)?.name;
  const what = vote.kind === 'pause' ? t('request_pause') : vote.kind === 'resume' ? t('resume') : vote.kind === 'draw' ? t('request_draw') : t('save_match');
  return (
    <div className="vote-toast" role="alertdialog">
      <b>{by}</b>: {what}?
      <button className="btn-green" onClick={() => send({ t: 'voteAnswer', yes: true })}>{t('vote_yes')}</button>
      <button className="btn-wood" onClick={() => send({ t: 'voteAnswer', yes: false })}>{t('vote_no')}</button>
    </div>
  );
}

export function PausedBanner() {
  const t = useT();
  const v = useStore((s) => s.game); const room = useStore((s) => s.room);
  if (!v?.paused || room?.status !== 'PLAYING') return null;
  return <div className="paused-banner">⏸ {t('paused')}{room.pausedUntil ? <> · <Countdown at={room.pausedUntil} />s</> : null}</div>;
}
export function SavedBanner() {
  const t = useT();
  const room = useStore((s) => s.room); const you = useStore((s) => s.you);
  if (room?.status !== 'SAVED') return null;
  return (
    <div className="modal-backdrop"><div className="modal">
      <h2>💾 {t('save_match')}</h2>
      <p>{room.code} · {room.nextReady.length}/{room.gameSeatPids.filter(Boolean).length}</p>
      {you?.role === 'player' && <button className="btn-green" onClick={() => send({ t: 'resumeSaved' })}>{t('resume_saved')}{room.nextReady.includes(you.pid) ? ' ✓' : ''}</button>}
    </div></div>
  );
}

const QUICK = ['Bravo! 👏', 'Hai, că poți!', 'Ce noroc! 🍀', 'Mulțumesc!', 'Încă o rundă?', 'Gata, sunt aici'];
const REACT = ['👍', '😂', '😮', '😡', '🔥', '❤️'];
export function ChatPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const room = useStore((s) => s.room)!;
  const [text, setText] = useState('');
  const [muted, setMuted] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('remi.muted') ?? '[]'); } catch { return []; } });
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: 1e6 }); }, [room.chat.length]);
  const toggleMute = (pid: string) => { const m = muted.includes(pid) ? muted.filter((x) => x !== pid) : [...muted, pid]; setMuted(m); try { localStorage.setItem('remi.muted', JSON.stringify(m)); } catch { /* */ } };
  return (
    <div className="chat-panel">
      <div className="cp-head">{t('chat')} <button onClick={onClose} aria-label={t('close')}>✕</button></div>
      <div className="cp-list" ref={list}>
        {room.chat.filter((c) => !muted.includes(c.pid)).map((c) => (
          <div key={c.id} className={`cp-msg ${c.kind}`}>{c.kind !== 'system' && <b onClick={() => toggleMute(c.pid)} title={t('mute_player')}>{c.name}: </b>}{c.text}</div>
        ))}
      </div>
      <div className="cp-quick">{REACT.map((e) => <button key={e} onClick={() => send({ t: 'react', emoji: e })}>{e}</button>)}</div>
      <div className="cp-quick">{QUICK.map((q) => <button key={q} onClick={() => send({ t: 'chat', text: q })}>{q}</button>)}</div>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { send({ t: 'chat', text }); setText(''); } }} className="cp-form">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder={t('chat_ph')} />
        <button className="btn-green">➤</button>
      </form>
      {muted.length > 0 && <div className="muted small">🔇 {muted.length}</div>}
    </div>
  );
}

export function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div className="drawer">
      <div className="cp-head">{t('menu_settings')} <button onClick={onClose} aria-label={t('close')}>✕</button></div>
      <SettingsForm compact />
    </div>
  );
}

export function SettingsForm({ compact }: { compact?: boolean }) {
  const t = useT();
  const s = useStore((x) => x.settings); const setS = useStore((x) => x.setSettings);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => { navigator.mediaDevices?.enumerateDevices?.().then(setDevices).catch(() => null); }, []);
  const sel = <K extends keyof typeof s>(k: K, opts: [string, string][]) => (
    <select value={String(s[k])} onChange={(e) => { const raw = e.target.value; const val: any = typeof s[k] === 'number' ? Number(raw) : raw; setS({ [k]: val } as any); if (k === 'rackRows') useRack.setState({ layout: reshape(useRack.getState().layout, val) });
      if (k === 'tableZoom') useRack.setState({ layout: reshape(useRack.getState().layout, useStore.getState().settings.rackRows) }); }}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const chk = (k: keyof typeof s, label: TKey) => <label className="chk"><input type="checkbox" checked={!!s[k]} onChange={(e) => setS({ [k]: e.target.checked } as any)} /> {t(label)}</label>;
  const rng = (k: keyof typeof s, label: TKey, max = 1, step = 0.05) => <label className="rng">{t(label)} <input type="range" min={0} max={max} step={step} value={s[k] as number} onChange={(e) => setS({ [k]: Number(e.target.value) } as any)} /></label>;
  return (
    <div className={`settings-form ${compact ? 'compact' : ''}`}>
      <fieldset><legend>{t('settings_general')}</legend>
        <label>{t('language')} {sel('lang', [['ro', 'Română'], ['en', 'English']])}</label>
        {chk('skipAnim', 'skip_anim')}
        {chk('confirmJoker', 'confirm_joker')}
      </fieldset>
      <fieldset><legend>{t('settings_graphics')}</legend>
        <label>{t('theme')} {sel('theme', [['arena', 'Arena'], ['walnut', t('theme_walnut')], ['mahogany', t('theme_mahogany')], ['black', t('theme_black')], ['oak', t('theme_oak')], ['midnight', t('theme_midnight')]])}</label>
        <label>{t('quality')} {sel('quality', [['auto', t('q_auto')], ['performance', t('q_performance')], ['balanced', t('q_balanced')], ['ultra', t('q_ultra')]])}</label>
        <label>{t('fps_pref')} {sel('fps', [['auto', t('fps_auto')], ['60', t('fps_60')], ['120', t('fps_120')]])}</label>
        {chk('reducedMotion', 'reduced_motion')}{chk('highContrast', 'high_contrast')}
      </fieldset>
      <fieldset><legend>{t('settings_rack')}</legend>
        <label>{t('table_zoom')} {sel('tableZoom', [['1', t('zoom_1')], ['2', t('zoom_2')], ['3', t('zoom_3')]])}</label>
        <label>{t('rows')} {sel('rackRows', [['2', '2'], ['3', '3']])}</label>
        <label>{t('tile_size')} {sel('tileSize', [['s', 'S'], ['m', 'M'], ['l', 'L']])}</label>
        <label className="rng">{t('tile_spacing')} <input type="range" min={0} max={10} step={1} value={s.tileSpacing} onChange={(e) => setS({ tileSpacing: Number(e.target.value) })} /></label>
      </fieldset>
      <fieldset><legend>{t('settings_audio')}</legend>
        {rng('master', 'master')}{rng('sfx', 'sfx')}{rng('music', 'music')}{rng('voice', 'voice_vol')}{rng('notif', 'notif_vol')}
        <label>{t('background_sound')}
          <select value={s.musicTrack !== 'none' ? 'm:' + s.musicTrack : s.ambient} onChange={(e) => { const v = e.target.value; setS(v.startsWith('m:') ? { musicTrack: v.slice(2) as any, ambient: 'none' } : { ambient: v as any, musicTrack: 'none' }); }}>
            <option value="none">{t('sound_none')}</option>
            <optgroup label={t('ambient')}>
              <option value="fire">🔥 Șemineu</option><option value="waves">🌊 Valuri</option><option value="rain">🌧 Ploaie</option><option value="lounge">🎶 Lounge</option><option value="room">🪑 Cameră</option>
            </optgroup>
            <optgroup label={t('music_track')}>
              <option value="m:piano">🎹 {t('track_piano')}</option><option value="m:jazz">🎷 {t('track_jazz')}</option><option value="m:calm">🌙 {t('track_calm')}</option>
            </optgroup>
          </select>
        </label>
        {chk('mute', 'mute_all')}
      </fieldset>
      <fieldset><legend>{t('settings_media')}</legend>
        <label>{t('mic')} <select value={s.micId} onChange={(e) => setS({ micId: e.target.value })}><option value="">Implicit</option>{devices.filter((d) => d.kind === 'audioinput').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}</select></label>
        <label>{t('cam')} <select value={s.camId} onChange={(e) => setS({ camId: e.target.value })}><option value="">Implicit</option>{devices.filter((d) => d.kind === 'videoinput').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}</select></label>
        {'setSinkId' in HTMLMediaElement.prototype && <label>{t('speakers')} <select value={s.speakerId} onChange={(e) => setS({ speakerId: e.target.value })}><option value="">Implicit</option>{devices.filter((d) => d.kind === 'audiooutput').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}</select></label>}
        <label>{t('video_quality')} {sel('videoQuality', [['low', '180p'], ['balanced', '360p'], ['high', '720p']])}</label>
        {chk('pushToTalk', 'push_to_talk')}{chk('mirror', 'mirror')}
        <MicTest />
      </fieldset>
      <fieldset><legend>{t('settings_diagnostics')}</legend>
        {chk('diagnostics', 'diag_overlay')}
        <div className="muted small">{t('version')}: {__APP_VERSION__}</div>
        <button className="btn-wood" onClick={() => { useStore.getState().setSettings({ ...defaultSettings, lang: s.lang }); }}>{t('reset_defaults')}</button>
      </fieldset>
    </div>
  );
}

function MicTest() {
  const t = useT();
  const [level, setLevel] = useState<number | null>(null);
  const stop = useRef<() => void>();
  useEffect(() => () => stop.current?.(), []);
  const run = async () => {
    if (stop.current) { stop.current(); stop.current = undefined; setLevel(null); return; }
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: useStore.getState().settings.micId || undefined } });
      const ctx = new AudioContext(); const an = ctx.createAnalyser(); ctx.createMediaStreamSource(st).connect(an);
      const buf = new Uint8Array(an.fftSize); let raf = 0;
      const loop = () => { an.getByteTimeDomainData(buf); let m = 0; for (const b of buf) m = Math.max(m, Math.abs(b - 128)); setLevel(m / 128); raf = requestAnimationFrame(loop); };
      loop();
      stop.current = () => { cancelAnimationFrame(raf); st.getTracks().forEach((x) => x.stop()); ctx.close(); };
    } catch { useStore.getState().toast('Microfon indisponibil / permisiune refuzată', 'error'); }
  };
  return <div className="mic-test"><button className="btn-wood" onClick={run}>{t('test_mic')}</button>{level !== null && <div className="meter"><div style={{ width: `${Math.min(100, level * 160)}%` }} /></div>}</div>;
}

export function HintsPanel() {
  const t = useT();
  const hints = useStore((s) => s.hints);
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState(true);
  return (
    <div className={`hints-panel ${open ? '' : 'closed'}`}>
      <div className="cp-head" onClick={() => setOpen(!open)}>💡 {t('assistant')}</div>
      {open && <>
        <button className="btn-gold" onClick={() => send({ t: 'hint' })}>{t('get_hints')}</button>
        <ul>{hints.map((h, i) => <li key={i} onMouseEnter={() => set({ selected: h.tiles.slice(0, 1) })}>{h.text}</li>)}</ul>
      </>}
    </div>
  );
}

/** Measures real frame timing with requestAnimationFrame. Nothing here is hard-coded. */
export function Diagnostics() {
  const net = useStore((s) => s.net);
  const media = useMedia((s) => ({ peers: Object.values(s.peers).length, mic: s.micOn, cam: s.camOn }));
  const quality = useStore((s) => s.settings.quality);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0; let last = performance.now(); const frames: number[] = []; let dropped = 0; let lastPaint = 0;
    const loop = (now: number) => {
      const dt = now - last; last = now; frames.push(dt); if (frames.length > 240) frames.shift();
      const median = [...frames].sort((a, b) => a - b)[Math.floor(frames.length / 2)] || 16.7;
      if (dt > median * 1.5) dropped++;
      if (now - lastPaint > 500 && ref.current) {
        lastPaint = now;
        const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
        const p95 = [...frames].sort((a, b) => a - b)[Math.floor(frames.length * 0.95)] ?? 0;
        const mem = (performance as any).memory?.usedJSHeapSize;
        ref.current.textContent = `FPS ${(1000 / avg).toFixed(0)} · frame ${avg.toFixed(2)}ms · p95 ${p95.toFixed(2)}ms · dropped ${dropped}` +
          ` | WS ${net.status} · RTT ${net.latency ?? '-'}ms · ack ${net.lastAck ?? '-'}ms · reconnects ${net.reconnects}` +
          (mem ? ` | heap ${(mem / 1048576).toFixed(1)}MB` : '') + ` | quality ${quality} | voice ${media.mic ? 'on' : 'off'} · video ${media.cam ? 'on' : 'off'} · peers ${media.peers} | v${__APP_VERSION__}`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [net, quality, media.peers, media.mic, media.cam]);
  return <div className="diagnostics" ref={ref} />;
}

declare global { const __APP_VERSION__: string; }
