import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT, errText } from '../i18n';
import { api, roomTokens, ApiError, session } from '../api';
import { connect, disconnect, send } from '../net';
import { RulesEditor } from './RulesEditor';
import { anyCategoryEnabled, RoomConfig } from '../../engine/config';
import { ChatPanel } from '../components/Overlays';
import { SepticaOptions } from '../septica/SepticaOptions';

const GameTable = lazy(() => import('../components/Table').then((m) => ({ default: m.GameTable })));
const SepticaTable = lazy(() => import('../septica/SepticaTable').then((m) => ({ default: m.SepticaTable })));
// warm the table chunk while in the lobby
const preloadTable = () => import('../components/Table');

export function RoomScreen({ code }: { code: string }) {
  const t = useT();
  const room = useStore((s) => s.room); const game = useStore((s) => s.game); const sgame = useStore((s) => s.sgame); const you = useStore((s) => s.you);
  const navigate = useStore((s) => s.navigate); const settings = useStore((s) => s.settings); const toast = useStore((s) => s.toast);
  const [need, setNeed] = useState<null | { info: any }>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!/^[A-Z0-9]{6}$/.test(code)) { setErr('room_not_found'); return; }
    const tok = roomTokens.get(code);
    if (tok) { connect(code, tok.token); }
    else api(`/api/rooms/${code}`).then((info) => setNeed({ info })).catch((e) => setErr(e instanceof ApiError ? e.code : 'error'));
    preloadTable();
    return () => {
      // leaving the table on purpose (back button, "leave"): a robot takes the seat at once. A page reload does not run this.
      const st = useStore.getState();
      if (st.you?.role === 'player' && (st.room?.status === 'PLAYING' || st.room?.status === 'LOBBY') && send({ t: 'leaveSeat' })) roomTokens.clear(code);
      disconnect(); import('../media').then((m) => m.stopMedia()); useStore.setState({ room: null, game: null, sgame: null, you: null, selected: [], hints: [] }); };
  }, [code]);
  // app in the background -> a robot plays for me until I am back
  useEffect(() => {
    if (room?.status !== 'PLAYING' || you?.role !== 'player') return;
    let timer: number;
    const tell = (on: boolean) => send({ t: 'away', on });
    const vis = () => { clearTimeout(timer); if (document.visibilityState === 'hidden') timer = window.setTimeout(() => tell(true), 2500); else tell(false); };
    const hide = () => tell(true); const show = () => tell(false);
    document.addEventListener('visibilitychange', vis); window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
    const unsub = useStore.subscribe((s, p) => { if (s.net.status === 'open' && p.net.status !== 'open') tell(document.visibilityState === 'hidden'); });
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); unsub(); };
  }, [room?.status, you?.role]);
  // the room creator in quick-play mode starts immediately
  useEffect(() => {
    if (room?.status === 'LOBBY' && you?.isHost && sessionStorage.getItem('remi.autostart') === code) { sessionStorage.removeItem('remi.autostart'); send({ t: 'start' }); }
  }, [room?.status, you?.isHost]);
  // a stale token (room expired / kicked): fall back to the join form
  const net = useStore((s) => s.net);
  useEffect(() => {
    if (net.status === 'closed' && !room && roomTokens.get(code) && net.reconnects > 1) {
      api(`/api/rooms/${code}`).then((info) => { roomTokens.clear(code); disconnect(); setNeed({ info }); }).catch((e) => { if (e instanceof ApiError && e.status === 404) { roomTokens.clear(code); setErr('room_not_found'); } });
    }
  }, [net.status, net.reconnects]);

  if (err) return <div className="page center"><h2>{errText(err, settings.lang)}</h2><button className="btn-wood" onClick={() => navigate('/')}>← {t('back')}</button></div>;
  if (need) return <JoinGate code={code} info={need.info} onJoined={(tok) => { roomTokens.set(code, tok); setNeed(null); connect(code, tok.token); }} />;
  if (!room || !you) return <div className="page center"><div className="spinner" /> {t('loading')}</div>;
  if (room.status === 'LOBBY') return <Lobby />;
  if (room.kind === 'septica') return sgame ? <Suspense fallback={<div className="page center">{t('loading')}</div>}><SepticaTable /></Suspense> : <div className="page center">{t('loading')}</div>;
  if (!game) return <div className="page center">{t('loading')}</div>;
  void toast;
  return <Suspense fallback={<div className="page center">{t('loading')}</div>}><GameTable /></Suspense>;
}

function JoinGate({ code, info, onJoined }: { code: string; info: any; onJoined: (t: { token: string; pid: string }) => void }) {
  const t = useT();
  const s = useStore((x) => x.settings); const setS = useStore((x) => x.setSettings); const profile = useStore((x) => x.profile); const navigate = useStore((x) => x.navigate);
  const [name, setName] = useState(s.nickname || profile?.nickname || '');
  const [busy, setBusy] = useState(false);
  const join = async (spectator: boolean) => {
    if (!name.trim()) return;
    setBusy(true); setS({ nickname: name });
    try { const r = await api(`/api/rooms/${code}/join`, { body: { name, spectator } }); onJoined({ token: r.token, pid: r.pid }); }
    catch (e) { useStore.getState().toast(errText(e instanceof ApiError ? e.code : 'error', s.lang), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="page center join-gate">
      <div className="logo">Gagiu's <i>WorkArt</i></div>
      <div className="card">
        <h2>{t('lobby')} {code}</h2>
        <p>{t('host')}: <b>{info.host}</b> · {t('players')}: {info.players}/{info.kind === 'septica' ? info.maxPlayers ?? 4 : 4} · {info.kind === 'septica' ? 'Septică' : 'Remi'}</p>
        <label>{t('nickname')}<input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <div className="row-btns">
          <button className="btn-green big" disabled={busy || !name.trim()} onClick={() => join(false)}>{t('join')}</button>
          {info.spectators && <button className="btn-wood" disabled={busy || !name.trim()} onClick={() => join(true)}>👁 {t('spectate')}</button>}
        </div>
        {info.status !== 'LOBBY' && <p className="muted">{info.botSeats > 0 ? t('join_replace_bot') : info.spectators ? t('join_queue').replace('{n}', String((info.queue ?? 0) + 1)) : t('room_full_msg')}</p>}
        <button className="link" onClick={() => navigate('/')}>← {t('back')}</button>
      </div>
    </div>
  );
}

function Lobby() {
  const t = useT();
  const room = useStore((s) => s.room)!; const you = useStore((s) => s.you)!; const navigate = useStore((s) => s.navigate); const toast = useStore((s) => s.toast);
  const profile = useStore((s) => s.profile);
  const [chat, setChat] = useState(false);
  const link = `${location.origin}/join/${room.code}`;
  const cfgTimer = useRef<number>();
  const [localCfg, setLocalCfg] = useState<RoomConfig>(room.config);
  useEffect(() => { if (!you.isHost) setLocalCfg(room.config); }, [room.config, you.isHost]);
  const onCfg = (c: RoomConfig) => { setLocalCfg(c); clearTimeout(cfgTimer.current); cfgTimer.current = window.setTimeout(() => send({ t: 'config', config: c }), 300); };
  const me = room.members.find((m) => m.pid === you.pid);
  const humans = room.seats.filter((s) => s.kind === 'human').map((s: any) => room.members.find((m) => m.pid === s.pid)).filter(Boolean);
  const allReady = humans.every((m) => m!.ready || m!.isHost);
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast(t('copied')); } catch { prompt(t('copy_link'), link); } };
  const share = async () => { if (navigator.share) navigator.share({ title: `${room.kind === 'septica' ? 'Septică' : 'Remi'} — Gagiu's WorkArt`, text: `Hai la o partidă de ${room.kind === 'septica' ? 'Septică' : 'Remi'}! Cod: ${room.code}`, url: link }).catch(() => null); else copy(); };
  return (
    <div className="page lobby">
      <header className="page-head">
        <button className="btn-wood" onClick={() => navigate('/')}>← {t('leave')}</button>
        <h1>{t('lobby')} <span className="gold">{room.code}</span></h1>
        {room.config.chat && <button className="btn-wood" data-toggle="chat" onClick={() => setChat(!chat)}>💬 {t('chat')}</button>}
      </header>
      <div className="lobby-grid">
        <section className="card">
          <h3>{t('invite_code')}</h3>
          <div className="invite"><span className="code-big">{room.code}</span></div>
          <div className="row-btns"><button className="btn-gold" onClick={copy}>🔗 {t('copy_link')}</button><button className="btn-wood" onClick={share}>{t('share')}</button></div>
          {profile && <InviteFriends code={room.code} />}
          <h3>{t('players')}</h3>
          <ul className="seats">
            {room.seats.map((s, i) => {
              const m = s.kind === 'human' ? room.members.find((x) => x.pid === s.pid) : null;
              return (
                <li key={i} className={`seat ${s.kind}`}>
                  <span className="seat-no">{i + 1}</span>
                  {s.kind === 'human' && m && <><b>{m.name}</b>{m.isHost && <span className="tag gold">{t('host')}</span>}<span className={`tag ${m.ready || m.isHost ? 'ok' : ''}`}>{m.ready || m.isHost ? '✓ ' + t('ready') : '…'}</span>{!m.connected && <span className="tag warn">{t('disconnected')}</span>}
                    {you.isHost && m.pid !== you.pid && <button className="link" onClick={() => send({ t: 'kick', pid: m.pid })}>{t('kick')}</button>}
                    {m.pid === you.pid && <button className="link" onClick={() => send({ t: 'seat', seat: i, kind: 'leave' })}>{t('leave_seat')}</button>}</>}
                  {s.kind === 'bot' && <><b>🤖 {s.name}</b>
                    {you.isHost ? <select value={s.level} onChange={(e) => send({ t: 'seat', seat: i, kind: 'bot', level: e.target.value as any })}><option value="easy">{t('easy')}</option><option value="medium">{t('medium')}</option><option value="hard">{t('hard')}</option></select> : <span className="tag">{t(s.level)}</span>}
                    {you.isHost && <button className="link" onClick={() => send({ t: 'seat', seat: i, kind: 'empty' })}>{t('remove')}</button>}</>}
                  {s.kind === 'empty' && <><span className="muted">{t('seat_empty')}{room.config.bots.fillEmpty ? ' (bot)' : ''}</span>
                    {you.isHost && <button className="link" onClick={() => send({ t: 'seat', seat: i, kind: 'bot' })}>+ {t('add_bot')}</button>}
                    {me?.seat === null && <button className="link" onClick={() => send({ t: 'seat', seat: i, kind: 'take' })}>{t('take_seat')}</button>}</>}
                </li>
              );
            })}
          </ul>
          <h3>{t('spectators')} ({room.members.filter((m) => m.role === 'spectator').length})</h3>
          <p className="muted">{room.members.filter((m) => m.role === 'spectator').map((m) => m.name + (m.queued ? ` (${t('in_queue')} #${m.queuePos})` : '')).join(', ') || '—'}</p>
          {me?.role === 'spectator' && <button className="btn-wood" onClick={() => send({ t: 'queue', on: !me.queued })}>{me.queued ? t('leave_queue') : t('want_to_play')}</button>}
          <div className="lobby-actions">
            {you.role === 'player' && !you.isHost && <button className={me?.ready ? 'btn-wood' : 'btn-green big'} onClick={() => send({ t: 'ready', ready: !me?.ready })}>{me?.ready ? t('not_ready') : t('ready')}</button>}
            {you.isHost && <button className="btn-gold big" disabled={!allReady || !anyCategoryEnabled(room.config)} onClick={() => send({ t: 'start' })}>{t('start')}</button>}
            {!you.isHost && <p className="muted">{t('waiting_host')}</p>}
          </div>
        </section>
        <section className="card">
          <h3>{t('rules_review')} {!you.isHost && '🔒'}</h3>
          {room.kind === 'septica'
            ? <SepticaOptions room={room} host={you.isHost} />
            : <RulesEditor cfg={you.isHost ? localCfg : room.config} onChange={onCfg} readOnly={!you.isHost} />}
        </section>
      </div>
      {chat && <ChatPanel onClose={() => setChat(false)} />}
      <div className="rotate-overlay lobby-ok" />
      {session.get() === null && null}
    </div>
  );
}

function InviteFriends({ code }: { code: string }) {
  const t = useT();
  const [friends, setFriends] = useState<any[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  useEffect(() => { api('/api/friends').then((d) => setFriends(d.friends.filter((f: any) => f.status === 'accepted'))).catch(() => null); }, []);
  if (!friends.length) return null;
  return (
    <div className="invite-friends">
      <h4>{t('invite')}</h4>
      {friends.map((f) => (
        <div key={f.id} className="friend-row"><span>{f.avatar} {f.nickname} <small className={`presence ${f.presence}`}>{f.presence}</small></span>
          <button className="btn-wood small" disabled={sent.includes(f.id)} onClick={() => api('/api/invite', { body: { userId: f.id, code } }).then(() => setSent([...sent, f.id])).catch((e) => useStore.getState().toast(errText(e.code, useStore.getState().settings.lang), 'error'))}>{sent.includes(f.id) ? '✓' : t('invite')}</button>
        </div>
      ))}
    </div>
  );
}
