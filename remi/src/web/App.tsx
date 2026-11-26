import { lazy, Suspense, useEffect } from 'react';
import { useStore } from './store';
import { useT } from './i18n';
import { Home } from './screens/Home';
import { api, session } from './api';

const CreateRoom = lazy(() => import('./screens/CreateRoom').then((m) => ({ default: m.CreateRoom })));
const RoomScreen = lazy(() => import('./screens/Room').then((m) => ({ default: m.RoomScreen })));
const Info = lazy(() => import('./screens/Info').then((m) => ({ default: m.Info })));
const Social = lazy(() => import('./screens/Social').then((m) => ({ default: m.Social })));
const Admin = lazy(() => import('./screens/Admin').then((m) => ({ default: m.Admin })));
const Live = lazy(() => import('./screens/Live').then((m) => ({ default: m.Live })));
const SettingsPage = lazy(() => import('./screens/Info').then((m) => ({ default: m.SettingsPage })));

(window as any).__remiStore = useStore;

export function App() {
  const route = useStore((s) => s.route);
  const lang = useStore((s) => s.settings.lang);
  const theme = useStore((s) => s.settings.theme);
  const hc = useStore((s) => s.settings.highContrast);
  const net = useStore((s) => s.net.status);
  const inRoom = /^\/(room|join)\//.test(route);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    if (!session.get()) return;
    api('/api/me').then((p) => useStore.setState({ profile: p })).catch(() => session.set(null));
  }, []);
  // presence heartbeat for registered players
  useEffect(() => {
    const beat = () => { if (session.get()) { const st = useStore.getState(); api('/api/presence', { body: { status: st.room?.status === 'PLAYING' ? 'playing' : st.room ? 'lobby' : 'available' } }).catch(() => null); } };
    beat(); const i = setInterval(beat, 60000); return () => clearInterval(i);
  }, []);
  let page: JSX.Element;
  const [, a, b] = route.split('/');
  if (inRoom) page = <RoomScreen code={(b ?? '').toUpperCase()} />;
  else if (a === 'create' || a === 'bots' || a === 'training') page = <CreateRoom mode={a === 'create' ? 'human' : a} />;
  else if (['rules', 'howto', 'install'].includes(a)) page = <Info page={a as any} />;
  else if (a === 'settings') page = <SettingsPage />;
  else if (['profile', 'friends', 'leaderboard', 'saved', 'trophies', 'stats', 'tournaments', 'notifications'].includes(a)) page = <Social page={a as any} sub={b} />;
  else if (a === 'admin') page = <Admin />;
  else if (a === 'live') page = <Live />;
  else page = <Home />;
  return (
    <div className={`app theme-${theme} ${hc ? 'hc' : ''}`}>
      <Suspense fallback={<div className="loading">…</div>}>{page}</Suspense>
      {inRoom && net === 'closed' && <OfflineBanner />}
      <Toasts />
    </div>
  );
}

function OfflineBanner() { const t = useT(); return <div className="offline-banner">⚠ {t('offline_banner')}</div>; }
function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return <div className="toasts" aria-live="polite">{toasts.map((x) => <div key={x.id} className={`toast ${x.kind}`}>{x.text}</div>)}</div>;
}
