import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useT, errText, TKey } from '../i18n';
import { api, session, roomTokens, ApiError } from '../api';
import { RulesEditor } from './RulesEditor';
import { defaultConfig, RoomConfig } from '../../engine/config';

type Page = 'profile' | 'friends' | 'leaderboard' | 'saved' | 'trophies' | 'stats' | 'tournaments' | 'notifications';
const ACH_NAMES: Record<string, string> = {
  primul_joc: 'Primul joc', prima_victorie: 'Prima victorie', prima_inchidere: 'Prima închidere', maestrul_suitelor: 'Maestrul suitelor', regele_tertelor: 'Regele terțelor',
  regele_dublelor: 'Regele dublelor', maestrul_culorilor: 'Maestrul culorilor', grand_master: 'Grand Master', joker_master: 'Joker Master', asul_atuului: 'Asul atuului',
  strategul_pass: 'Strategul PASS', hat_trick: 'Hat Trick', invincibil: 'Invincibil', veteran: 'Veteran', legenda_remi: 'Legenda Remi', campionul_mesei: 'Campionul mesei',
  gazda_perfecta: 'Gazda perfectă', masa_completa: 'Masa completă', prietenii_la_joc: 'Prietenii la joc', antrenament: 'Antrenament',
};
const TIER_ICON: Record<string, string> = { bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '💠', diamond: '💎' };

export function Social({ page, sub }: { page: Page; sub?: string }) {
  const t = useT(); const navigate = useStore((s) => s.navigate); const profile = useStore((s) => s.profile);
  const needsLogin = ['friends', 'leaderboard', 'tournaments', 'notifications'].includes(page) && !profile;
  const title: Record<Page, TKey> = { profile: 'menu_profile', friends: 'menu_friends', leaderboard: 'menu_leaderboard', saved: 'menu_saved', trophies: 'menu_trophies', stats: 'menu_stats', tournaments: 'menu_tournaments', notifications: 'notifications' };
  return (
    <div className="page">
      <header className="page-head"><button className="btn-wood" onClick={() => navigate(sub && page === 'tournaments' ? '/tournaments' : '/')}>← {t('back')}</button><h1>{t(title[page])}</h1></header>
      {needsLogin ? <div className="card"><p>{t('login_needed')}</p><button className="btn-gold" onClick={() => navigate('/profile')}>{t('register')}</button></div> : (
        <>
          {page === 'profile' && <Profile />}
          {page === 'friends' && <Friends />}
          {page === 'leaderboard' && <Leaderboard />}
          {page === 'saved' && <Saved />}
          {(page === 'trophies' || page === 'stats') && <Stats trophies={page === 'trophies'} />}
          {page === 'tournaments' && (sub ? <TournamentDetail id={sub} /> : <Tournaments />)}
          {page === 'notifications' && <Notifications />}
        </>
      )}
    </div>
  );
}

function useErr() { const lang = useStore((s) => s.settings.lang); const toast = useStore((s) => s.toast); return (e: unknown) => toast(errText(e instanceof ApiError ? e.code : 'error', lang), 'error'); }

function Profile() {
  const t = useT(); const profile = useStore((s) => s.profile); const err = useErr(); const navigate = useStore((s) => s.navigate);
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState(''); const [nickname, setNickname] = useState(useStore.getState().settings.nickname); const [key, setKey] = useState('');
  const [recovery, setRecovery] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const reload = () => api('/api/me').then((p) => { setMe(p); useStore.setState({ profile: p }); }).catch(() => null);
  useEffect(() => { if (profile) reload(); }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = mode === 'register' ? await api('/api/auth/register', { body: { username, nickname } }) : await api('/api/auth/login', { body: { username, recoveryKey: key } });
      session.set(r.token); if (r.recoveryKey) setRecovery(r.recoveryKey);
      await reload();
    } catch (x) { err(x); }
  };
  if (recovery) return <div className="card"><h3>🔑 {t('recovery_key')}</h3><code className="recovery">{recovery}</code><p className="warn">{t('recovery_warn')}</p><button className="btn-gold" onClick={() => { navigator.clipboard?.writeText(recovery).catch(() => null); setRecovery(null); }}>{t('copied')} ✓</button></div>;
  if (!profile || !me) return (
    <div className="card narrow">
      <div className="tabs"><button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>{t('register')}</button><button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>{t('login')}</button></div>
      <form onSubmit={submit} className="form">
        <label>{t('username')}<input value={username} onChange={(e) => setUsername(e.target.value)} pattern="[a-zA-Z0-9_.]{3,20}" required autoComplete="username" /></label>
        {mode === 'register' ? <label>{t('nickname')}<input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20} /></label>
          : <label>{t('recovery_key')}<input value={key} onChange={(e) => setKey(e.target.value)} required autoComplete="current-password" type="password" /></label>}
        <button className="btn-gold">{mode === 'register' ? t('register') : t('login')}</button>
      </form>
      <p className="muted small">Fără parolă și fără e-mail: profilul se protejează cu o cheie de recuperare generată aleator. Statisticile de invitat de pe acest dispozitiv se transferă automat în profil.</p>
    </div>
  );
  const save = (patch: any) => api('/api/me', { method: 'PUT', body: patch }).then(reload).catch(err);
  const notify = me.prefs.notify ?? {};
  return (
    <div className="lobby-grid">
      <section className="card">
        <h3>{me.avatar} {me.nickname} <small className="muted">@{me.username}</small></h3>
        <div className="avatars">{me.avatars.map((a: string) => <button key={a} className={a === me.avatar ? 'on' : ''} onClick={() => save({ avatar: a })}>{a}</button>)}</div>
        <label>{t('nickname')}<input defaultValue={me.nickname} maxLength={20} onBlur={(e) => e.target.value !== me.nickname && save({ nickname: e.target.value })} /></label>
        <h4>{t('settings_privacy')}</h4>
        {(['showOnline', 'friendRequests', 'invites', 'profile'] as const).map((k) => (
          <label key={k}>{({ showOnline: 'Status online', friendRequests: 'Cereri de prietenie', invites: 'Invitații', profile: 'Profil vizibil' } as any)[k]}
            <select value={me.privacy[k]} onChange={(e) => save({ privacy: { ...me.privacy, [k]: e.target.value } })}>
              {(k === 'friendRequests' ? ['everyone', 'nobody'] : k === 'invites' ? ['friends', 'nobody'] : ['everyone', 'friends', 'nobody']).map((o) => <option key={o} value={o}>{({ everyone: 'Toată lumea', friends: 'Doar prietenii', nobody: 'Nimeni' } as any)[o]}</option>)}
            </select></label>
        ))}
        <h4>{t('settings_notifications')}</h4>
        {(['friendRoom', 'invite', 'friendRequest', 'friendOnline', 'savedReady', 'tournament'] as const).map((k) => (
          <label key={k} className="chk"><input type="checkbox" checked={notify[k] ?? ['invite', 'friendRequest', 'savedReady', 'tournament'].includes(k)} onChange={(e) => save({ prefs: { ...me.prefs, notify: { ...notify, [k]: e.target.checked } } })} />
            {({ friendRoom: 'Un prieten creează o masă', invite: 'Invitații directe', friendRequest: 'Cereri de prietenie', friendOnline: 'Prieten online', savedReady: 'Partidă salvată gata de reluare', tournament: 'Turnee' } as any)[k]}</label>
        ))}
        {'Notification' in window && Notification.permission !== 'granted' && <button className="btn-wood" onClick={() => Notification.requestPermission()}>🔔 Permite notificări în browser</button>}
      </section>
      <section className="card">
        <button className="btn-wood" onClick={() => navigate('/notifications')}>🔔 {t('notifications')}</button>
        <button className="btn-wood" onClick={() => navigate('/trophies')}>🏆 {t('trophies')}</button>
        <button className="btn-wood" onClick={async () => { const d = await api('/api/me/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'remi-export.json'; a.click(); }}>⬇ {t('export_data')}</button>
        <button className="btn-wood" onClick={async () => { if (!confirm('Generezi o cheie nouă? Celelalte sesiuni vor fi deconectate.')) return; const r = await api('/api/auth/rotate', { body: {} }); session.set(r.token); setRecovery(r.recoveryKey); }}>🔑 Cheie de recuperare nouă</button>
        <button className="btn-wood" onClick={async () => { await api('/api/auth/logout', { body: {} }).catch(() => null); session.set(null); useStore.setState({ profile: null }); }}>{t('logout')}</button>
        <button className="btn-danger" onClick={async () => { if (!confirm(t('delete_account') + '?')) return; await api('/api/me', { method: 'DELETE' }); session.set(null); useStore.setState({ profile: null }); navigate('/'); }}>{t('delete_account')}</button>
      </section>
    </div>
  );
}

function Notifications() {
  const t = useT(); const navigate = useStore((s) => s.navigate);
  const [list, setList] = useState<any[]>([]);
  useEffect(() => { api('/api/notifications').then((d) => { setList(d.notifications); api('/api/notifications/read', { body: {} }).catch(() => null); }).catch(() => null); }, []);
  return <div className="card">{list.length ? list.map((n) => (
    <div key={n.id} className={`notif-card ${n.read_at ? 'read' : ''}`}>{n.payload.text} <small className="muted">{new Date(n.created_at).toLocaleString()}</small>
      {n.payload.code && <button className="btn-green" onClick={() => navigate('/join/' + n.payload.code)}>{t('join')}</button>}
      {n.payload.tournamentId && <button className="btn-wood" onClick={() => navigate('/tournaments/' + n.payload.tournamentId)}>→</button>}</div>
  )) : <p className="muted">{t('no_notifications')}</p>}</div>;
}

function Friends() {
  const t = useT(); const err = useErr();
  const [data, setData] = useState<{ friends: any[]; blocked: any[] }>({ friends: [], blocked: [] });
  const [q, setQ] = useState(''); const [found, setFound] = useState<any[]>([]);
  const load = () => api('/api/friends').then(setData).catch(err);
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, []);
  useEffect(() => { if (q.length < 2) { setFound([]); return; } const h = setTimeout(() => api('/api/users/search?q=' + encodeURIComponent(q)).then((d) => setFound(d.users)).catch(() => null), 300); return () => clearTimeout(h); }, [q]);
  const act = (path: string, body: any) => api(path, { body }).then(load).catch(err);
  const pres: Record<string, TKey> = { online: 'online', offline: 'offline', available: 'available', lobby: 'in_lobby', playing: 'playing', dnd: 'dnd' };
  return (
    <div className="lobby-grid">
      <section className="card">
        <h3>{t('friends')}</h3>
        {data.friends.filter((f) => f.status === 'accepted').map((f) => (
          <div key={f.id} className="friend-row"><span>{f.avatar} <b>{f.nickname}</b> <small>@{f.username}</small> <span className={`presence ${f.presence}`}>● {t(pres[f.presence] ?? 'offline')}</span></span>
            <span><button className="link" onClick={() => act('/api/friends/remove', { userId: f.id })}>{t('remove')}</button> <button className="link" onClick={() => act('/api/friends/block', { userId: f.id })}>{t('block')}</button></span></div>
        ))}
        <h3>{t('requests')}</h3>
        {data.friends.filter((f) => f.status === 'pending').map((f) => (
          <div key={f.id} className="friend-row"><span>{f.avatar} {f.nickname} <small>{f.direction === 'incoming' ? '←' : '→'}</small></span>
            {f.direction === 'incoming' ? <span><button className="btn-green small" onClick={() => act('/api/friends/respond', { userId: f.id, accept: true })}>{t('accept')}</button> <button className="btn-wood small" onClick={() => act('/api/friends/respond', { userId: f.id, accept: false })}>{t('reject')}</button></span> : <small className="muted">…</small>}</div>
        ))}
        {data.blocked.length > 0 && <><h4>{t('block')}</h4>{data.blocked.map((b: any) => <div key={b.id} className="friend-row"><span>{b.username}</span><button className="link" onClick={() => act('/api/friends/block', { userId: b.id, unblock: true })}>{t('unblock')}</button></div>)}</>}
      </section>
      <section className="card">
        <h3>{t('add_friend')}</h3>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_users')} />
        {found.map((u) => <div key={u.id} className="friend-row"><span>{u.avatar} {u.nickname} <small>@{u.username}</small></span><button className="btn-gold small" onClick={() => act('/api/friends/request', { username: u.username })}>+</button></div>)}
      </section>
    </div>
  );
}

function Leaderboard() {
  const t = useT(); const err = useErr();
  const [period, setPeriod] = useState('all'); const [mode, setMode] = useState('human'); const [min, setMin] = useState(3);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    const qs = new URLSearchParams({ period, mode, min: String(min) });
    if (period === 'custom') { if (from) qs.set('from', String(new Date(from).getTime())); if (to) qs.set('to', String(new Date(to).getTime() + 864e5)); }
    api('/api/leaderboard?' + qs).then(setData).catch(err);
  }, [period, mode, min, from, to]);
  return (
    <div className="card">
      <div className="filters">
        <select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="all">{t('period_all')}</option><option value="month">{t('period_month')}</option><option value="week">{t('period_week')}</option><option value="custom">{t('period_custom')}</option></select>
        {period === 'custom' && <><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></>}
        <select value={mode} onChange={(e) => setMode(e.target.value)}><option value="human">{t('mode_human')}</option><option value="bots">{t('mode_bots')}</option><option value="tournament">{t('mode_tournament')}</option></select>
        <label>min. <input type="number" className="num-in" value={min} min={1} max={100} onChange={(e) => setMin(Number(e.target.value) || 1)} /></label>
      </div>
      <div className="table-scroll"><table className="score-table lb">
        <thead><tr><th>#</th><th /><th>{t('matches')}</th><th>{t('wins')}</th><th>{t('losses')}</th><th>{t('win_rate')}</th><th>{t('rounds_won')}</th><th>{t('joker_closes')}</th><th>{t('cat_doubles')}</th><th>{t('cat_color')}</th><th>{t('cat_grand')}</th><th>{t('cat_sequences')}</th><th>{t('cat_triples')}</th><th>Atu</th><th>PASS</th><th>{t('streak')}</th><th>{t('best_streak')}</th></tr></thead>
        <tbody>{data?.board.map((r: any, i: number) => (
          <tr key={r.id} className={r.ranked ? '' : 'unranked'}><td>{r.ranked ? i + 1 : '–'}</td><td>{r.avatar} {r.nickname}</td><td>{r.matches}</td><td>{r.wins}</td><td>{r.losses}</td><td>{(r.winRate * 100).toFixed(0)}%</td><td>{r.roundsWon}</td><td>{r.jokerCloses}</td>
            <td>{r.categories.doubles ?? 0}</td><td>{r.categories.color ?? 0}</td><td>{r.categories.grand ?? 0}</td><td>{r.categories.sequences ?? 0}</td><td>{r.categories.triples ?? 0}</td><td>{r.atuDeclarations}</td><td>{r.passActivations}</td><td>{r.currentStreak}</td><td>{r.longestStreak}</td></tr>
        ))}</tbody>
      </table></div>
      <p className="muted small">Clasamentul pe rata de victorie include doar jucătorii cu minimum {data?.minMatches} partide. Statisticile competitive (multiplayer) sunt separate de cele cu boți și de antrenament.</p>
    </div>
  );
}

function Saved() {
  const t = useT(); const navigate = useStore((s) => s.navigate);
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => { api('/api/saved').then((d) => setList(d.saved)).catch(() => setList([])); }, []);
  return <div className="card">{list === null ? t('loading') : list.length ? list.map((s) => (
    <div key={s.code} className="friend-row"><span><b>{s.code}</b> · {t('round')} {s.round} · {s.players.join(', ')} · <small>{new Date(s.savedAt).toLocaleString()}</small></span>
      <button className="btn-green small" onClick={() => navigate((roomTokens.get(s.code) ? '/room/' : '/join/') + s.code)}>{t('resume_saved')}</button></div>
  )) : <p className="muted">{t('saved_none')}</p>}</div>;
}

function Stats({ trophies }: { trophies: boolean }) {
  const t = useT();
  const [d, setD] = useState<any>(null);
  useEffect(() => { api('/api/stats').then(setD).catch(() => setD({ stats: [], achievements: [], definitions: [] })); }, []);
  if (!d) return <div className="card">{t('loading')}</div>;
  if (trophies) {
    const earned = new Set(d.achievements.map((a: any) => `${a.key}/${a.tier}`));
    const byKey = new Map<string, any[]>(); for (const a of d.definitions) byKey.set(a.key, [...(byKey.get(a.key) ?? []), a]);
    return (
      <div className="card trophy-cabinet">
        <h3>{t('trophies')}</h3>
        <div className="shelf">{[...byKey].map(([k, tiers]) => (
          <div key={k} className="trophy-item">
            <div className="trophy-name">{ACH_NAMES[k] ?? k}</div>
            <div className="tiers">{tiers.map((a: any) => <span key={a.tier} className={earned.has(`${k}/${a.tier}`) ? 'won' : 'locked'} title={`${a.stat} ≥ ${a.threshold} (${a.mode})`}>{TIER_ICON[a.tier]}<small>{a.threshold}</small></span>)}</div>
          </div>
        ))}</div>
        <p className="muted small">Trofeele virtuale nu au valoare monetară. Se acordă doar din evenimente de joc validate de server; antrenamentul are trofee separate.</p>
      </div>
    );
  }
  const modes = ['human', 'bots', 'training'];
  return (
    <div className="card">
      <div className="table-scroll"><table className="score-table">
        <thead><tr><th /><th>{t('matches')}</th><th>{t('wins')}</th><th>{t('losses')}</th><th>{t('win_rate')}</th><th>{t('rounds_won')}</th><th>{t('cat_normalJoker')}</th><th>{t('cat_normalPlain')}</th><th>{t('cat_sequences')}</th><th>{t('cat_triples')}</th><th>{t('cat_doubles')}</th><th>{t('cat_color')}</th><th>{t('cat_grand')}</th><th>{t('joker_closes')}</th><th>PASS</th><th>Atu</th><th>{t('best_streak')}</th></tr></thead>
        <tbody>{modes.map((m) => { const r = d.stats.find((x: any) => x.mode === m); if (!r) return null; return (
          <tr key={m}><td>{t(('mode_' + m) as TKey)}</td><td>{r.matches}</td><td>{r.wins}</td><td>{r.losses}</td><td>{r.matches ? Math.round((r.wins / r.matches) * 100) : 0}%</td><td>{r.rounds_won}</td><td>{r.normal_joker}</td><td>{r.normal_plain}</td><td>{r.sequences}</td><td>{r.triples}</td><td>{r.doubles}</td><td>{r.color}</td><td>{r.grand}</td><td>{r.joker_closes}</td><td>{r.pass_activations}</td><td>{r.atu_declarations}</td><td>{r.best_streak}</td></tr>); })}</tbody>
      </table></div>
      {!d.stats.length && <p className="muted">Încă nu ai partide terminate.</p>}
      <h3>Ultimele partide</h3>
      {d.recent?.map((m: any) => <div key={m.id} className="friend-row"><span>{new Date(m.finished_at).toLocaleString()} · {t(('mode_' + m.mode) as TKey)} · {t('rounds')} {m.rounds}</span><span>#{m.rank} · {m.final_score} pct · 🏆 {m.winner_name}</span></div>)}
    </div>
  );
}

function Tournaments() {
  const t = useT(); const err = useErr(); const navigate = useStore((s) => s.navigate);
  const [list, setList] = useState<any[]>([]); const [code, setCode] = useState('');
  const [form, setForm] = useState({ name: 'Turneul prietenilor', format: 'roundrobin', maxPlayers: 4, rounds: 3, points: [3, 2, 1, 0], tieBreak: 'wins', advance: 2 });
  const [cfg, setCfg] = useState<RoomConfig>(defaultConfig());
  const [creating, setCreating] = useState(false);
  useEffect(() => { api('/api/tournaments').then((d) => setList(d.tournaments)).catch(err); }, []);
  return (
    <div className="lobby-grid">
      <section className="card">
        <h3>{t('tournaments')}</h3>
        {list.map((x) => <div key={x.id} className="friend-row"><span><b>{x.name}</b> · {t(x.format)} · {x.status} · <code>{x.code}</code></span><button className="btn-wood small" onClick={() => navigate('/tournaments/' + x.id)}>→</button></div>)}
        <form onSubmit={(e) => { e.preventDefault(); api('/api/tournaments/join', { body: { code } }).then((r) => navigate('/tournaments/' + r.id)).catch(err); }} className="join-form">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder={t('join_code_ph')} /><button className="btn-green">{t('join_tournament')}</button>
        </form>
      </section>
      <section className="card">
        <h3>{t('create_tournament')}</h3>
        <label>Nume<input value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>{t('format')}<select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>{['league', 'roundrobin', 'elimination', 'groups'].map((f) => <option key={f} value={f}>{t(f as TKey)}</option>)}</select></label>
        <label>{t('players')} (max)<input type="number" className="num-in" min={2} max={16} value={form.maxPlayers} onChange={(e) => setForm({ ...form, maxPlayers: Number(e.target.value) })} /></label>
        {form.format === 'league' && <label>{t('rounds')}<input type="number" className="num-in" min={1} max={20} value={form.rounds} onChange={(e) => setForm({ ...form, rounds: Number(e.target.value) })} /></label>}
        {(form.format === 'elimination' || form.format === 'groups') && <label>Calificați / masă<input type="number" className="num-in" min={1} max={3} value={form.advance} onChange={(e) => setForm({ ...form, advance: Number(e.target.value) })} /></label>}
        <label>Puncte turneu (loc 1–4)<span>{form.points.map((p, i) => <input key={i} type="number" className="num-in" min={0} max={100} value={p} onChange={(e) => { const pts = form.points.slice(); pts[i] = Number(e.target.value); setForm({ ...form, points: pts }); }} />)}</span></label>
        <label>Departajare<select value={form.tieBreak} onChange={(e) => setForm({ ...form, tieBreak: e.target.value })}><option value="wins">Victorii</option><option value="rounds">Runde câștigate</option><option value="headtohead">Meci direct</option></select></label>
        <details><summary>{t('rules_section')}</summary><RulesEditor cfg={cfg} onChange={setCfg} /></details>
        <button className="btn-gold" disabled={creating} onClick={() => { setCreating(true); api('/api/tournaments', { body: { ...form, config: cfg } }).then((r) => navigate('/tournaments/' + r.id)).catch(err).finally(() => setCreating(false)); }}>{t('create_tournament')}</button>
        <p className="muted small">Fără bani reali, pariuri sau premii — doar trofee virtuale.</p>
      </section>
    </div>
  );
}

function TournamentDetail({ id }: { id: string }) {
  const t = useT(); const err = useErr(); const navigate = useStore((s) => s.navigate); const profile = useStore((s) => s.profile);
  const [d, setD] = useState<any>(null);
  const load = () => api('/api/tournaments/' + id).then(setD).catch(err);
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [id]);
  if (!d) return <div className="card">{t('loading')}</div>;
  const name = (uid: string) => d.participants.find((p: any) => p.user_id === uid)?.name ?? '?';
  const play = (mid: string) => api(`/api/tournaments/${id}/room/${mid}`, { body: {} }).then((r) => { roomTokens.set(r.code, { token: r.token, pid: r.pid }); navigate('/room/' + r.code); }).catch(err);
  return (
    <div className="lobby-grid">
      <section className="card">
        <h2>{d.name} <small className="muted">{t(d.format)} · {d.status}</small></h2>
        <p>{t('invite_code')}: <code className="code-big small">{d.code}</code></p>
        {d.status === 'finished' && <h3 className="gold">🏆 {t('winner')}: {name(d.winner_id)}</h3>}
        <h3>{t('standings')}</h3>
        <table className="score-table"><thead><tr><th>#</th><th /><th>Pct.</th><th>{t('matches')}</th><th>{t('wins')}</th></tr></thead>
          <tbody>{d.participants.map((p: any, i: number) => <tr key={p.user_id}><td>{i + 1}</td><td>{p.name}</td><td><b>{p.points}</b></td><td>{p.played}</td><td>{p.wins}</td></tr>)}</tbody></table>
        {d.isOwner && d.status === 'open' && <button className="btn-gold" onClick={() => api(`/api/tournaments/${id}/start`, { body: {} }).then(load).catch(err)}>{t('start_tournament')}</button>}
      </section>
      <section className="card">
        <h3>{t('upcoming')}</h3>
        {d.matches.filter((m: any) => m.status !== 'done').map((m: any) => (
          <div key={m.id} className="friend-row"><span>R{m.round}: {m.players.map(name).join(' · ')}</span>
            {profile && m.players.includes(profile.id) && <button className="btn-green small" onClick={() => play(m.id)}>{t('play_match')}</button>}</div>
        ))}
        <h3>{t('completed')}</h3>
        {d.matches.filter((m: any) => m.status === 'done').map((m: any) => (
          <div key={m.id} className="friend-row"><span>R{m.round}: {m.result.map((r: any) => `${r.rank}. ${r.name} (+${r.points})`).join(' · ')}</span></div>
        ))}
      </section>
    </div>
  );
}
