/** WebSocket client: exponential backoff reconnect, latency pings, deduplicated actions with server ack. */
import { useStore } from './store';
import type { ClientMsg, GameAction, ServerMsg } from '../shared/protocol';
import { errText } from './i18n';
import { sfx } from './sound';
import { onGameView } from './events';
import { roomTokens } from './api';

let ws: WebSocket | null = null;
let code: string | null = null;
let token: string | null = null;
let retry = 0;
let timer: number | undefined;
let pingTimer: number | undefined;
let closedByUs = false;
const rtcHandlers = new Set<(from: string, data: any) => void>();
export function onRtc(h: (from: string, data: any) => void) { rtcHandlers.add(h); return () => rtcHandlers.delete(h); }

export function connect(c: string, tk: string) {
  if (ws && code === c && token === tk && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  disconnect();
  code = c; token = tk; closedByUs = false; retry = 0;
  open();
}

function open() {
  if (!code || !token) return;
  const st = useStore.getState();
  st.set({ net: { ...st.net, status: 'connecting' } });
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws/${code}?token=${encodeURIComponent(token)}`);
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    const s = useStore.getState();
    s.set({ net: { ...s.net, status: 'open' } });
    ping();
    clearInterval(pingTimer); pingTimer = window.setInterval(ping, 5000);
  };
  sock.onmessage = (e) => handle(JSON.parse(e.data) as ServerMsg);
  sock.onclose = (e) => {
    if (ws !== sock) return;
    clearInterval(pingTimer);
    const s = useStore.getState();
    s.set({ net: { ...s.net, status: 'closed' }, pendingAid: null });
    if (closedByUs || e.code === 4001 || e.code === 4003 || e.code === 4004) return;
    if (e.code === 1008 || e.code === 1002) return;
    const delay = Math.min(10000, 400 * 2 ** retry) * (0.75 + Math.random() * 0.5);
    retry++;
    s.set({ net: { ...useStore.getState().net, reconnects: s.net.reconnects + 1 } });
    timer = window.setTimeout(open, delay);
  };
}

export function disconnect() {
  closedByUs = true; clearTimeout(timer); clearInterval(pingTimer);
  if (ws) { try { ws.close(1000); } catch { /* ignore */ } }
  ws = null;
}

function ping() { send({ t: 'ping', ts: performance.now() }); }

/** Reconnect immediately when the tab becomes visible again (mobile backgrounding). */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && code && token && (!ws || ws.readyState === WebSocket.CLOSED)) { clearTimeout(timer); retry = 0; closedByUs = false; open(); }
});
window.addEventListener('online', () => { if (code && token && (!ws || ws.readyState !== WebSocket.OPEN)) { clearTimeout(timer); retry = 0; closedByUs = false; open(); } });

export function send(m: ClientMsg): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(m));
  return true;
}

let aidSeq = 0;
/** Send a game action once; ignores repeats while one is in flight (double click / latency). */
export function act(a: GameAction): boolean {
  const s = useStore.getState();
  if (s.pendingAid || !s.game) return false;
  const aid = `${Date.now().toString(36)}-${++aidSeq}`;
  if (!send({ t: 'act', aid, v: s.game.version, a })) { s.toast(errText('offline', s.settings.lang), 'error'); return false; }
  s.set({ pendingAid: aid });
  (window as any).__actSent = performance.now();
  // safety valve: never lock the UI for long
  setTimeout(() => { if (useStore.getState().pendingAid === aid) useStore.setState({ pendingAid: null }); }, 4000);
  return true;
}

function handle(m: ServerMsg) {
  const s = useStore.getState();
  switch (m.t) {
    case 'room': s.set({ room: m.room, you: m.you }); break;
    case 'game': {
      const prev = s.game;
      s.set({ game: m.view, pendingAid: m.view && prev && m.view.version !== prev.version ? null : s.pendingAid });
      onGameView(prev, m.view, m.rack ?? null);
      break;
    }
    case 'ack': {
      const t0 = (window as any).__actSent;
      if (t0) s.set({ net: { ...useStore.getState().net, lastAck: Math.round(performance.now() - t0) } });
      if (s.pendingAid === m.aid) s.set({ pendingAid: null });
      break;
    }
    case 'err': {
      s.set({ pendingAid: null });
      s.toast(errText(m.code, s.settings.lang), 'error'); sfx('error');
      break;
    }
    case 'pong': s.set({ net: { ...useStore.getState().net, latency: Math.round(performance.now() - m.ts), serverOffset: m.server - Date.now() } }); break;
    case 'hints': s.set({ hints: m.hints }); break;
    case 'rtc': for (const h of rtcHandlers) h(m.from, m.data); break;
    case 'kicked': if (code) roomTokens.clear(code); disconnect(); s.set({ room: null, game: null, you: null }); s.navigate('/'); s.toast('Ai fost scos din cameră.', 'error'); break;
    case 'replaced': disconnect(); s.set({ net: { ...s.net, status: 'closed' } }); s.toast('Masa a fost deschisă în alt tab.', 'error'); break;
  }
}
