import { describe, it, expect } from 'vitest';
import { allTileIds, tileFace, jokerFromIndicator, isRealJoker, effective, TILE_COUNT } from '../src/engine/tiles';
import { defaultConfig, CATEGORY_KEYS } from '../src/engine/config';
import { detectWins, chooseWin, checkColor, checkDoubles } from '../src/engine/validator';
import { t, R, B, Y, K, FJ } from './helpers';

const J = (c: number, n: number) => ({ color: c as any, num: n }); // joker
const cats = (hand: number[], j = J(R, 8), cfg = defaultConfig()) => detectWins(hand, j, cfg).map((m) => m.category).sort();

describe('tile set', () => {
  it('has exactly 106 unique physical tiles', () => {
    const ids = allTileIds();
    expect(ids.length).toBe(106); expect(TILE_COUNT).toBe(106);
    const faces = ids.map(tileFace);
    expect(faces.filter((f) => f.falseJoker).length).toBe(2);
    for (let c = 0; c < 4; c++) for (let n = 1; n <= 13; n++)
      expect(faces.filter((f) => !f.falseJoker && f.color === c && f.num === n).length).toBe(2);
  });
  it('joker is next number of same colour, 13 wraps to 1', () => {
    expect(jokerFromIndicator(t(R, 7))).toEqual({ color: R, num: 8 });
    expect(jokerFromIndicator(t(B, 12))).toEqual({ color: B, num: 13 });
    expect(jokerFromIndicator(t(K, 13, 1))).toEqual({ color: K, num: 1 });
    expect(jokerFromIndicator(t(Y, 1))).toEqual({ color: Y, num: 2 });
    expect(() => jokerFromIndicator(104)).toThrow();
  });
  it('both physical copies are real jokers; false jokers are not', () => {
    const j = J(R, 8);
    expect(isRealJoker(t(R, 8, 0), j)).toBe(true);
    expect(isRealJoker(t(R, 8, 1), j)).toBe(true);
    expect(isRealJoker(104, j)).toBe(false);
    expect(effective(104, j)).toEqual({ color: R, num: 8 });
    expect(effective(t(R, 8), j)).toBeNull();
  });
});

describe('normal hands', () => {
  // r1-r4, b5-b7, y9 b9 k9, k11 k12 k13 + r13? -> build 14
  const plain = [t(R, 1), t(R, 2), t(R, 3), t(R, 4), t(B, 5), t(B, 6), t(B, 7), t(Y, 9), t(B, 9), t(K, 9), t(K, 11), t(K, 12), t(K, 13), t(R, 9)];
  it('normal without joker (4-tile set)', () => {
    expect(cats(plain)).toEqual(['normalPlain']);
  });
  it('invalid when one tile breaks the hand', () => {
    const h = plain.slice(); h[13] = t(Y, 4);
    expect(cats(h)).toEqual([]);
  });
  it('rejects duplicate colour in a set', () => {
    const h = [t(R, 9), t(R, 9, 1), t(B, 9), t(R, 1), t(R, 2), t(R, 3), t(B, 5), t(B, 6), t(B, 7), t(K, 11), t(K, 12), t(K, 13), t(Y, 2), t(Y, 3)];
    expect(cats(h)).toEqual([]);
  });
  it('joker-assisted sequence -> normalJoker', () => {
    const h = plain.slice(); h[1] = t(R, 8); // red 8 joker replaces red 2
    expect(cats(h)).toEqual(['normalJoker']);
    const m = detectWins(h, J(R, 8), defaultConfig())[0];
    const js = m.formations.flatMap((f) => f.jokers);
    expect(js).toHaveLength(1);
  });
  it('high ace 12-13-1 valid by default, 13-1-2 never', () => {
    const v2 = [t(B, 5), t(B, 6), t(B, 7), t(Y, 9), t(B, 9), t(K, 9), t(R, 2), t(R, 3), t(R, 4), t(R, 5), t(R, 6), t(K, 12), t(K, 13), t(K, 1)];
    expect(cats(v2)).toEqual(['normalPlain']);
    const cfg = defaultConfig(); cfg.highAce = false;
    expect(cats(v2, J(R, 8), cfg)).toEqual([]);
    const wrap = [t(B, 5), t(B, 6), t(B, 7), t(Y, 9), t(B, 9), t(K, 9), t(R, 2), t(R, 3), t(R, 4), t(R, 5), t(R, 6), t(K, 13), t(K, 1), t(K, 2)];
    expect(cats(wrap)).toEqual([]);
  });
  it('false joker acts as the joker value, not a wildcard', () => {
    // joker = red 8 -> false joker is a natural red 8: r6 r7 FJ r9 is a run
    const ok = [t(R, 6), t(R, 7), FJ[0], t(R, 9), t(B, 5), t(B, 6), t(B, 7), t(Y, 9), t(B, 9), t(K, 9), t(K, 11), t(K, 12), t(K, 13), t(K, 10)];
    expect(cats(ok)).toEqual(['normalPlain']);
    const bad = ok.slice(); bad[3] = FJ[1]; // r6 r7 r8 r8 is not a run
    expect(cats(bad)).toEqual([]);
  });
  it('ambiguous partition requiring non-greedy search', () => {
    // greedy r2..r8 run would strand b5 y5; the valid split is r2-r4, {r5 b5 y5}, r6-r8
    const j = J(K, 2);
    const h = [t(R, 2), t(R, 3), t(R, 4), t(R, 5), t(R, 6), t(R, 7), t(R, 8), t(B, 5), t(Y, 5), t(B, 10), t(B, 11), t(B, 12), t(B, 13), t(B, 9)];
    expect(cats(h, j)).toEqual(['normalPlain']);
    const lonely = h.slice(); lonely[13] = t(Y, 13);
    expect(cats(lonely, j)).toEqual([]);
  });
});

describe('special categories', () => {
  it('seven pairs -> doubles (and joker-assisted pair)', () => {
    const h = [t(R, 1), t(R, 1, 1), t(B, 3), t(B, 3, 1), t(Y, 5), t(Y, 5, 1), t(K, 7), t(K, 7, 1), t(R, 10), t(R, 10, 1), t(B, 12), t(B, 12, 1), t(Y, 13), t(Y, 13, 1)];
    expect(cats(h)).toEqual(['doubles']);
    const hj = h.slice(); hj[13] = t(R, 8); // joker pairs with y13
    expect(cats(hj)).toEqual(['doubles']);
  });
  it('two jokers as one pair is configurable', () => {
    const h = [t(R, 1), t(R, 1, 1), t(B, 3), t(B, 3, 1), t(Y, 5), t(Y, 5, 1), t(K, 7), t(K, 7, 1), t(R, 10), t(R, 10, 1), t(B, 12), t(B, 12, 1), t(R, 8), t(R, 8, 1)];
    expect(cats(h)).toContain('doubles');
    const cfg = defaultConfig(); cfg.doubleJokerPair = false;
    expect(checkDoubles(h, J(R, 8), true, false)).toBeNull();
    expect(cats(h, J(R, 8), cfg)).not.toContain('doubles');
  });
  it('sequences only', () => {
    const h = [t(R, 1), t(R, 2), t(R, 3), t(B, 4), t(B, 5), t(B, 6), t(B, 7), t(Y, 9), t(Y, 10), t(Y, 11), t(K, 11), t(K, 12), t(K, 13), t(K, 1)];
    expect(cats(h)).toEqual(['normalPlain', 'sequences']);
  });
  it('grand and triples overlap; grand prioritised by penalty', () => {
    const h = [t(R, 1), t(B, 1), t(Y, 1), t(R, 5), t(B, 5), t(K, 5), t(Y, 9), t(B, 9), t(K, 9), t(R, 9), t(R, 12), t(B, 12), t(Y, 12), t(K, 12)];
    expect(cats(h)).toEqual(['grand', 'normalPlain', 'triples']);
    const cfg = defaultConfig();
    const ws = detectWins(h, J(R, 8), cfg);
    expect(chooseWin(ws, false, h, J(R, 8), cfg)!.category).toBe('grand');
    expect(chooseWin(ws, false, h, J(R, 8), cfg)!.penalty).toBe(30);
    expect(chooseWin(ws, true, h, J(R, 8), cfg)!.penalty).toBe(60);
    cfg.categories.grand.enabled = false;
    const w2 = chooseWin(detectWins(h, J(R, 8), cfg), false, h, J(R, 8), cfg)!;
    expect(w2.category).toBe('triples'); expect(w2.penalty).toBe(10);
  });
  it('joker-assisted grand', () => {
    const h = [t(R, 1), t(B, 1), t(R, 8), t(R, 5), t(B, 5), t(K, 5), t(Y, 9), t(B, 9), t(K, 9), t(R, 9), t(R, 12), t(B, 12), t(Y, 12), t(K, 12)];
    expect(cats(h)).toContain('grand');
  });
  it('custom priority order overrides highest-penalty selection', () => {
    const h = [t(R, 1), t(B, 1), t(Y, 1), t(R, 5), t(B, 5), t(K, 5), t(Y, 9), t(B, 9), t(K, 9), t(R, 9), t(R, 12), t(B, 12), t(Y, 12), t(K, 12)];
    const cfg = defaultConfig(); cfg.priority = ['normalPlain', 'grand'];
    expect(chooseWin(detectWins(h, J(R, 8), cfg), false, h, J(R, 8), cfg)!.category).toBe('normalPlain');
  });
});

describe('Color (Culoare) — independent of formations', () => {
  const j = J(K, 4);
  it('unordered same-colour tiles with duplicates win without any formation', () => {
    const h = [t(B, 1), t(B, 1, 1), t(B, 4), t(B, 9), t(B, 2), t(B, 13), t(B, 13, 1), t(B, 7), t(B, 11), t(B, 3), t(B, 6), t(B, 6, 1), t(B, 10), t(B, 5)];
    expect(cats(h, j)).toEqual(['color']);
  });
  it('joker-assisted colour (two real jokers of another colour)', () => {
    const h = [t(B, 1), t(B, 1, 1), t(B, 4), t(B, 9), t(B, 2), t(B, 13), t(B, 13, 1), t(B, 7), t(B, 11), t(B, 3), t(B, 6), t(B, 6, 1), t(K, 4), t(K, 4, 1)];
    expect(cats(h, j)).toContain('color');
    const cfg = defaultConfig(); cfg.categories.color.allowJokers = false;
    expect(cats(h, j, cfg)).not.toContain('color');
  });
  it('false joker counts as the joker colour', () => {
    const h = [t(K, 1), t(K, 2), t(K, 9), t(K, 9, 1), t(K, 11), t(K, 12), t(K, 13), t(K, 3), t(K, 5), t(K, 6), t(K, 7), t(K, 8), t(K, 10), FJ[0]];
    expect(checkColor(h, j, true)).not.toBeNull();
    const h2 = h.slice(); h2[13] = t(B, 4);
    expect(checkColor(h2, j, true)).toBeNull();
  });
  it('mixed colour hands are invalid', () => {
    const h = [t(B, 1), t(B, 1, 1), t(B, 4), t(B, 9), t(B, 2), t(B, 13), t(B, 13, 1), t(B, 7), t(B, 11), t(B, 3), t(B, 6), t(B, 6, 1), t(B, 10), t(R, 5)];
    expect(cats(h, j)).toEqual([]);
  });
  it('disabled category is never claimed', () => {
    const h = [t(B, 1), t(B, 1, 1), t(B, 4), t(B, 9), t(B, 2), t(B, 13), t(B, 13, 1), t(B, 7), t(B, 11), t(B, 3), t(B, 6), t(B, 6, 1), t(B, 10), t(B, 5)];
    const cfg = defaultConfig(); cfg.categories.color.enabled = false;
    expect(cats(h, j, cfg)).toEqual([]);
  });
});

describe('config', () => {
  it('every category enabled by default with independent penalties', () => {
    const c = defaultConfig();
    for (const k of CATEGORY_KEYS) expect(c.categories[k].enabled).toBe(true);
    expect([c.categories.normalJoker.penalty, c.categories.normalPlain.penalty, c.categories.sequences.penalty, c.categories.triples.penalty,
      c.categories.doubles.penalty, c.categories.color.penalty, c.categories.grand.penalty]).toEqual([5, 10, 10, 10, 15, 15, 30]);
    expect([c.categories.doubles.jokerPenalty, c.categories.color.jokerPenalty, c.categories.grand.jokerPenalty]).toEqual([30, 30, 60]);
  });
});
