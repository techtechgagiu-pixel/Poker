/**
 * Winning-hand validation engine.
 * Exhaustive, memoised backtracking over a 52-cell count vector (4 colours x 13 numbers) plus a
 * wildcard count (real jokers). Never greedy: every formation containing the lowest remaining tile is tried.
 */
import { Color, JokerInfo, effective, isRealJoker, natural } from './tiles';
import { CategoryKey, CATEGORY_KEYS, RoomConfig } from './config';

export type AbstractFormation =
  | { type: 'run'; color: Color; start: number; len: number; wild: number[] } // wild = positions filled by jokers (14 = high ace)
  | { type: 'set'; num: number; colors: Color[]; wildColors: Color[] }
  | { type: 'pair'; color: Color; num: number; wilds: number } // wilds 0..2
  | { type: 'color'; color: Color };

export interface Formation {
  type: 'run' | 'set' | 'pair' | 'color';
  tiles: number[];
  /** Real jokers and the value they stand for. */
  jokers: { id: number; color: Color; num: number }[];
}

export interface WinMatch { category: CategoryKey; formations: Formation[] }

type Mode = 'mixed' | 'runs' | 'sets';
const cell = (c: number, n: number) => c * 13 + (n - 1);
const posNum = (p: number) => (p === 14 ? 1 : p);

interface Opt { highAce: boolean; allowFourSets: boolean }

/** Enumerate every formation that contains the real tile in cell `i`. Yields consumed cells and wilds used. */
function* formationsWith(i: number, counts: number[], w: number, mode: Mode, opt: Opt): Generator<{ used: number[]; wilds: number; f: AbstractFormation }> {
  const c = Math.floor(i / 13) as Color;
  const n = (i % 13) + 1;
  if (mode !== 'sets') {
    const maxPos = opt.highAce ? 14 : 13;
    const positions = n === 1 && opt.highAce ? [1, 14] : [n];
    for (const p of positions) {
      for (let len = 3; len <= 5; len++) {
        for (let s = Math.max(1, p - len + 1); s <= p && s + len - 1 <= maxPos; s++) {
          // positions other than p
          const others: number[] = [];
          for (let q = s; q < s + len; q++) if (q !== p) others.push(q);
          // a run may not contain the same number twice (1 and 14) — impossible for len<=5 except never
          yield* runCombos(c, s, len, others, 0, counts, w, [i], 0, []);
        }
      }
    }
  }
  if (mode !== 'runs') {
    const otherColors = ([0, 1, 2, 3] as Color[]).filter((x) => x !== c);
    // each other colour: 0 absent, 1 real, 2 wild
    const total = 3 ** 3;
    for (let mask = 0; mask < total; mask++) {
      let m = mask; const colors: Color[] = [c]; const wildColors: Color[] = []; const used = [i]; let ok = true;
      for (const oc of otherColors) {
        const ch = m % 3; m = Math.floor(m / 3);
        if (ch === 1) { const ci = cell(oc, n); if (counts[ci] <= 0) { ok = false; break; } colors.push(oc); used.push(ci); }
        else if (ch === 2) wildColors.push(oc);
      }
      if (!ok || wildColors.length > w) continue;
      const size = colors.length + wildColors.length;
      if (size < 3 || size > 4) continue;
      if (size === 4 && !opt.allowFourSets) continue;
      yield { used, wilds: wildColors.length, f: { type: 'set', num: n, colors, wildColors } };
    }
  }
}

function* runCombos(c: Color, s: number, len: number, others: number[], k: number, counts: number[], w: number,
  used: number[], wildsUsed: number, wildPos: number[]): Generator<{ used: number[]; wilds: number; f: AbstractFormation }> {
  if (k === others.length) {
    yield { used: used.slice(), wilds: wildsUsed, f: { type: 'run', color: c, start: s, len, wild: wildPos.slice() } };
    return;
  }
  const q = others[k];
  const ci = cell(c, posNum(q));
  const already = used.filter((u) => u === ci).length;
  if (counts[ci] - already > 0) {
    used.push(ci);
    yield* runCombos(c, s, len, others, k + 1, counts, w, used, wildsUsed, wildPos);
    used.pop();
  }
  if (wildsUsed < w) {
    wildPos.push(q);
    yield* runCombos(c, s, len, others, k + 1, counts, w, used, wildsUsed + 1, wildPos);
    wildPos.pop();
  }
}

function partition(counts: number[], w: number, mode: Mode, opt: Opt, memo: Map<string, AbstractFormation[] | null>): AbstractFormation[] | null {
  let i = 0;
  while (i < 52 && counts[i] === 0) i++;
  if (i === 52) return w === 0 ? [] : null;
  const key = counts.join('') + w;
  if (memo.has(key)) return memo.get(key)!;
  let result: AbstractFormation[] | null = null;
  for (const { used, wilds, f } of formationsWith(i, counts, w, mode, opt)) {
    for (const u of used) counts[u]--;
    const rest = partition(counts, w - wilds, mode, opt, memo);
    for (const u of used) counts[u]++;
    if (rest) { result = [f, ...rest]; break; }
  }
  memo.set(key, result);
  return result;
}

/** Max number of tiles that can be placed in complete runs/sets (used by bots). */
export function maxCoverage(counts: number[], w: number, opt: Opt, mode: Mode = 'mixed', memo = new Map<string, number>()): number {
  let i = 0;
  while (i < 52 && counts[i] === 0) i++;
  if (i === 52) return 0;
  const key = counts.join('') + w;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  counts[i]--;
  let best = maxCoverage(counts, w, opt, mode, memo); // leave tile i uncovered
  counts[i]++;
  for (const { used, wilds, f } of formationsWith(i, counts, w, mode, opt)) {
    for (const u of used) counts[u]--;
    const size = f.type === 'run' ? f.len : used.length + wilds;
    const v = size + maxCoverage(counts, w - wilds, opt, mode, memo);
    for (const u of used) counts[u]++;
    if (v > best) best = v;
  }
  memo.set(key, best);
  return best;
}

export interface HandAnalysis {
  counts: number[]; // effective cells of non-wild tiles
  wildIds: number[];
  naturalPools: Map<number, number[]>; // cell -> tile ids
}

/** Split a hand into natural cell counts and wildcards. If jokers are not allowed, real jokers count at their natural value. */
export function analyse(hand: number[], j: JokerInfo, allowJokers: boolean): HandAnalysis {
  const counts = new Array(52).fill(0);
  const wildIds: number[] = [];
  const naturalPools = new Map<number, number[]>();
  for (const id of hand) {
    const e = allowJokers ? effective(id, j) : natural(id, j);
    if (!e) { wildIds.push(id); continue; }
    const ci = cell(e.color, e.num);
    counts[ci]++;
    if (!naturalPools.has(ci)) naturalPools.set(ci, []);
    naturalPools.get(ci)!.push(id);
  }
  return { counts, wildIds, naturalPools };
}

function materialise(fs: AbstractFormation[], a: HandAnalysis): Formation[] {
  const pools = new Map([...a.naturalPools].map(([k, v]) => [k, v.slice()]));
  const wilds = a.wildIds.slice();
  const take = (ci: number) => pools.get(ci)!.pop()!;
  return fs.map((f) => {
    if (f.type === 'run') {
      const tiles: number[] = []; const jokers: Formation['jokers'] = [];
      for (let p = f.start; p < f.start + f.len; p++) {
        if (f.wild.includes(p)) { const id = wilds.pop()!; tiles.push(id); jokers.push({ id, color: f.color, num: posNum(p) }); }
        else tiles.push(take(cell(f.color, posNum(p))));
      }
      return { type: 'run', tiles, jokers };
    }
    if (f.type === 'set') {
      const tiles = f.colors.map((c) => take(cell(c, f.num))); const jokers: Formation['jokers'] = [];
      for (const c of f.wildColors) { const id = wilds.pop()!; tiles.push(id); jokers.push({ id, color: c, num: f.num }); }
      return { type: 'set', tiles, jokers };
    }
    return { type: f.type, tiles: [], jokers: [] };
  });
}

function partitionHand(hand: number[], j: JokerInfo, mode: Mode, allowJokers: boolean, opt: Opt): Formation[] | null {
  const a = analyse(hand, j, allowJokers);
  const r = partition(a.counts.slice(), a.wildIds.length, mode, opt, new Map());
  return r ? materialise(r, a) : null;
}

export function checkDoubles(hand: number[], j: JokerInfo, allowJokers: boolean, doubleJokerPair: boolean): Formation[] | null {
  if (hand.length !== 14) return null;
  const a = analyse(hand, j, allowJokers);
  const pairs: Formation[] = []; const singles: number[] = [];
  for (const [ci, ids] of a.naturalPools) {
    const ps = ids.slice();
    while (ps.length >= 2) pairs.push({ type: 'pair', tiles: [ps.pop()!, ps.pop()!], jokers: [] });
    if (ps.length) singles.push(ps[0]);
    void ci;
  }
  const wilds = a.wildIds.slice();
  if (singles.length > wilds.length) return null;
  for (const s of singles) {
    const wid = wilds.pop()!; const e = effective(s, j) ?? natural(s, j);
    pairs.push({ type: 'pair', tiles: [s, wid], jokers: [{ id: wid, color: e.color, num: e.num }] });
  }
  if (wilds.length === 2) {
    if (!doubleJokerPair) return null;
    pairs.push({ type: 'pair', tiles: wilds.slice(), jokers: wilds.map((id) => ({ id, color: j.color, num: j.num })) });
  } else if (wilds.length !== 0) return null;
  return pairs.length === 7 ? pairs : null;
}

/** Color: all 14 rack tiles share one effective colour. No formations required. */
export function checkColor(hand: number[], j: JokerInfo, allowJokers: boolean): Formation[] | null {
  if (hand.length !== 14) return null;
  let color: Color | null = null; const jokers: Formation['jokers'] = [];
  const wild: number[] = [];
  for (const id of hand) {
    const e = allowJokers ? effective(id, j) : natural(id, j);
    if (!e) { wild.push(id); continue; }
    if (color === null) color = e.color; else if (color !== e.color) return null;
  }
  if (color === null) color = j.color;
  for (const id of wild) jokers.push({ id, color, num: 0 });
  return [{ type: 'color', tiles: hand.slice(), jokers }];
}

export function handHasRealJoker(hand: number[], j: JokerInfo) { return hand.some((id) => isRealJoker(id, j)); }

/** Detect every enabled category satisfied by a 14-tile hand. */
export function detectWins(hand: number[], j: JokerInfo, cfg: RoomConfig): WinMatch[] {
  if (hand.length !== 14 || new Set(hand).size !== 14) return [];
  const out: WinMatch[] = [];
  const C = cfg.categories;
  const opt: Opt = { highAce: cfg.highAce, allowFourSets: true };
  const hasJoker = handHasRealJoker(hand, j);
  if (C.normalJoker.enabled || C.normalPlain.enabled) {
    const p = partitionHand(hand, j, 'mixed', true, opt);
    if (p) {
      if (hasJoker && C.normalJoker.enabled) out.push({ category: 'normalJoker', formations: p });
      if (!hasJoker && C.normalPlain.enabled) out.push({ category: 'normalPlain', formations: p });
    }
  }
  if (C.sequences.enabled) {
    const p = partitionHand(hand, j, 'runs', C.sequences.allowJokers, opt);
    if (p) out.push({ category: 'sequences', formations: p });
  }
  if (C.triples.enabled) {
    const p = partitionHand(hand, j, 'sets', C.triples.allowJokers, { ...opt, allowFourSets: cfg.triplesAllowFour });
    if (p) out.push({ category: 'triples', formations: p });
  }
  if (C.grand.enabled) {
    const p = partitionHand(hand, j, 'sets', C.grand.allowJokers, opt);
    if (p) out.push({ category: 'grand', formations: p });
  }
  if (C.doubles.enabled) {
    const p = checkDoubles(hand, j, C.doubles.allowJokers, cfg.doubleJokerPair);
    if (p) out.push({ category: 'doubles', formations: p });
  }
  if (C.color.enabled) {
    const p = checkColor(hand, j, C.color.allowJokers);
    if (p) out.push({ category: 'color', formations: p });
  }
  return out;
}

export function categoryPenalty(cat: CategoryKey, jokerDiscard: boolean, hand: number[], j: JokerInfo, cfg: RoomConfig): number {
  const c = cfg.categories[cat];
  let p = jokerDiscard ? c.jokerPenalty : c.penalty;
  if (cfg.jokerMultiplier.enabled) {
    const n = hand.filter((id) => isRealJoker(id, j)).length;
    p *= cfg.jokerMultiplier.factorPerJoker ** n;
  }
  return p;
}

/** Choose the category to score: explicit request (if valid), else configured priority, else highest penalty. */
export function chooseWin(matches: WinMatch[], jokerDiscard: boolean, hand: number[], j: JokerInfo, cfg: RoomConfig, requested?: CategoryKey): (WinMatch & { penalty: number }) | null {
  if (!matches.length) return null;
  if (requested) {
    const m = matches.find((x) => x.category === requested);
    return m ? { ...m, penalty: categoryPenalty(m.category, jokerDiscard, hand, j, cfg) } : null;
  }
  if (cfg.priority.length) {
    for (const k of cfg.priority) {
      const m = matches.find((x) => x.category === k);
      if (m) return { ...m, penalty: categoryPenalty(k, jokerDiscard, hand, j, cfg) };
    }
  }
  // highest penalty; ties broken by fixed order (grand before triples, etc.)
  const order: CategoryKey[] = ['grand', 'color', 'doubles', 'sequences', 'triples', 'normalPlain', 'normalJoker'];
  let best: (WinMatch & { penalty: number }) | null = null;
  for (const k of order) {
    const m = matches.find((x) => x.category === k);
    if (!m) continue;
    const p = categoryPenalty(k, jokerDiscard, hand, j, cfg);
    if (!best || p > best.penalty) best = { ...m, penalty: p };
  }
  return best;
}

export { CATEGORY_KEYS, cell };
