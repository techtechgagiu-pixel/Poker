/**
 * Bots. They only receive a GameView (own hand + public info) — identical to what a human client gets.
 */
import { RoomConfig, CategoryKey } from './config';
import { GameView } from './view';
import { JokerInfo, Rng, isRealJoker, effective, natural } from './tiles';
import { analyse, maxCoverage, chooseWin, detectWins, cell } from './validator';
import { passActivatorMustJoker } from './game';

export type Level = 'easy' | 'medium' | 'hard';
export type BotMove =
  | { type: 'close'; tile: number; category: CategoryKey }
  | { type: 'discard'; tile: number }
  | { type: 'pass'; tile: number };

/** Progress (0..14) of a 14-tile hand toward the best enabled strategy. */
export function handProgress(hand: number[], j: JokerInfo, cfg: RoomConfig, level: Level): number {
  const C = cfg.categories;
  const a = analyse(hand, j, true);
  const w = a.wildIds.length;
  let best = 0;
  if (C.normalJoker.enabled || C.normalPlain.enabled || C.sequences.enabled || (level === 'easy' && (C.grand.enabled || C.triples.enabled))) {
    const cov = maxCoverage(a.counts.slice(), w, { highAce: cfg.highAce, allowFourSets: true });
    // partial connections among all tiles (near-runs / near-sets), lightly weighted
    best = Math.max(best, cov + 0.35 * Math.min(6, connections(a.counts)));
  }
  if (level !== 'easy') {
    if (C.doubles.enabled) {
      let pairs = 0; for (const c of a.counts) pairs += Math.floor(c / 2);
      best = Math.max(best, Math.min(14, pairs * 2 + w * 1.6) - 1.5);
    }
    if (C.grand.enabled || C.triples.enabled) {
      const cov = maxCoverage(a.counts.slice(), w, { highAce: cfg.highAce, allowFourSets: true }, 'sets');
      best = Math.max(best, cov - 1);
    }
    if (C.color.enabled && level === 'hard') {
      const byColor = [0, 0, 0, 0];
      for (const id of hand) { const e = C.color.allowJokers ? effective(id, j) : natural(id, j); if (e) byColor[e.color]++; }
      const jw = C.color.allowJokers ? w : 0;
      const top = Math.max(...byColor) + jw;
      // Colour needs 14 same-colour tiles; only worth chasing when already dominant.
      if (top >= 9) best = Math.max(best, top - 0.5);
    }
  }
  return best;
}

function connections(counts: number[]): number {
  let n = 0;
  for (let c = 0; c < 4; c++) for (let k = 0; k < 13; k++) {
    if (!counts[c * 13 + k]) continue;
    if (k + 1 < 13 && counts[c * 13 + k + 1]) n++;
    else if (k + 2 < 13 && counts[c * 13 + k + 2]) n += 0.6;
    for (let c2 = c + 1; c2 < 4; c2++) if (counts[c2 * 13 + k]) n += 0.8;
  }
  return n;
}

function bestDiscard(hand: number[], j: JokerInfo, cfg: RoomConfig, level: Level, rng: Rng): { tile: number; value: number } {
  const seen = new Set<number>();
  const scored: { tile: number; value: number }[] = [];
  for (const t of hand) {
    // identical faces give identical outcomes: evaluate once per face
    const e = effective(t, j);
    const key = e ? cell(e.color, e.num) : -1 - (isRealJoker(t, j) ? 0 : 1);
    if (seen.has(key)) continue; seen.add(key);
    let v = handProgress(hand.filter((x) => x !== t), j, cfg, level);
    if (isRealJoker(t, j)) v -= 5; // keep jokers
    scored.push({ tile: t, value: v });
  }
  scored.sort((x, y) => y.value - x.value);
  if (level === 'easy' && scored.length > 3 && rng(100) < 30) return scored[rng(3)];
  if (level === 'medium' && scored.length > 2 && rng(100) < 8) return scored[1];
  return scored[0];
}

export function findClose(view: GameView, cfg: RoomConfig): { tile: number; category: CategoryKey; penalty: number } | null {
  const me = view.me!;
  if (me.hand.length !== 15) return null;
  let best: { tile: number; category: CategoryKey; penalty: number } | null = null;
  const mustJoker = passActivatorMustJoker(cfg, view.pass.by, me.seat);
  for (const t of me.hand) {
    const jd = isRealJoker(t, view.joker);
    if (jd && !cfg.closeByJokerDiscard) continue;
    if (mustJoker && !jd) continue;
    const rest = me.hand.filter((x) => x !== t);
    const w = chooseWin(detectWins(rest, view.joker, cfg), jd, rest, view.joker, cfg);
    if (w && (!best || w.penalty > best.penalty)) best = { tile: t, category: w.category, penalty: w.penalty };
  }
  return best;
}

export function decideDraw(view: GameView, cfg: RoomConfig, level: Level, rng: Rng): 'pile' | 'discard' {
  const me = view.me!;
  if (!me.canTakeDiscard) return 'pile';
  const top = view.discards[me.discardFrom].at(-1);
  if (top === undefined) return 'pile';
  if (isRealJoker(top, view.joker)) return 'discard';
  const now = handProgress(me.hand, view.joker, cfg, level);
  const withTop = me.hand.concat(top);
  const { value } = bestDiscard(withTop, view.joker, cfg, level, () => 0);
  const gain = value - now;
  const threshold = level === 'easy' ? 2 : level === 'medium' ? 0.9 : 0.7;
  if (level === 'easy' && rng(100) < 40) return 'pile';
  return gain >= threshold ? 'discard' : 'pile';
}

export function decideDiscard(view: GameView, cfg: RoomConfig, level: Level, rng: Rng): BotMove {
  const me = view.me!;
  const win = findClose(view, cfg);
  if (win) return { type: 'close', tile: win.tile, category: win.category };
  if (me.canPass && level !== 'easy') {
    const jokers = me.hand.filter((t) => isRealJoker(t, view.joker));
    const rest = me.hand.filter((t) => t !== jokers[0]);
    const prog = handProgress(rest, view.joker, cfg, level);
    if ((level === 'hard' && prog >= 9) || (level === 'medium' && rng(100) < 50)) return { type: 'pass', tile: jokers[0] };
  }
  return { type: 'discard', tile: bestDiscard(me.hand, view.joker, cfg, level, rng).tile };
}

export function shouldDeclareAtu(view: GameView): boolean {
  return !!view.me?.canAtu;
}

export function thinkDelay(level: Level, rng: Rng): number {
  const base = level === 'hard' ? 900 : level === 'medium' ? 700 : 500;
  return base + rng(1300);
}

export { analyse };
