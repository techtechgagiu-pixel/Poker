import { useEffect, useState } from 'react';
import { useStore } from '../store';

async function adm(path: string, opts: { method?: string; body?: unknown } = {}): Promise<any> {
  const r = await fetch('/api/admin/' + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? r.status);
  return d;
}

/** Gagiu's WorkArt — Admin Center. Protected by Cloudflare Access + server-side allow-list. No hand data, no score editing. */
export function Admin() {
  const navigate = useStore((s) => s.navigate);
  const [who, setWho] = useState<string | null | false>(null);
  const [tab, setTab] = useState('metrics');
  useEffect(() => { adm('whoami').then((d: any) => setWho(d.email)).catch(() => setWho(false)); }, []);
  if (who === null) return <div className="page center">…</div>;
  if (who === false) return <div className="page center"><h2>403 — acces restricționat</h2><p>Admin Center este protejat prin Cloudflare Access.</p><button className="btn-wood" onClick={() => navigate('/')}>←</button></div>;
  const tabs = ['metrics', 'rooms', 'users', 'flags', 'achievements', 'matches', 'logs', 'audit', 'backups'];
  return (
    <div className="page admin">
      <header className="page-head"><h1>Gagiu's <i>WorkArt</i> — Admin Center</h1><span className="muted">{who}</span></header>
      <div className="tabs">{tabs.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="card">{tab === 'metrics' || tab === 'rooms' ? <Metrics rooms={tab === 'rooms'} /> : tab === 'users' ? <Users /> : tab === 'flags' ? <Flags /> : <Table path={tab} />}</div>
    </div>
  );
}

function Metrics({ rooms }: { rooms: boolean }) {
  const [m, setM] = useState<any>(null);
  const load = () => adm('metrics').then(setM).catch(() => null);
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, []);
  if (!m) return <>…</>;
  if (rooms) return (
    <table className="score-table"><thead><tr><th>Cod</th><th>Status</th><th>Mod</th><th>Conectați</th><th>Spect.</th><th>Boți</th><th>Runda</th><th>Ultima activitate</th><th /></tr></thead>
      <tbody>{m.rooms.map((r: any) => <tr key={r.code}><td>{r.code}</td><td>{r.status}</td><td>{r.mode}</td><td>{r.connected}</td><td>{r.spectators}</td><td>{r.bots}</td><td>{r.round}</td><td>{new Date(r.lastActivity).toLocaleString()}</td>
        <td><button className="btn-danger small" onClick={() => { const reason = prompt('Motiv închidere cameră'); if (reason) adm('rooms/close', { body: { code: r.code, reason } }).then(load); }}>Închide</button></td></tr>)}</tbody></table>
  );
  const K = [['Utilizatori online', m.online], ['Camere active', m.activeRooms], ['Partide active', m.activeMatches], ['Spectatori', m.spectators], ['Boți activi', m.bots], ['Partide terminate', m.completedMatches],
    ['Partide 24h', m.matches24h], ['Jucători înregistrați', m.registeredPlayers], ['Conexiuni voce', m.voice], ['Conexiuni video', m.video], ['WebSocket', m.websockets], ['Cost estimat / oră (USD)', m.costEstimate.perHourUsdApprox]];
  return (
    <>
      <div className="kpis">{K.map(([k, v]) => <div key={k as string} className="kpi"><b>{v as any}</b><span>{k as string}</span></div>)}</div>
      <h3>Erori (24h)</h3>
      <table className="score-table"><tbody>{m.errors24h.map((e: any, i: number) => <tr key={i}><td>{e.source}</td><td>{e.code}</td><td>{e.c}</td></tr>)}</tbody></table>
      <p className="muted small">{m.costEstimate.note}</p>
    </>
  );
}

function Users() {
  const [q, setQ] = useState(''); const [list, setList] = useState<any[]>([]);
  const load = () => adm('users?q=' + encodeURIComponent(q)).then((d) => setList(d.users));
  useEffect(() => { load(); }, [q]);
  return (<><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="username…" />
    <table className="score-table"><thead><tr><th>Utilizator</th><th>Nume</th><th>Creat</th><th>Văzut</th><th /></tr></thead>
      <tbody>{list.map((u) => <tr key={u.id}><td>{u.username}</td><td>{u.nickname}</td><td>{new Date(u.created_at).toLocaleDateString()}</td><td>{u.last_seen ? new Date(u.last_seen).toLocaleString() : '-'}</td>
        <td><button className={u.suspended ? 'btn-green small' : 'btn-danger small'} onClick={() => { const reason = prompt('Motiv'); if (reason !== null) adm('users/suspend', { body: { userId: u.id, suspended: !u.suspended, reason } }).then(load); }}>{u.suspended ? 'Reactivează' : 'Suspendă'}</button></td></tr>)}</tbody></table></>);
}

function Flags() {
  const [flags, setFlags] = useState<any[]>([]);
  const load = () => adm('flags').then((d) => setFlags(d.flags));
  useEffect(() => { load(); }, []);
  const [edit, setEdit] = useState<Record<string, string>>({});
  return (<>
    <p className="muted">maintenance: {'{'}"enabled": true, "emergency": false, "message": "…"{'}'} — oprește partidele noi; partidele în curs continuă. defaultRules: configurația implicită a meselor. limits: limite de resurse. backupRetentionDays: număr.</p>
    {[...flags, ...(['defaultRules', 'backupRetentionDays'].filter((k) => !flags.some((f) => f.key === k)).map((k) => ({ key: k, value: k === 'backupRetentionDays' ? '30' : '{}' })))].map((f) => (
      <div key={f.key} className="flag-row"><b>{f.key}</b>
        <textarea rows={2} value={edit[f.key] ?? f.value} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} />
        <button className="btn-gold small" onClick={() => { try { adm('flags', { method: 'PUT', body: { key: f.key, value: JSON.parse(edit[f.key] ?? f.value) } }).then(load); } catch { alert('JSON invalid'); } }}>Salvează</button></div>
    ))}
  </>);
}

function Table({ path }: { path: string }) {
  const [d, setD] = useState<any>(null);
  const load = () => adm(path).then(setD).catch((e) => setD({ error: String(e) }));
  useEffect(() => { load(); }, [path]);
  if (!d) return <>…</>;
  const rows: any[] = d.achievements ?? d.matches ?? d.errors ?? d.audit ?? d.backups ?? [];
  return (<>
    {path === 'backups' && <button className="btn-gold" onClick={() => adm('backups', { body: {} }).then(load)}>Backup acum</button>}
    {path === 'audit' && <p>Lanț de integritate: {d.chain?.ok ? '✅ valid' : `❌ rupt la #${d.chain?.brokenAt}`} ({d.chain?.rows} înregistrări)</p>}
    <div className="table-scroll"><table className="score-table"><thead><tr>{rows[0] && Object.keys(rows[0]).map((k) => <th key={k}>{k}</th>)}{path === 'achievements' && <th />}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{Object.entries(r).map(([k, v]) => <td key={k}>{k.endsWith('_at') || k === 'ts' ? new Date(v as number).toLocaleString() : String(v ?? '')}</td>)}
        {path === 'achievements' && <td><button className="btn-wood small" onClick={() => { const th = prompt('Prag nou', r.threshold); if (th) adm('achievements', { method: 'PUT', body: { key: r.key, tier: r.tier, threshold: Number(th) } }).then(load); }}>Editează</button></td>}</tr>)}</tbody></table></div>
  </>);
}
