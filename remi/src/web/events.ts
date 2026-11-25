/** Reacts to authoritative view changes: rack reconciliation, sounds, notifications. */
import type { GameView } from '../engine/view';
import { useStore } from './store';
import { useRack, reconcile, initialLayout, loadLocal, saveLocal, Layout } from './rack';
import { sfx } from './sound';
import { send } from './net';

let rackSaveTimer: number | undefined;
export function persistRack(l: Layout) {
  const k = useRack.getState().key; if (!k) return;
  saveLocal(k, l);
  clearTimeout(rackSaveTimer);
  rackSaveTimer = window.setTimeout(() => send({ t: 'rack', layout: l }), 800);
}
useRack.subscribe((s, p) => { if (s.layout !== p.layout) persistRack(s.layout); });

export function onGameView(prev: GameView | null, v: GameView | null, serverRack: Layout | null) {
  const st = useStore.getState();
  if (!v) return;
  const rows = st.settings.rackRows;
  if (v.me) {
    const k = `${st.room?.code}:${st.room?.matchNo}:${v.round}`;
    const rack = useRack.getState();
    if (rack.key !== k) {
      const saved = loadLocal(k) ?? serverRack;
      useRack.setState({ key: k, layout: reconcile(saved ?? initialLayout(v.me.hand, rows, v.joker), v.me.hand, rows), undo: [], redo: [] });
    } else {
      const next = reconcile(rack.layout, v.me.hand, rows);
      if (next.some((x, i) => x !== rack.layout[i])) useRack.setState({ layout: next });
    }
    const sel = st.selected.filter((x) => v.me!.hand.includes(x));
    if (sel.length !== st.selected.length) st.set({ selected: sel });
  }
  if (!prev || prev.round !== v.round) { if (v.round > 0) sfx('draw'); st.set({ historySeat: null, hints: [] }); return; }
  const newEvents = v.events.filter((e) => !prev.events.some((p) => p.n === e.n));
  for (const e of newEvents) {
    if (e.type === 'discard') sfx('discard');
    else if (e.type === 'draw_pile' || e.type === 'draw_discard') sfx('draw');
    else if (e.type === 'pass') sfx('pass');
    else if (e.type === 'atu') sfx('atu');
    else if (e.type === 'close') sfx(v.result?.jokerDiscard ? 'joker' : 'win');
    else if (e.type === 'match_end') sfx('match');
  }
  if (v.me && v.current === v.me.seat && prev.current !== v.current && (v.phase === 'WAITING_FOR_DRAW' || v.phase === 'WAITING_FOR_DISCARD')) {
    sfx('turn');
    if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Remi', { body: st.settings.lang === 'ro' ? 'Este rândul tău!' : 'Your turn!', tag: 'turn' }); } catch { /* ignore */ }
    }
    if (navigator.vibrate) try { navigator.vibrate(60); } catch { /* ignore */ }
  }
  if (v.me && st.hints.length && prev.me && prev.me.hand.length !== v.me.hand.length) st.set({ hints: [] });
}
