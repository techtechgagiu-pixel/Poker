/** WebSocket client: exponential backoff reconnect, latency pings, deduplicated actions with server ack. */
import { useStore } from './store';
import type { ClientMsg, GameAction, ServerMsg } from '../shared/protocol';
import type { GameView } from '../engine/view';
import { errText } from './i18n';
import { sfx } from './sound';
import { onGameView, onSepticaView } from './events';
import type { SepticaView } from '../engine/septica';
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
/** The action currently waiting for the server, and the actions the player already asked for meanwhile. */
let inflight: { aid: string; v: number; a: GameAction; retried: boolean } | null = null;
const queue: { a: GameAction; retried: boolean }[] = [];

/** True while a draw is travelling to the server: a discard asked for now is queued, not refused. */
export function drawInFlight() { return !!inflight && inflight.a.type === 'draw'; }

/** Is a (queued) action still legal on the freshest authoritative view? Illegal ones are dropped silently. */
function stillValid(a: GameAction, g: GameView): boolean {
  const me = g.me; if (!me || g.paused) return false;
  if (a.type === 'atu') return me.canAtu;
  if (g.current !== me.seat) return false;
  switch (a.type) {
    case 'draw': return g.phase === 'WAITING_FOR_DRAW' && (a.source === 'pile' ? g.pile > 0 : me.canTakeDiscard);
    case 'discard': case 'close': return g.phase === 'WAITING_FOR_DISCARD' && me.hand.includes(a.tile);
    case 'pass': return g.phase === 'WAITING_FOR_DISCARD' && me.canPass && me.hand.includes(a.tile);
  }
  return false;
}

function sendNow(a: GameAction, retried = false): boolean {
  const s = useStore.getState();
  if (!s.game) return false;
  const aid = `${Date.now().toString(36)}-${++aidSeq}`;
  if (!send({ t: 'act', aid, v: s.game.version, a })) { s.toast(errText('offline', s.settings.lang), 'error'); return false; }
  inflight = { aid, v: s.game.version, a, retried };
  s.set({ pendingAid: aid });
  (window as any).__actSent = performance.now();
  // safety valve: never lock the UI for long
  setTimeout(() => { if (useStore.getState().pendingAid === aid) release(aid); }, 4000);
  return true;
}

/** The server answered (or we gave up): free the slot and send the next queued action, if any. */
function release(aid?: string) {
  if (aid && inflight && inflight.aid !== aid) return;
  inflight = null;
  useStore.setState({ pendingAid: null });
  flush();
}
function flush() {
  const s = useStore.getState();
  if (inflight || !s.game) return;
  while (queue.length) {
    const q = queue.shift()!;
    if (stillValid(q.a, s.game)) { sendNow(q.a, q.retried); return; }
  }
}

/**
 * Send a game action. If another is still travelling, the new one is queued (not refused) and goes out
 * automatically the moment the server confirms — so a quick draw -> discard never needs a pause.
 */
export function act(a: GameAction): boolean {
  const s = useStore.getState();
  if (!s.game) return false;
  if (inflight) {
    if (!queue.some((q) => JSON.stringify(q.a) === JSON.stringify(a)) && queue.length < 4) queue.push({ a, retried: false });
    return true;
  }
  return sendNow(a);
}

function handle(m: ServerMsg) {
  const s = useStore.getState();
  switch (m.t) {
    case 'room': s.set({ room: m.room, you: m.you }); break;
    case 'game': {
      if (m.view === null || (m.view as any).kind === 'septica') {
        const sv = m.view as unknown as SepticaView | null;
        if (sv) { sInflight = null; s.set({ sgame: sv, game: null }); onSepticaView(s.sgame, sv); } else s.set({ sgame: null, game: null });
        break;
      }
      const prev = s.game;
      s.set({ game: m.view as GameView, sgame: null });
      m.view = m.view as GameView;
      onGameView(prev, m.view, m.rack ?? null);
      // our action has been applied once the authoritative version moved past the one we sent
      if (inflight && m.view && m.view.version > inflight.v) release(inflight.aid); else flush();
      break;
    }
    case 'ack': {
      const t0 = (window as any).__actSent;
      if (t0) s.set({ net: { ...useStore.getState().net, lastAck: Math.round(performance.now() - t0) } });
      // the new view normally follows within milliseconds; if it does not, do not hold the player up
      { const id = m.aid; setTimeout(() => { if (inflight?.aid === id) release(id); }, 200); }
      break;
    }
    case 'err': {
      const lost = inflight;
      inflight = null; s.set({ pendingAid: null });
      if (m.code === 'stale_state' && lost && !lost.retried) {
        // the table moved on while the request travelled: re-check against the fresh state (sent right after this
        // message) and resend once — no error shown, no second try needed from the player
        queue.unshift({ a: lost.a, retried: true });
        break;
      }
      queue.length = 0;
      s.toast(errText(m.code, s.settings.lang), 'error'); sfx('error');
      break;
    }
    case 'pong': s.set({ net: { ...useStore.getState().net, latency: Math.round(performance.now() - m.ts), serverOffset: m.server - Date.now() } }); break;
    case 'hints': s.set({ hints: m.hints }); break;
    case 'rtc': for (const h of rtcHandlers) h(m.from, m.data); break;
    case 'kicked': if (code) roomTokens.clear(code); disconnect(); s.set({ room: null, game: null, sgame: null, you: null }); s.navigate('/'); s.toast('Ai fost scos din cameră.', 'error'); break;
    case 'replaced': disconnect(); s.set({ net: { ...s.net, status: 'closed' } }); s.toast('Masa a fost deschisă în alt tab.', 'error'); break;
  }
}

// Test/diagnostic hook. Grants nothing: the server validates every message regardless of source.
(window as any).__remiSend = (m: ClientMsg) => send(m);

/** Septică: one move at a time. A second tap before the server answered is ignored (no double plays). */
let sInflight: number | null = null;
export function sact(a: GameAction): boolean {
  const g = useStore.getState().sgame; if (!g) return false;
  if (sInflight === g.version) return false;
  const aid = `${Date.now().toString(36)}-${++aidSeq}`;
  if (!send({ t: 'act', aid, v: g.version, a })) return false;
  sInflight = g.version;
  setTimeout(() => { if (sInflight === g.version) sInflight = null; }, 2500);
  return true;
}
