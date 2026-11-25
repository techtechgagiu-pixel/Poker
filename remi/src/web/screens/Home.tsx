import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useT, errText } from '../i18n';
import { api } from '../api';

export function Home() {
  const t = useT();
  const s = useStore((x) => x.settings); const setS = useStore((x) => x.setSettings); const navigate = useStore((x) => x.navigate);
  const profile = useStore((x) => x.profile);
  const [code, setCode] = useState('');
  const [notif, setNotif] = useState<any[]>([]);
  const [maint, setMaint] = useState<any>(null);
  useEffect(() => { api('/api/config/defaults').then((d) => setMaint(d.maintenance?.enabled ? d.maintenance : null)).catch(() => null); }, []);
  useEffect(() => {
    if (!profile) return;
    const load = () => api('/api/notifications').then((d) => setNotif(d.notifications.filter((n: any) => !n.read_at))).catch(() => null);
    load(); const i = setInterval(load, 30000); return () => clearInterval(i);
  }, [profile]);
  const name = s.nickname || profile?.nickname || '';
  const join = (e?: React.FormEvent) => { e?.preventDefault(); const c = code.trim().toUpperCase(); if (/^[A-Z0-9]{6}$/.test(c)) navigate('/join/' + c); else useStore.getState().toast(errText('room_not_found', s.lang), 'error'); };
  const Item = ({ to, icon, label }: { to: string; icon: string; label: string }) => <button className="menu-tile" onClick={() => navigate(to)}><span className="mi">{icon}</span>{label}</button>;
  return (
    <div className="home">
      <div className="home-bg" />
      <header className="home-head">
        <div className="logo">Gagiu's <i>WorkArt</i></div>
        <div className="home-head-right">
          {profile ? <button className="chip" onClick={() => navigate('/profile')}>{profile.avatar} {profile.nickname}{notif.length ? <span className="badge">{notif.length}</span> : null}</button>
            : <button className="chip" onClick={() => navigate('/profile')}>👤 {t('login')} <small>({t('optional')})</small></button>}
          <select className="chip" value={s.lang} onChange={(e) => setS({ lang: e.target.value as any })} aria-label={t('language')}><option value="ro">RO</option><option value="en">EN</option></select>
        </div>
      </header>
      <main className="home-main">
        <h1>Remi <span className="gold">Okey</span></h1>
        <p className="sub">{t('subtitle')}</p>
        {maint && <div className="maint">🛠 {t('maintenance')} {maint.message}</div>}
        {notif.slice(0, 3).map((n) => (
          <div key={n.id} className="notif-card">{n.payload.text}{n.payload.code && <button className="btn-green" onClick={() => navigate('/join/' + n.payload.code)}>{t('join')}</button>}</div>
        ))}
        <div className="name-row">
          <label htmlFor="nick">{t('nickname')}</label>
          <input id="nick" value={name} maxLength={20} placeholder={t('nicknamePh')} onChange={(e) => setS({ nickname: e.target.value })} />
        </div>
        <div className="main-actions">
          <button className="btn-green big" onClick={() => navigate('/bots')}>▶ {t('menu_bots')}</button>
          <button className="btn-gold big" onClick={() => navigate('/create')}>＋ {t('menu_create')}</button>
          <form className="join-form" onSubmit={join}>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder={t('join_code_ph')} aria-label={t('join_code')} autoCapitalize="characters" />
            <button className="btn-wood">{t('join')} →</button>
          </form>
        </div>
        <nav className="menu-grid">
          <Item to="/create" icon="🌐" label={t('menu_online')} />
          <Item to="/training" icon="🎯" label={t('menu_training')} />
          <Item to="/friends" icon="🤝" label={t('menu_friends')} />
          <Item to="/tournaments" icon="🏟" label={t('menu_tournaments')} />
          <Item to="/leaderboard" icon="🥇" label={t('menu_leaderboard')} />
          <Item to="/saved" icon="💾" label={t('menu_saved')} />
          <Item to="/trophies" icon="🏆" label={t('menu_trophies')} />
          <Item to="/stats" icon="📊" label={t('menu_stats')} />
          <Item to="/rules" icon="📜" label={t('menu_rules')} />
          <Item to="/howto" icon="❓" label={t('menu_howto')} />
          <Item to="/settings" icon="⚙" label={t('menu_settings')} />
          <Item to="/install" icon="📲" label={t('menu_install')} />
        </nav>
      </main>
      <footer className="home-foot">© Gagiu's WorkArt · remi.noventra.ro · v{__APP_VERSION__}</footer>
    </div>
  );
}
