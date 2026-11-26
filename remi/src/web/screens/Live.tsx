import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useT, errText } from '../i18n';
import { api, roomTokens, ApiError } from '../api';

/** Ongoing tables whose host allowed listing. Watching = spectator seat (hands are never sent). */
export function Live() {
  const t = useT(); const navigate = useStore((s) => s.navigate); const settings = useStore((s) => s.settings); const profile = useStore((s) => s.profile);
  const [tables, setTables] = useState<any[] | null>(null);
  useEffect(() => {
    const load = () => api('/api/live').then((d) => setTables(d.tables)).catch(() => setTables([]));
    load(); const i = setInterval(load, 10000); return () => clearInterval(i);
  }, []);
  const watch = async (code: string) => {
    try {
      if (!roomTokens.get(code)) {
        const r = await api(`/api/rooms/${code}/join`, { body: { name: settings.nickname || profile?.nickname || 'Spectator', spectator: true } });
        roomTokens.set(code, { token: r.token, pid: r.pid });
      }
      navigate('/room/' + code);
    } catch (e) { useStore.getState().toast(errText(e instanceof ApiError ? e.code : 'error', settings.lang), 'error'); }
  };
  return (
    <div className="page">
      <header className="page-head"><button className="btn-wood" onClick={() => navigate('/')}>← {t('back')}</button><h1>📺 {t('menu_live')}</h1></header>
      {tables === null ? <div className="card">{t('loading')}</div> : !tables.length ? <div className="card muted">{t('live_none')}</div> : (
        <div className="live-grid">{tables.map((x) => (
          <div key={x.code} className="card live-card">
            <div className="live-head"><b>{t('lobby')} {x.code}</b><span className={`tag ${x.status === 'PLAYING' ? 'ok' : ''}`}>{x.status === 'PLAYING' ? `● LIVE · ${t('round')} ${x.round}` : t('lobby')}</span></div>
            <ul className="live-players">{x.players.map((p: any, i: number) => <li key={i} className={p.out ? 'out' : ''}>{p.bot ? '🤖' : '👤'} {p.name} {x.status === 'PLAYING' && <b className="gold">{p.score}</b>}</li>)}</ul>
            <div className="live-foot"><span className="muted">👁 {x.spectators}{x.pot ? ` · ${t('corner')} ${x.pot}` : ''}</span><button className="btn-green" onClick={() => watch(x.code)}>{t('watch')}</button></div>
          </div>
        ))}</div>
      )}
    </div>
  );
}
