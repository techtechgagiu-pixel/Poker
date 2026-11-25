/** Local-only rack layout (never affects validation). A layout is a flat slot array: rows * cols. */
import { create } from 'zustand';
import { tileFace, effective, isRealJoker, JokerInfo } from '../engine/tiles';

export const COLS: Record<2 | 3, number> = { 2: 16, 3: 12 };
export type Layout = (number | null)[];

interface RackState {
  key: string; // room:round
  layout: Layout; undo: Layout[]; redo: Layout[];
  set: (l: Layout, record?: boolean) => void;
  doUndo: () => void; doRedo: () => void;
}
export const useRack = create<RackState>((set, get) => ({
  key: '', layout: [], undo: [], redo: [],
  set: (l, record = true) => {
    const cur = get().layout;
    set({ layout: l, undo: record ? [...get().undo.slice(-40), cur] : get().undo, redo: record ? [] : get().redo });
  },
  doUndo: () => { const u = get().undo; if (!u.length) return; set({ layout: u[u.length - 1], undo: u.slice(0, -1), redo: [...get().redo, get().layout] }); },
  doRedo: () => { const r = get().redo; if (!r.length) return; set({ layout: r[r.length - 1], redo: r.slice(0, -1), undo: [...get().undo, get().layout] }); },
}));

export function reshape(l: Layout, rows: 2 | 3): Layout {
  const size = rows * COLS[rows];
  if (l.length === size) return l;
  // keep reading order (including gaps) when switching rows; compress trailing gaps if needed
  const out: Layout = new Array(size).fill(null);
  const tiles = l.map((x, i) => [x, i] as const).filter(([x]) => x !== null);
  let gaps = l.length - tiles.length; void gaps;
  let pos = 0;
  for (let i = 0; i < l.length && pos < size; i++) {
    const remainingTiles = tiles.filter(([, k]) => k >= i).length;
    if (l[i] === null) { if (size - pos > remainingTiles) pos++; continue; }
    out[pos++] = l[i];
  }
  return out;
}

/** Reconcile the layout with the authoritative hand: drop missing tiles, place new ones in free slots. */
export function reconcile(l: Layout, hand: number[], rows: 2 | 3): Layout {
  const size = rows * COLS[rows];
  let out = l.length === size ? l.slice() : reshape(l, rows);
  const set = new Set(hand);
  out = out.map((x) => (x !== null && set.has(x) ? x : null));
  const present = new Set(out.filter((x): x is number => x !== null));
  const missing = hand.filter((x) => !present.has(x));
  if (missing.length) {
    // new tiles go to the first free slot after the last tile of the first row that has space
    const lastUsed = out.reduce<number>((a, x, i) => (x !== null ? i : a), -1);
    for (const id of missing) {
      let i = out.findIndex((x, k) => x === null && k > lastUsed);
      if (i < 0) i = out.indexOf(null);
      out[i] = id;
    }
  }
  return out;
}

export function initialLayout(hand: number[], rows: 2 | 3, j: JokerInfo): Layout {
  return arrange(hand, rows, j, 'color');
}

type Mode = 'number' | 'color' | 'runs' | 'sets' | 'pairs' | 'auto';
const key = (id: number, j: JokerInfo) => { const e = effective(id, j); return e ? { c: e.color, n: e.num, w: false } : { c: 9, n: 99, w: true }; };

export function arrange(hand: number[], rows: 2 | 3, j: JokerInfo, mode: Mode): Layout {
  const cols = COLS[rows]; const size = rows * cols;
  const groups: number[][] = [];
  const rest = hand.slice();
  const take = (ids: number[]) => { for (const id of ids) rest.splice(rest.indexOf(id), 1); groups.push(ids); };
  const jokers = () => rest.filter((x) => isRealJoker(x, j));
  if (mode === 'number' || mode === 'color') {
    const s = rest.slice().sort((a, b) => { const x = key(a, j), y = key(b, j); return mode === 'number' ? x.n - y.n || x.c - y.c : x.c - y.c || x.n - y.n; });
    // split into rows of natural groups (by colour when sorting by colour)
    if (mode === 'color') { for (let c = 0; c <= 9; c++) { const g = s.filter((x) => key(x, j).c === c); if (g.length) groups.push(g); } }
    else groups.push(s);
    return pack(groups, cols, size, false);
  }
  const findRuns = () => {
    for (let c = 0; c < 4; c++) {
      const byNum = new Map<number, number>();
      for (const id of rest) { const e = effective(id, j); if (e && e.color === c && !byNum.has(e.num)) byNum.set(e.num, id); }
      let run: number[] = [];
      for (let n = 1; n <= 14; n++) {
        const id = byNum.get(n === 14 ? 1 : n);
        if (id !== undefined && !(n === 14 && run.includes(id))) run.push(id);
        else { if (run.length >= 3) take(run); run = []; }
      }
      if (run.length >= 3) take(run);
    }
  };
  const findSets = () => {
    for (let n = 1; n <= 13; n++) {
      const ids: number[] = []; const colors = new Set<number>();
      for (const id of rest) { const e = effective(id, j); if (e && e.num === n && !colors.has(e.color)) { colors.add(e.color); ids.push(id); } }
      if (ids.length >= 3) take(ids);
      else if (ids.length === 2 && mode === 'auto' && jokers().length) take([...ids, jokers()[0]]);
    }
  };
  const findPairs = () => {
    const seen = new Map<string, number>();
    for (const id of rest.slice()) {
      const e = effective(id, j); if (!e) continue;
      const k = `${e.color}-${e.num}`;
      if (seen.has(k)) { take([seen.get(k)!, id]); seen.delete(k); } else seen.set(k, id);
    }
  };
  if (mode === 'runs') findRuns();
  else if (mode === 'sets') findSets();
  else if (mode === 'pairs') findPairs();
  else { findRuns(); findSets(); }
  const leftovers = rest.slice().sort((a, b) => { const x = key(a, j), y = key(b, j); return x.c - y.c || x.n - y.n; });
  if (leftovers.length) groups.push(leftovers);
  return pack(groups, cols, size, true);
}

function pack(groups: number[][], cols: number, size: number, gaps: boolean): Layout {
  const out: Layout = new Array(size).fill(null);
  let pos = 0;
  const total = groups.reduce((s, g) => s + g.length, 0);
  const spare = size - total;
  let gapBudget = gaps ? Math.max(0, spare - 1) : 0;
  for (const g of groups) {
    for (const id of g) {
      // don't split a small group across rows if it fits on the next row
      out[pos++] = id;
    }
    if (gapBudget > 0 && pos % cols !== 0) { pos++; gapBudget--; }
  }
  void tileFace;
  return out;
}

/** Persist per room+round so a refresh restores the arrangement. */
export function saveLocal(k: string, l: Layout) { try { localStorage.setItem('remi.rack.' + k, JSON.stringify(l)); } catch { /* ignore */ } }
export function loadLocal(k: string): Layout | null { try { return JSON.parse(localStorage.getItem('remi.rack.' + k) ?? 'null'); } catch { return null; } }
