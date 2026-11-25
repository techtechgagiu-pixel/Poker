import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Service worker: static assets only. Activation of a new version is deferred while a match is running.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const tryActivate = () => {
      const st = (window as any).__remiStore?.getState?.();
      const inMatch = st?.room?.status === 'PLAYING';
      if (reg.waiting && !inMatch) reg.waiting.postMessage('SKIP_WAITING');
    };
    reg.addEventListener('updatefound', () => setTimeout(tryActivate, 2000));
    setInterval(tryActivate, 30000);
  }).catch(() => null);
}
