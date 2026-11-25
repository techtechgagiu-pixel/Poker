/**
 * Training scenarios: deal the trainee a hand that demonstrates a category. Only used in training rooms.
 * Tiles are swapped between locations, so every physical tile remains in exactly one place.
 */
import { GameState, prevActive } from './game';
import { Rng, tileFace, isRealJoker } from './tiles';

export type Scenario = 'normalPlain' | 'normalJoker' | 'sequences' | 'triples' | 'doubles' | 'color' | 'grand' | 'pass' | 'atu' | 'closeJoker';
export const SCENARIOS: Scenario[] = ['normalPlain', 'normalJoker', 'closeJoker', 'sequences', 'triples', 'doubles', 'color', 'grand', 'pass', 'atu'];

const idOf = (c: number, n: number, copy: number) => c * 26 + copy * 13 + (n - 1);

/** Make `seat` the starter of the next startRound() call. */
export function prepareStarter(g: GameState, seat: number) { g.starter = prevActive(g, seat); }

function pick(g: GameState, want: [number, number][], used: Set<number>): number[] | null {
  const out: number[] = [];
  for (const [c, n] of want) {
    const id = [idOf(c, n, 0), idOf(c, n, 1)].find((x) => !used.has(x) && x !== g.indicator && !isRealJoker(x, g.joker));
    if (id === undefined) return null;
    used.add(id); out.push(id);
  }
  return out;
}

function build(g: GameState, s: Scenario, rng: Rng): number[] | null {
  const used = new Set<number>();
  const jokers = [idOf(g.joker.color, g.joker.num, 0), idOf(g.joker.color, g.joker.num, 1)];
  for (let attempt = 0; attempt < 60; attempt++) {
    used.clear();
    const col = () => rng(4);
    const run = (len: number) => { const c = col(); const st = 1 + rng(13 - len + 1); return Array.from({ length: len }, (_, i) => [c, st + i] as [number, number]); };
    const set = (len: number, n = 1 + rng(13)) => { const cs = [0, 1, 2, 3].sort(() => rng(3) - 1).slice(0, len); return cs.map((c) => [c, n] as [number, number]); };
    let want: [number, number][] = [];
    let extra: number[] = [];
    if (s === 'normalPlain' || s === 'normalJoker' || s === 'closeJoker' || s === 'pass' || s === 'atu') want = [...run(4), ...run(4), ...run(3), ...set(3)];
    else if (s === 'sequences') want = [...run(4), ...run(4), ...run(3), ...run(3)];
    else if (s === 'triples' || s === 'grand') { const ns = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].sort(() => rng(3) - 1); want = [...set(4, ns[0]), ...set(4, ns[1]), ...set(3, ns[2]), ...set(3, ns[3])]; }
    else if (s === 'doubles') { const cells = new Set<string>(); while (cells.size < 7) cells.add(`${col()}-${1 + rng(13)}`); want = [...cells].flatMap((k) => { const [c, n] = k.split('-').map(Number); return [[c, n], [c, n]] as [number, number][]; }); }
    else if (s === 'color') { const c = col(); want = Array.from({ length: 14 }, () => [c, 1 + rng(13)] as [number, number]); }
    // duplicates of a cell need distinct copies
    const ids: number[] = [];
    let ok = true;
    for (const w of want) { const p = pick(g, [w], used); if (!p) { ok = false; break; } ids.push(p[0]); }
    if (!ok) continue;
    if (s === 'normalJoker') { ids[1] = jokers[0]; }
    if (s === 'pass') { ids[12] = jokers[0]; ids[13] = jokers[1]; }
    if (s === 'atu') {
      const f = tileFace(g.indicator); const twin = [idOf(f.color, f.num, 0), idOf(f.color, f.num, 1)].find((x) => x !== g.indicator)!;
      if (ids.includes(twin)) continue;
      ids[13] = twin;
    }
    // the 15th tile: a joker for closeJoker, otherwise a harmless extra
    if (s === 'closeJoker') extra = [jokers[0]];
    return [...ids, ...extra];
  }
  return null;
}

/** Rig the seat's hand (after startRound, before any action). Returns false if impossible. */
export function rigScenario(g: GameState, seat: number, s: Scenario, rng: Rng): boolean {
  const target = build(g, s, rng);
  if (!target) return false;
  const hand = g.hands[seat];
  const size = hand.length;
  const final = target.slice(0, size);
  // fill to hand size with tiles already in hand that are not part of the target
  for (const id of hand) { if (final.length >= size) break; if (!final.includes(id)) final.push(id); }
  // swap every needed tile into the hand from wherever it is
  for (const id of final) {
    if (hand.includes(id)) continue;
    const out = hand.find((x) => !final.includes(x))!;
    const locs = [g.drawPile, ...g.hands.filter((_, k) => k !== seat)];
    const arr = locs.find((a) => a.includes(id));
    if (!arr) return false;
    arr[arr.indexOf(id)] = out;
    hand[hand.indexOf(out)] = id;
  }
  return true;
}
