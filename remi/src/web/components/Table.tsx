import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, useMedia } from '../store';
import { useRack, arrange, arrangeJoker, pendingDrop, colsFor, ZOOM_UI, reshape } from '../rack';
import { useT } from '../i18n';
import { act, send, drawInFlight } from '../net';
import { Tile, COLOR_SYMBOL } from './Tile';
import { Rack, moveTiles, rackHit, meAreaHeight } from './Rack';
import { isRealJoker, tileFace } from '../../engine/tiles';
import { findClose } from '../../engine/bot';
import { passActivatorMustJoker } from '../../engine/game';
import { detectWins, chooseWin } from '../../engine/validator';
import type { GameView } from '../../engine/view';
import type { RoomConfig } from '../../engine/config';
import { RoundResult, MatchResult, VoteDialog, ChatPanel, SettingsDrawer, HintsPanel, Diagnostics, PausedBanner, SavedBanner } from './Overlays';
import { PlayerAvatar } from './Media';
import { sfx } from '../sound';
import { onPad } from '../gamepad';
import { useClickOutside } from '../useOutside';

export type Spot = 'bottom' | 'right' | 'top' | 'left';
const W = 1600;

/** Seat -> screen position, from the local player's perspective. Server turn order is untouched. */
export function relativeSeats(v: GameView, perspective: number): Record<number, Spot> {
  const active = v.seats.filter((s) => s.status === 'ACTIVE' || s.seat === perspective).map((s) => s.seat);
  const n = v.seats.length;
  const order: number[] = [];
  for (let k = 0; k < n; k++) { const s = (perspective + k) % n; if (active.includes(s)) order.push(s); }
  const spots: Spot[] = order.length === 4 ? ['bottom', 'right', 'top', 'left'] : order.length === 3 ? ['bottom', 'right', 'left'] : ['bottom', 'top'];
  const out: Record<number, Spot> = {};
  order.forEach((s, i) => (out[s] = spots[i]));
  return out;
}

/** Fit the fixed logical canvas into the viewport without distortion. */
function useFit(ref: React.RefObject<HTMLDivElement>) {
  const [dims, setDims] = useState({ s: 1, w: W, h: 900 });
  const s = useRef(1);
  useLayoutEffect(() => {
    const calc = () => {
      const vv = window.visualViewport;
      const vw = vv?.width ?? window.innerWidth, vh = vv?.height ?? window.innerHeight;
      const aspect = vw / vh;
      const h = aspect > 1.9 ? 820 : 900;
      const w = Math.max(W, Math.min(2000, Math.round(h * aspect)));
      const sc = Math.min(vw / w, vh / h);
      s.current = sc;
      setDims((d) => (d.s === sc && d.w === w && d.h === h ? d : { s: sc, w, h }));
    };
    calc();
    const ro = new ResizeObserver(calc); if (ref.current?.parentElement) ro.observe(ref.current.parentElement);
    window.visualViewport?.addEventListener('resize', calc); window.addEventListener('orientationchange', calc);
    return () => { ro.disconnect(); window.visualViewport?.removeEventListener('resize', calc); window.removeEventListener('orientationchange', calc); };
  }, [ref]);
  return { ...dims, get: () => s.current };
}

const TurnTimer = memo(function TurnTimer({ deadline, total, paused, idle, mini }: { deadline: number | null; total: number; paused: boolean; idle?: boolean; mini?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const off = useStore((s) => s.net.serverOffset);
  useEffect(() => {
    let raf = 0; let last = -1;
    const tick = () => {
      if (ref.current) {
        const left = deadline ? Math.max(0, Math.ceil((deadline - (Date.now() + off)) / 1000)) : null;
        if (left !== last) {
          last = left ?? -2;
          ref.current.textContent = idle ? '·' : paused ? '⏸' : left === null ? '∞' : String(left);
          ref.current.classList.toggle('low', !idle && left !== null && left <= 5);
          ref.current.style.setProperty('--p', idle ? '0' : left === null || !total ? '1' : String(left / total));
        }
      }
      raf = window.setTimeout(tick, 200) as any;
    };
    tick();
    return () => clearTimeout(raf);
  }, [deadline, total, paused, off, idle]);
  return <div className={`timer ${idle ? 'idle' : ''} ${mini ? 'mini' : ''}`} ref={ref} aria-live="off" />;
});

/**
 * Drag a tile from the table (eligible left discard or the draw pile) onto the rack.
 * A tap without movement keeps the normal click behaviour. The ghost follows the pointer in rAF.
 */
/**
 * Drag a tile from the table (eligible left discard or the draw pile) onto the rack.
 * While dragging, the gesture is tracked on window, so the ghost is always removed: even if the source
 * becomes disabled, re-renders or unmounts mid-drag, the pointer is lost, the app is backgrounded or the window blurs.
 */
function useTableDrag(enabled: boolean, ghost: () => HTMLElement, onDrop: (slot: number | null) => void) {
  const d = useRef<{ sx: number; sy: number; moved: boolean; el: HTMLElement | null; raf: number; x: number; y: number; id: number; stop: () => void } | null>(null);
  const suppressClick = useRef(false);
  const live = useRef({ enabled, onDrop, ghost }); live.current = { enabled, onDrop, ghost };
  const end = (drop: PointerEvent | null) => {
    const s = d.current; if (!s) return;
    d.current = null; s.stop();
    if (s.raf) cancelAnimationFrame(s.raf);
    s.el?.remove();
    if (!s.moved) return;
    suppressClick.current = true; setTimeout(() => (suppressClick.current = false), 0);
    if (!drop || !live.current.enabled) return; // cancelled, or the turn changed mid-drag
    const over = document.elementFromPoint(drop.clientX, drop.clientY)?.closest('.rack-wrap');
    live.current.onDrop(over ? rackHit.slotAt?.(drop.clientX, drop.clientY) ?? null : null);
  };
  useEffect(() => () => end(null), []); // unmount: never leave a ghost behind
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled || d.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const id = e.pointerId;
      const move = (ev: PointerEvent) => {
        const s = d.current; if (!s || ev.pointerId !== id) return;
        s.x = ev.clientX; s.y = ev.clientY;
        if (!s.moved && Math.hypot(s.x - s.sx, s.y - s.sy) > 6) { s.moved = true; s.el = live.current.ghost(); document.body.appendChild(s.el); }
        if (s.moved && !s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; if (s.el) { const k = rackHit.scale(); s.el.style.transform = `translate3d(${s.x - 30 * k}px, ${s.y - 42 * k}px, 0) scale(${(k * 1.08).toFixed(3)})`; } });
      };
      const up = (ev: PointerEvent) => { if (ev.pointerId === id) end(ev); };
      const cancel = () => end(null);
      const vis = () => { if (document.visibilityState === 'hidden') end(null); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
      window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', vis);
      const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', vis); };
      d.current = { sx: e.clientX, sy: e.clientY, moved: false, el: null, raf: 0, x: e.clientX, y: e.clientY, id, stop };
    },
    onClickCapture: (e: React.MouseEvent) => { if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); } },
  };
}

function ghostTile(html: string) {
  const el = document.createElement('div');
  el.className = 'drag-ghost'; el.innerHTML = html;
  return el;
}

function DiscardStack({ seat, v, x, y, mine, eligible, onOpen, open, name, onTake }: { seat: number; v: GameView; x: number; y: number; mine: boolean; eligible: boolean; onOpen: () => void; open: boolean; name: string; onTake: (slot: number | null) => void }) {
  const topRef = useRef<HTMLDivElement>(null);
  const drag = useTableDrag(eligible, () => ghostTile(topRef.current?.innerHTML ?? ''), (slot) => { if (slot !== null) onTake(slot); });
  const pile = v.discards[seat] ?? [];
  const top = pile.at(-1);
  const layers = Math.min(3, Math.max(0, pile.length - 1));
  return (
    <button className={`discard-stack ${eligible ? 'eligible' : ''} ${open ? 'open' : ''} ${v.pass.active ? 'pass-locked' : ''}`} style={{ left: x, top: y }}
      data-drop={mine ? 'discard' : undefined} onClick={onOpen} aria-label={`${name}: ${pile.length}`} data-nav="discard" data-seat={seat} {...drag}>
      {Array.from({ length: layers }, (_, i) => <div key={i} className="layer" style={{ transform: `translate(${(i + 1) * 2}px, ${(i + 1) * -2}px)` }} />)}
      {top !== undefined ? <div ref={topRef} className="top-wrap"><Tile key={top} id={top} joker={v.joker} w={58} h={80} className="top land" /></div> : <div className="empty-slot">{mine ? '⇣' : ''}</div>}
      <span className="count">{pile.length}</span>
    </button>
  );
}

function HistoryBar({ v, seat, onClose }: { v: GameView; seat: number; onClose: () => void }) {
  const t = useT();
  const pile = v.discards[seat] ?? [];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ left: ref.current.scrollWidth, behavior: 'smooth' }); }, [pile.length]);
  const bar = useRef<HTMLDivElement>(null);
  useClickOutside(bar, onClose, '.discard-stack'); // pressing another stack switches the history instead
  return (
    <div className="history-bar" role="dialog" aria-label={t('history_of')} ref={bar}>
      <div className="hb-title">{t('history_of')} <b>{v.seats[seat].name}</b> · {pile.length}</div>
      <div className="hb-tiles" ref={ref} tabIndex={0} data-nav="history">
        {pile.map((id, i) => <Tile key={id} id={id} joker={v.joker} w={44} h={60} className={i === pile.length - 1 ? 'latest' : ''} />)}
        {!pile.length && <span className="muted">—</span>}
      </div>
      <button className="hb-close" onClick={onClose} aria-label={t('close')}>✕</button>
    </div>
  );
}

const SPOT_POS = (w: number, h: number, z = 1) => ({
  avatar: { bottom: [150, h - 150], right: [w - 95 * z, h * 0.42], top: [w / 2, 95 * z], left: [95 * z, h * 0.42] } as Record<Spot, number[]>,
});

export function GameTable() {
  const t = useT();
  const v = useStore((s) => s.game)!;
  const room = useStore((s) => s.room)!;
  const you = useStore((s) => s.you)!;
  const selected = useStore((s) => s.selected);
  const historySeat = useStore((s) => s.historySeat);
  const pending = useStore((s) => s.pendingAid);
  const settings = useStore((s) => s.settings);
  const hints = useStore((s) => s.hints);
  const toast = useStore((s) => s.toast);
  const set = useStore((s) => s.set);
  const cfg = room.config as RoomConfig;
  const canvas = useRef<HTMLDivElement>(null);
  const fit = useFit(canvas);
  const [sortOpen, setSortOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fs, setFs] = useState(!!document.fullscreenElement);
  const [focus, setFocus] = useState<number | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const me = v.me;
  const perspective = me?.seat ?? v.seats.find((s) => s.status === 'ACTIVE')?.seat ?? 0;
  const spots = useMemo(() => relativeSeats(v, perspective), [v.seats, perspective]);
  const seatAt = (sp: Spot) => Number(Object.keys(spots).find((k) => spots[+k] === sp) ?? -1);
  const H = fit.h, Wc = fit.w;
  const myTurn = !!me && v.current === me.seat && !v.paused && room.status === 'PLAYING';
  const canDraw = myTurn && v.phase === 'WAITING_FOR_DRAW' && !pending;
  const canTake = !!me?.canTakeDiscard && !pending && !v.paused;
  const canDiscard = myTurn && ((v.phase === 'WAITING_FOR_DISCARD' && !pending) || (v.phase === 'WAITING_FOR_DRAW' && !!pending && drawInFlight()));
  const handKey = me?.hand.join(',') ?? '';
  const winning = useMemo(() => (me && me.hand.length === 15 ? findClose(v, cfg) : null), [handKey, v.joker, cfg]);
  const selTile = selected.length === 1 ? selected[0] : null;
  const selValidClose = useMemo(() => {
    if (!me || selTile === null || me.hand.length !== 15) return null;
    const rest = me.hand.filter((x) => x !== selTile);
    const jd = isRealJoker(selTile, v.joker);
    if (jd && !cfg.closeByJokerDiscard) return null;
    if (passActivatorMustJoker(cfg, v.pass.by, me.seat) && !jd) return null;
    return chooseWin(detectWins(rest, v.joker, cfg), jd, rest, v.joker, cfg);
  }, [handKey, selTile]);
  const hintTiles = useMemo(() => new Set(hints.flatMap((h) => (['close', 'discard'].includes(h.kind) ? h.tiles : []))), [hints]);

  // ------------------------------------------------------------ actions
  const doDiscard = useCallback((tile: number | null) => {
    if (tile === null) { toast(t('select_tile')); return false; }
    if (!canDiscard) { toast(!myTurn ? t('not_your_turn_msg') : v.phase === 'WAITING_FOR_DRAW' ? t('draw_first') : t('select_tile')); return false; }
    if (isRealJoker(tile, v.joker) && false) return false;
    const sent = act({ type: 'discard', tile }); set({ selected: [] }); return sent;
  }, [canDiscard, v.joker, settings.confirmJoker]);
  const doClose = () => {
    if (!canDiscard || !winning) return;
    if (selValidClose && selTile !== null) { act({ type: 'close', tile: selTile, category: selValidClose.category }); set({ selected: [] }); return; }
    set({ selected: [winning.tile] }); toast(t('select_tile') + ' → ' + t('btn_close'));
  };
  const doPass = () => {
    if (!me?.canPass || pending) return;
    const j = selTile !== null && isRealJoker(selTile, v.joker) ? selTile : me.hand.find((x) => isRealJoker(x, v.joker))!;
    act({ type: 'pass', tile: j }); set({ selected: [] });
  };
  const doDraw = () => { if (canDraw) act({ type: 'draw', source: 'pile' }); };
  const doTake = () => { if (canTake) act({ type: 'draw', source: 'discard' }); };
  const pileDrag = useTableDrag(canDraw, () => ghostTile('<div class="tile back" style="width:58px;height:80px"></div>'), (slot) => { if (slot !== null && canDraw) { pendingDrop.slot = slot; pendingDrop.at = Date.now(); doDraw(); } });
  const sortRef = useRef<HTMLDivElement>(null);
  useClickOutside(sortRef, () => setSortOpen(false), '[data-toggle="sort"]', sortOpen);
  const doAtu = () => { if (me?.canAtu && !pending) act({ type: 'atu' }); };
  const sortBy = (mode: Parameters<typeof arrange>[3]) => {
    if (!me) return;
    useRack.getState().set(arrange(me.hand, settings.rackRows, arrangeJoker(v.joker), mode)); setSortOpen(false); sfx('snap');
  };
  const toggleFs = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); await (screen.orientation as any)?.lock?.('landscape').catch(() => null); }
      else { document.body.classList.toggle('immersive'); setFs(document.body.classList.contains('immersive')); window.scrollTo(0, 1); }
    } catch { document.body.classList.toggle('immersive'); setFs(document.body.classList.contains('immersive')); }
  };
  useEffect(() => { const h = () => setFs(!!document.fullscreenElement || document.body.classList.contains('immersive')); document.addEventListener('fullscreenchange', h); return () => document.removeEventListener('fullscreenchange', h); }, []);
  useEffect(() => { (screen.orientation as any)?.lock?.('landscape').catch(() => null); }, []);
  const [autoQ, setAutoQ] = useState<'balanced' | 'performance' | null>(null);
  useEffect(() => {
    if (settings.quality !== 'auto') return;
    let raf = 0; let last = performance.now(); const f: number[] = [];
    const loop = (t: number) => {
      f.push(t - last); last = t;
      if (f.length < 180) { raf = requestAnimationFrame(loop); return; }
      f.sort((a, b) => a - b);
      const p90 = f[Math.floor(f.length * 0.9)];
      setAutoQ(p90 > 28 ? 'performance' : p90 > 20 ? 'balanced' : null);
    };
    const start = setTimeout(() => (raf = requestAnimationFrame(loop)), 1500);
    return () => { clearTimeout(start); cancelAnimationFrame(raf); };
  }, [settings.quality]);
  const qualityClass = settings.quality === 'auto' ? (autoQ ? `q-${autoQ}` : 'q-auto') : `q-${settings.quality}`;
  // voice/video signalling must be listened to even before this player turns on a mic/camera
  useEffect(() => { if (you.role === 'player' && (cfg.voice || cfg.video)) import('../media'); }, [you.role, cfg.voice, cfg.video]);
  // iOS Safari ignores touch-action for pinch: block zoom gestures on the table only
  useEffect(() => { const stop = (e: Event) => e.preventDefault(); document.addEventListener('gesturestart', stop); return () => document.removeEventListener('gesturestart', stop); }, []);

  // ------------------------------------------------------------ keyboard & controller navigation
  const layout = useRack((s) => s.layout);
  const navRef = useRef({ focus, held, layout, canDraw, canTake, selTile });
  navRef.current = { focus, held, layout, canDraw, canTake, selTile };
  const nav = useCallback((cmd: string) => {
    const n = navRef.current; const cols = colsFor(settings.rackRows, settings.tableZoom); const size = n.layout.length;
    const f = n.focus ?? 0;
    switch (cmd) {
      case 'left': setFocus((f - 1 + size) % size); break;
      case 'right': setFocus((f + 1) % size); break;
      case 'up': setFocus((f - cols + size) % size); break;
      case 'down': setFocus((f + cols) % size); break;
      case 'select': {
        if (n.focus === null) { setFocus(0); break; }
        if (n.held !== null) {
          const id = n.layout[n.held]; if (id !== null && id !== undefined) moveTiles(id, f, [id]); setHeld(null); sfx('snap');
        } else if (n.layout[f] !== null) {
          setHeld(f); set({ selected: [n.layout[f]!] }); sfx('move');
        }
        break;
      }
      case 'cancel': setHeld(null); set({ selected: [], historySeat: null }); setSortOpen(false); setSettingsOpen(false); break;
      case 'discard': doDiscard(n.held !== null ? n.layout[n.held] : n.selTile); setHeld(null); break;
      case 'sort': setSortOpen((x) => !x); break;
      case 'take': if (n.canTake) doTake(); else if (me) set({ historySeat: me.discardFrom }); break;
      case 'draw': doDraw(); break;
      case 'settings': setSettingsOpen((x) => !x); break;
      case 'close': doClose(); break;
    }
  }, [settings.rackRows, doDiscard, canDraw, canTake, me]);
  useEffect(() => onPad(nav), [nav]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      const map: Record<string, string> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'select', Escape: 'cancel', d: 'discard', s: 'sort', q: 'take', w: 'draw', c: 'close', o: 'settings' };
      const cmd = map[e.key]; if (!cmd) return;
      e.preventDefault(); nav(cmd);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [nav]);

  // ------------------------------------------------------------ geometry
  const meH = meAreaHeight(settings); const zf = ZOOM_UI[(settings.tableZoom ?? 1) - 1];
  const P = SPOT_POS(Wc, H, zf);
  const cx = Wc / 2, feltTop = 66, feltBottom = H - meH - 15;
  // keep the centre (pile, Atu, joker) clear of the top player's badge, especially when magnified on short screens
  const topBottom = 95 * zf + 110 * zf;
  const cy = Math.min(Math.max((feltTop + feltBottom) / 2, zf > 1 ? topBottom + 64 * zf : 0), feltBottom - 64 * zf - 30);
  const discardSpot = (sp: Spot, count: number): [number, number] => {
    if (count === 2) return sp === 'bottom' ? [cx + 300, cy + 10] : [cx - 380, cy - 10];
    if (count === 3) return ({ bottom: [Wc - 440, feltBottom - 120], right: [cx - 300, feltTop + 112], left: [380, feltBottom - 120], top: [0, 0] } as any)[sp];
    // top stacks sit below the discard-history bar so every stack stays clickable while it is open
    return ({ bottom: [Wc - 440, feltBottom - 120], right: [Wc - 440, feltTop + 112], top: [380, feltTop + 112], left: [380, feltBottom - 120] } as Record<Spot, [number, number]>)[sp];
  };
  const activeCount = Object.keys(spots).length;
  const currentName = v.seats[v.current]?.name;

  return (
    <div style={{ ['--z' as any]: zf }} className={`table-root ${cfg.training ? 'joker-hints' : ''} zoom-${settings.tableZoom ?? 1} theme-${settings.theme} ${qualityClass} ${settings.highContrast ? 'hc' : ''} ${settings.reducedMotion || settings.skipAnim ? 'rm' : ''}`}>
      <div className="table-canvas" ref={canvas} style={{ width: Wc, height: H, transform: `translate(-50%, -50%) scale(${fit.s})` }}>
        <div className="wood-frame" />
        <div className="felt" style={{ top: feltTop, bottom: meH }}><div className="felt-logo">Gagiu's<br />WorkArt</div></div>

        {/* toolbar */}
        <div className="toolbar">
          <div className="tb-brand">Gagiu's <i>WorkArt</i></div>
          <div className="tb-info">
            <b>{t('lobby')} {room.code}</b>
            <span>{t('round')} {v.round} · {t('opt_startScore')}: {cfg.startingScore}{cfg.training ? ' · ' + t('training_title') : ''}</span>
          </div>
          <div className="tb-actions">
            <LastMoveButton v={v} />
            <MediaButtons />
            {cfg.chat && <button className="tb-btn" data-toggle="chat" onClick={() => setChatOpen((x) => !x)} aria-label={t('chat')} data-nav="btn">💬<ChatBadge /></button>}
            <button className="tb-pill btn" data-toggle="people" onClick={() => setPeopleOpen((x) => !x)} title={t('players')} aria-label={t('players')}>👥 {room.members.filter((m) => m.role === 'player').length}</button>
            <button className="tb-pill btn" data-toggle="people" onClick={() => setPeopleOpen((x) => !x)} title={t('spectators')} aria-label={t('spectators')}>👁 {room.members.filter((m) => m.role === 'spectator').length}</button>
            <button className="tb-btn gold zoom-btn" onClick={() => { const z = ((settings.tableZoom ?? 1) % 3 + 1) as 1 | 2 | 3; useStore.getState().setSettings({ tableZoom: z }); useRack.setState({ layout: reshape(useRack.getState().layout, settings.rackRows) }); }} title={t('table_zoom')} aria-label={t('table_zoom')} data-nav="btn">🔍<small>{settings.tableZoom ?? 1}</small></button>
            <button className="tb-btn gold" onClick={toggleFs} aria-label={t('fullscreen')} title={t('fullscreen')} data-nav="btn">{fs ? <IconMin /> : <IconMax />}</button>
            <button className="tb-btn" data-toggle="settings" onClick={() => setSettingsOpen((x) => !x)} aria-label={t('btn_settings')} data-nav="btn">⚙</button>
          </div>
        </div>

        {/* opponents */}
        {v.seats.map((s) => {
          const sp = spots[s.seat]; if (!sp) return null;
          const [ax, ay] = P.avatar[sp];
          const member = room.members.find((m) => m.pid === room.gameSeatPids[s.seat]);
          const isBottom = sp === 'bottom';
          if (isBottom) return null; // the local player's badge lives in the rack area below
          return (
            <div key={s.seat}>
              <div className={`seat-badge spot-${sp} ${v.current === s.seat && v.phase.startsWith('WAITING') ? 'current' : ''} ${s.status !== 'ACTIVE' ? 'out' : ''}`} style={{ left: ax, top: ay }}>
                <PlayerAvatar pid={member?.pid ?? null} name={s.name} isBot={s.isBot} flaming={v.pass.active && v.pass.by === s.seat} />
                <span className="star-badge" title="Runde câștigate">{s.stats.roundsWon}</span>
                <span className="tiles-badge" title="Piese">{s.tiles}</span>
                <div className="sb-name">{s.name}{member?.isHost ? ' ♛' : ''}</div>
                <div className="sb-score">{s.score}</div>
                {s.status !== 'ACTIVE' && <div className="sb-tag">{t('eliminated')}</div>}
                {member?.autoplay && s.status === 'ACTIVE' && <div className="sb-tag auto">AUTO</div>}
                {member?.away && s.status === 'ACTIVE' && <div className="sb-tag auto">🤖 {t('robot_plays')}</div>}
                <DeclineBubble pid={member?.pid ?? null} />
                {v.current === s.seat && v.phase.startsWith('WAITING') && v.turnDeadline && s.status === 'ACTIVE' && <div className="seat-timer"><TurnTimer deadline={v.turnDeadline} total={cfg.turnSeconds} paused={v.paused} mini /></div>}
                {member && !member.connected && s.status === 'ACTIVE' && <div className="sb-tag warn">{member.botControlled ? t('bot_controlled') : t('disconnected')}</div>}
                {v.atuDeclaredBy.includes(s.seat) && <div className="sb-tag gold">ATU</div>}
              </div>
            </div>
          );
        })}

        {/* discard stacks: each between its owner and the next player */}
        {Object.entries(spots).map(([seatStr, sp]) => {
          const seat = +seatStr;
          const [x, y] = discardSpot(sp, activeCount);
          const eligible = !!me && me.canTakeDiscard && me.discardFrom === seat;
          return <DiscardStack key={seat} seat={seat} v={v} x={x} y={y} mine={me?.seat === seat} eligible={eligible} name={v.seats[seat].name}
            onTake={(slot) => { if (!canTake) return; pendingDrop.slot = slot; pendingDrop.at = Date.now(); doTake(); }}
            open={historySeat === seat} onOpen={() => set({ historySeat: historySeat === seat ? null : seat })} />;
        })}

        {/* centre: pile, indicator, joker, pass */}
        <div className="centre" style={{ left: cx, top: cy }}>
          <button className={`draw-pile ${canDraw ? 'can' : ''}`} onClick={doDraw} aria-disabled={!canDraw} aria-label={t('btn_draw')} data-nav="pile" {...pileDrag}>
            <div className="tile back" style={{ width: 62, height: 86 }} /><div className="tile back l2" style={{ width: 62, height: 86 }} />
            <span className="count">{v.pile}</span>
          </button>
          <div className="indicator">
            <Tile id={v.indicator} w={58} h={80} />
            <span className="lbl">{t('indicator')}</span>
          </div>
{cfg.training && (
          <div className="joker-info" title={t('joker')}>
            <span className="lbl gold">{t('joker')}</span>
            <span className={`jk c-${['red', 'blue', 'yellow', 'black'][v.joker.color]}`}>{v.joker.num}<small>{COLOR_SYMBOL[v.joker.color]}</small></span>
          </div>
          )}
          {cfg.corner?.enabled && <div className={`corner-pot ${v.pot ? 'full' : ''}`} title={t('corner')}><span className="lbl">{t('corner')}</span><b>{v.pot}</b></div>}
          {cfg.pass.enabled && (
            <div className={`pass-area ${v.pass.active ? 'active' : ''}`}>
              {v.pass.tiles.map((id) => <Tile key={id} id={id} joker={v.joker} w={44} h={60} />)}
              <span className="lbl">PASS</span>
            </div>
          )}
        </div>
        {v.pass.active && <div className="pass-banner">{t('pass_active')}{v.pass.turnsLeft !== null ? ` · ${v.pass.turnsLeft}` : ''}</div>}
        <div className="turn-banner" style={{ left: cx, top: Math.min(cy + 70 * zf + 20, feltBottom - 34) }}>
          {v.phase.startsWith('WAITING') ? (myTurn ? <b className="you">{t('your_turn')}</b> : <span>{t('turn_of')} <b>{currentName}</b></span>) : null}
        </div>

        {historySeat !== null && <HistoryBar v={v} seat={historySeat} onClose={() => set({ historySeat: null })} />}

        {/* local player area */}
        <div className="me-area" style={{ top: H - meH, width: Wc, height: meH }}>
          <div className="me-left">
            <MyBadge v={v} seat={perspective} />
            <TurnTimer deadline={myTurn ? v.turnDeadline : null} total={cfg.turnSeconds} paused={v.paused} idle={!myTurn} />
            {me && <TableMenu v={v} cfg={cfg} />}
          </div>
          {me ? (
            <Rack joker={v.joker} scale={fit.get} onDropDiscard={(id) => doDiscard(id)} focusIndex={focus} heldIndex={held} hintTiles={hintTiles} />
          ) : (
            <SpectatorPanel name={v.seats[perspective]?.name} tiles={v.seats[perspective]?.tiles} />
          )}
          {me && (
            <div className="controls">
              <div className="ctl-row">
                <button className="btn-wood" disabled={!canDraw} onClick={doDraw} data-nav="btn">{t('btn_draw')}</button>
                <button className="btn-wood" disabled={!canTake} onClick={doTake} data-nav="btn">{t('btn_take')}</button>
              </div>
              <div className="ctl-row">
                <button className={`btn-green ${selTile !== null && isRealJoker(selTile, v.joker) ? 'joker-warn' : ''}`} disabled={!canDiscard || selTile === null} onClick={() => doDiscard(selTile)} data-nav="btn">{t('btn_discard')}</button>
                <button className={`btn-gold ${winning ? 'pulse' : ''}`} disabled={!canDiscard || !winning} onClick={doClose} data-nav="btn"
                  title={selValidClose ? t(('cat_' + selValidClose.category) as any) + ` · ${selValidClose.penalty}` : ''}>
                  {t('btn_close')}{selValidClose ? ` · ${selValidClose.penalty}` : ''}
                </button>
              </div>
              <div className="ctl-row">
                {cfg.pass.enabled && me.canPass && <button className="btn-pass pulse" disabled={!!pending} onClick={doPass} data-nav="btn">♛ {t('btn_pass')}</button>}
                {cfg.atu.enabled && me.canAtu && <button className="btn-gold pulse" onClick={doAtu} data-nav="btn">{t('btn_atu')}</button>}
                <button className="btn-wood" data-toggle="sort" onClick={() => setSortOpen((x) => !x)} data-nav="btn">{t('btn_sort')}</button>
                <AutoButton />
              </div>
            </div>
          )}
        </div>
        {sortOpen && (
          <div className="sort-menu" role="menu" ref={sortRef}>
            {(['number', 'color', 'runs', 'sets', 'pairs', 'auto'] as const).map((m) => (
              <button key={m} onClick={() => sortBy(m)} data-nav="btn">{t(({ number: 'sort_number', color: 'sort_color', runs: 'group_runs', sets: 'group_sets', pairs: 'group_pairs', auto: 'auto_arrange' } as const)[m])}</button>
            ))}
            <button onClick={() => useRack.getState().doUndo()}>↶ {t('undo')}</button>
            <button onClick={() => useRack.getState().doRedo()}>↷ {t('redo')}</button>
          </div>
        )}
        {cfg.training && me && <HintsPanel />}
        <PausedBanner />
        <SavedBanner />
        <ReplayLayer v={v} spots={spots} discardSpot={(s) => discardSpot(spots[s], activeCount)} avatar={(s) => P.avatar[spots[s]]} centre={[cx, cy]} />
        {(v.phase === 'ROUND_RESULT') && v.result && <RoundResult />}
        {v.phase === 'MATCH_FINISHED' && <MatchResult />}
        <VoteDialog />
        {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
        {peopleOpen && <PeoplePanel onClose={() => setPeopleOpen(false)} />}
        {settingsOpen && <SettingsDrawer onClose={() => setSettingsOpen(false)} />}
      </div>
      {settings.diagnostics && <Diagnostics />}
      <div className="rotate-overlay"><div className="rot-icon">⟳</div><h2>{t('rotate')}</h2><p>{t('rotate_desc')}</p></div>
      {seatAt('bottom') < 0 && null}
    </div>
  );
}

/** Pause / draw / save requests grouped in one compact menu (keeps the rack column uncluttered). */
function TableMenu({ v, cfg }: { v: GameView; cfg: RoomConfig }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useClickOutside(wrap, () => setOpen(false), undefined, open);
  const pick = (kind: 'pause' | 'resume' | 'draw' | 'save') => { send({ t: 'vote', kind }); setOpen(false); };
  return (
    <div className="table-menu" ref={wrap}>
      <button className="small-btn" onClick={() => setOpen(!open)} data-nav="btn" aria-expanded={open}>☰ {t('lobby')}</button>
      {open && (
        <div className="table-menu-pop" role="menu">
          {cfg.pauseVote.enabled && <button onClick={() => pick(v.paused ? 'resume' : 'pause')}>{v.paused ? '▶ ' + t('resume') : '⏸ ' + t('request_pause')}</button>}
          {cfg.drawVote !== false && <button onClick={() => pick('draw')}>🤝 {t('request_draw')}</button>}
          <button onClick={() => pick('save')}>💾 {t('save_match')}</button>
          <button onClick={() => { if (confirm(t('leave_seat_confirm'))) { send({ t: 'leaveSeat' }); setOpen(false); } }}>🚪 {t('leave_seat_match')}</button>
        </div>
      )}
    </div>
  );
}

/** Spectator area: shows the queue position and lets the spectator ask for a seat. */
function SpectatorPanel({ name, tiles }: { name?: string; tiles?: number }) {
  const t = useT();
  const me = useStore((s) => s.room?.members.find((m) => m.pid === s.you?.pid));
  const canQueue = useStore((s) => !!s.room && s.room.mode !== 'training');
  return (
    <div className="spectator-rack">
      <div>👁 {t('spectate')} · {name}: {tiles} 🀫</div>
      {me?.queued ? <div className="queue-info">⏳ {t('in_queue')} <b>#{me.queuePos}</b> — {t('queue_auto')}</div> : null}
      {canQueue && me && <button className={me.queued ? 'btn-wood' : 'btn-green'} onClick={() => send({ t: 'queue', on: !me.queued })}>{me.queued ? t('leave_queue') : t('want_to_play')}</button>}
    </div>
  );
}

/** Who is at the table: players (with status) and spectators (including the queue for a seat). */
export function PeoplePanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const room = useStore((s) => s.room)!;
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, '[data-toggle="people"]');
  const players = room.members.filter((m) => m.role === 'player');
  const specs = room.members.filter((m) => m.role === 'spectator').sort((a, b) => Number(b.queued) - Number(a.queued) || a.queuePos - b.queuePos);
  return (
    <div className="people-pop" ref={ref} role="dialog">
      <h4>{t('players')} ({players.length})</h4>
      <ul>{players.map((m) => <li key={m.pid}><span>{m.isHost ? '♛ ' : ''}{m.name}</span><span className="muted">{[m.autoplay ? 'AUTO' : '', !m.connected ? t('disconnected') : '', m.mic ? '🎙' : '', m.cam ? '📷' : ''].filter(Boolean).join(' ')}</span></li>)}</ul>
      <h4>{t('spectators')} ({specs.length})</h4>
      <ul>{specs.length ? specs.map((m) => <li key={m.pid}><span>👁 {m.name}</span><span className="muted">{m.queued ? `${t('in_queue')} #${m.queuePos}` : !m.connected ? t('disconnected') : ''}</span></li>) : <li className="muted">—</li>}</ul>
    </div>
  );
}

/** "Nu vreau remiză" above the shield of whoever just refused a vote; disappears by itself. */
function DeclineBubble({ pid }: { pid: string | null }) {
  const t = useT();
  const d = useStore((s) => (pid ? s.room?.declines?.find((x) => x.pid === pid) : undefined));
  const off = useStore((s) => s.net.serverOffset);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!d) return;
    const ms = d.until - (Date.now() + off);
    if (ms <= 0) return;
    const id = setTimeout(() => tick((x) => x + 1), ms + 30);
    return () => clearTimeout(id);
  }, [d?.until, off]);
  if (!d || d.until <= Date.now() + off) return null;
  const text = d.kind === 'draw' ? t('no_draw') : d.kind === 'pause' ? t('no_pause') : d.kind === 'save' ? t('no_save') : t('no_resume');
  return <div className="decline-bubble" role="status">🚫 {text}</div>;
}

/** Let the server play my turns (strongest bot) until I press again or make a move myself. */
export function AutoButton() {
  const t = useT();
  const on = useStore((s) => !!s.room?.members.find((m) => m.pid === s.you?.pid)?.autoplay);
  return <button className={`btn-auto ${on ? 'on' : ''}`} onClick={() => send({ t: 'autoplay', on: !on })} title={t('autoplay_hint')} aria-pressed={on} data-nav="btn">{on ? '⏹ AUTO' : '▶ AUTO'}</button>;
}

function MyBadge({ v, seat }: { v: GameView; seat: number }) {
  const t = useT();
  const room = useStore((s) => s.room)!;
  const s = v.seats[seat]; if (!s) return null;
  const member = room.members.find((m) => m.pid === room.gameSeatPids[seat]);
  return (
    <div className={`my-badge ${v.current === seat && v.phase.startsWith('WAITING') ? 'current' : ''} ${s.status !== 'ACTIVE' ? 'out' : ''}`}>
      <PlayerAvatar pid={member?.pid ?? null} name={s.name} isBot={s.isBot} flaming={v.pass.active && v.pass.by === seat} />
      <DeclineBubble pid={member?.pid ?? null} />
      <div><div className="sb-name">{s.name}{member?.isHost ? ' ♛' : ''}</div><div className="sb-score">{s.score}</div>
        {v.atuDeclaredBy.includes(seat) && <div className="sb-tag gold">ATU</div>}{member?.autoplay && <div className="sb-tag auto">AUTO</div>}{s.status !== 'ACTIVE' && <div className="sb-tag">{t('eliminated')}</div>}</div>
    </div>
  );
}

function HiddenRack({ spot, count, x, y, w }: { spot: Spot; count: number; x: number; y: number; w: number }) {
  const n = Math.min(15, count);
  if (spot === 'top') return <div className="hidden-rack top" style={{ left: x, top: y + 70 }}>{Array.from({ length: n }, (_, i) => <div key={i} className="tile back mini" />)}</div>;
  const left = spot === 'left' ? x + 70 : x - 70 - 34;
  void w;
  return <div className={`hidden-rack side ${spot}`} style={{ left, top: y - 170 }}>{Array.from({ length: n }, (_, i) => <div key={i} className="tile back mini-side" />)}</div>;
}

export function ChatBadge() {
  const n = useStore((s) => s.room?.chat.filter((c) => c.kind !== 'system').length ?? 0);
  const [seen, setSeen] = useState(n);
  useEffect(() => { if (n < seen) setSeen(n); }, [n]);
  return n > seen ? <span className="badge" onClick={() => setSeen(n)}>{n - seen}</span> : null;
}

export function MediaButtons() {
  const room = useStore((s) => s.room)!;
  const you = useStore((s) => s.you)!;
  const { micOn, camOn } = useMedia();
  if (you.role !== 'player' || (!room.config.voice && !room.config.video)) return null;
  const load = () => import('../media');
  return (
    <>
      {room.config.voice && <button className={`tb-btn ${micOn ? 'on' : ''}`} onClick={async () => (await load()).toggleMic()} title="Microfon" data-nav="btn"><span className={micOn ? '' : 'off'}>🎤</span></button>}
      {room.config.video && <button className={`tb-btn ${camOn ? 'on' : ''}`} onClick={async () => (await load()).toggleCam()} title="Cameră" data-nav="btn"><span className={camOn ? '' : 'off'}>📷</span></button>}
    </>
  );
}

function LastMoveButton({ v }: { v: GameView }) {
  const t = useT();
  const set = useStore((s) => s.set);
  const has = v.events.some((e) => ['discard', 'draw_discard', 'draw_pile', 'pass', 'atu', 'close'].includes(e.type));
  return <button className="tb-btn" disabled={!has} onClick={() => set({ replayKey: Date.now() })} title={t('last_move')} data-nav="btn">⟲</button>;
}

/** Purely visual replay of the last public event (never touches game state). */
function ReplayLayer({ v, discardSpot, avatar, centre }: { v: GameView; spots: Record<number, Spot>; discardSpot: (s: number) => number[]; avatar: (s: number) => number[]; centre: [number, number] }) {
  const key = useStore((s) => s.replayKey);
  const ref = useRef<HTMLDivElement>(null);
  const [ev, setEv] = useState<GameView['events'][number] | null>(null);
  useEffect(() => {
    if (!key) return;
    const e = [...v.events].reverse().find((x) => ['discard', 'draw_discard', 'draw_pile', 'pass', 'atu', 'close'].includes(x.type));
    if (!e || e.seat === null) return;
    setEv(e);
  }, [key]);
  useEffect(() => {
    if (!ev || !ref.current || ev.seat === null) return;
    const s = ev.seat;
    const a = avatar(s); const d = discardSpot(s); const pileXY = [centre[0] - 140, centre[1] - 43];
    let from: number[] = a, to: number[] = d;
    if (ev.type === 'draw_pile') { from = pileXY; to = a; }
    if (ev.type === 'draw_discard') { from = discardSpot(ev.data?.from ?? s); to = a; }
    if (ev.type === 'pass') { from = a; to = [centre[0] + 220, centre[1] - 30]; }
    if (ev.type === 'atu') { from = a; to = [a[0], a[1] - 60]; }
    const anim = ref.current.animate([
      { transform: `translate(${from[0]}px, ${from[1]}px) scale(0.9)`, opacity: 0.2 },
      { transform: `translate(${(from[0] + to[0]) / 2}px, ${(from[1] + to[1]) / 2 - 60}px) scale(1.15)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${to[0]}px, ${to[1]}px) scale(1)`, opacity: 1 },
    ], { duration: 900, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
    const stop = () => { anim.cancel(); setEv(null); };
    anim.onfinish = () => setTimeout(() => setEv(null), 700);
    window.addEventListener('pointerdown', stop, { once: true });
    return () => { window.removeEventListener('pointerdown', stop); anim.cancel(); };
  }, [ev]);
  if (!ev) return null;
  const showFace = ev.tile !== undefined && ev.type !== 'draw_pile';
  return (
    <div className="replay-ghost" ref={ref}>
      {showFace ? <Tile id={ev.tile!} joker={v.joker} w={58} h={80} /> : <div className="tile back" style={{ width: 58, height: 80 }} />}
      <div className="replay-label">{v.seats[ev.seat!]?.name}</div>
    </div>
  );
}

const IconMax = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
const IconMin = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>;
export { tileFace };
