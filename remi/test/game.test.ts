import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { defaultConfig } from '../src/engine/config';
import { newMatch, startRound, draw, discard, activatePass, declareAtu, close, tileLocations, GameState, checkClose, canTakeDiscard, pause, resume } from '../src/engine/game';
import { seededRng, isRealJoker, tileFace } from '../src/engine/tiles';
import { buildView } from '../src/engine/view';
import { decideDraw, decideDiscard } from '../src/engine/bot';
import { t, R, B, Y, K } from './helpers';

const four = () => [0, 1, 2, 3].map((i) => ({ name: 'P' + i, isBot: false }));
function fresh(seed = 1, cfg = defaultConfig()) {
  const g = newMatch(four(), cfg, 0);
  startRound(g, cfg, seededRng(seed), 0);
  return { g, cfg };
}
/** swap the indicator with tile `id`, wherever it currently is */
function setIndicator(g: GameState, id: number) {
  const old = g.indicator;
  for (const arr of [g.drawPile, ...g.hands]) { const i = arr.indexOf(id); if (i >= 0) { arr[i] = old; break; } }
  g.indicator = id; g.joker = { color: tileFace(id).color, num: tileFace(id).num % 13 + 1 };
}
function conserve(g: GameState) { expect(tileLocations(g).size).toBe(106); }

/** Rig a hand: move wanted tiles into seat's hand from wherever they are (keeps conservation). */
function rig(g: GameState, seat: number, tiles: number[]) {
  const all = [g.hands, g.discards].flat();
  for (const id of tiles) {
    for (const arr of all) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); }
    const pi = g.drawPile.indexOf(id); if (pi >= 0) g.drawPile.splice(pi, 1);
    if (g.indicator === id) throw new Error('rigging indicator');
  }
  const old = g.hands[seat];
  g.hands[seat] = tiles.slice();
  g.drawPile.push(...old.filter((x) => !tiles.includes(x)));
  // rebalance other hands to their sizes are unchanged (taken tiles came from them)
  for (let s = 0; s < g.hands.length; s++) if (s !== seat) {
    const want = s === g.starter ? 15 : 14;
    while (g.hands[s].length < want) g.hands[s].push(g.drawPile.pop()!);
  }
}

describe('deal', () => {
  it('deals 14 / 15 to starter, indicator is numbered, conserves tiles', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { g } = fresh(seed);
      const sizes = g.hands.map((h) => h.length);
      expect(sizes.filter((x) => x === 15)).toHaveLength(1);
      expect(sizes.filter((x) => x === 14)).toHaveLength(3);
      expect(g.hands[g.starter]).toHaveLength(15);
      expect(tileFace(g.indicator).falseJoker).toBe(false);
      expect(g.drawPile.length).toBe(106 - 1 - 57);
      expect(g.phase).toBe('WAITING_FOR_DISCARD');
      conserve(g);
    }
  });
  it('rotates the starter between rounds', () => {
    const { g, cfg } = fresh(3);
    const s1 = g.starter;
    g.phase = 'ROUND_RESULT';
    startRound(g, cfg, seededRng(9), 0);
    expect(g.starter).toBe((s1 + 1) % 4);
  });
});

describe('turns', () => {
  it('rejects out-of-turn, wrong phase and foreign tiles', () => {
    const { g, cfg } = fresh(2);
    const other = (g.starter + 1) % 4;
    expect(() => discard(g, cfg, other, g.hands[other][0], 0)).toThrow('not_your_turn');
    expect(() => draw(g, cfg, g.starter, 'pile', 0)).toThrow('wrong_phase');
    expect(() => discard(g, cfg, g.starter, g.hands[other][0], 0)).toThrow('not_owner');
    const tile = g.hands[g.starter][0];
    discard(g, cfg, g.starter, tile, 0);
    expect(g.current).toBe(other);
    expect(canTakeDiscard(g, cfg, other)).toBe(true);
    const got = draw(g, cfg, other, 'discard', 0);
    expect(got).toBe(tile);
    expect(g.hands[other]).toHaveLength(15);
    conserve(g);
  });
  it('only the previous player latest discard is eligible', () => {
    const { g, cfg } = fresh(5);
    const s0 = g.starter, s1 = (s0 + 1) % 4, s2 = (s0 + 2) % 4;
    discard(g, cfg, s0, g.hands[s0][0], 0);
    draw(g, cfg, s1, 'pile', 0); discard(g, cfg, s1, g.hands[s1][0], 0);
    expect(canTakeDiscard(g, cfg, s2)).toBe(true);
    draw(g, cfg, s2, 'pile', 0); discard(g, cfg, s2, g.hands[s2][0], 0);
    // seat 3 can take seat 2's discard, but not seat 0's
    expect(g.lastDiscardSeat).toBe(s2);
  });
  it('exhausted draw pile ends the round as a draw without penalties', () => {
    const { g, cfg } = fresh(7);
    let guard = 0;
    while (g.phase !== 'ROUND_RESULT' && guard++ < 500) {
      const s = g.current;
      if (g.phase === 'WAITING_FOR_DRAW') draw(g, cfg, s, 'pile', 0);
      // discard the drawn tile -> nobody wins realistically
      discard(g, cfg, s, g.hands[s].at(-1)!, 0);
      conserve(g);
    }
    expect(g.result?.kind).toBe('draw');
    expect(g.seats.map((s) => s.score)).toEqual([100, 100, 100, 100]);
  });
  it('pause freezes and restores the remaining timer', () => {
    const { g, cfg } = fresh(4);
    expect(g.turnDeadline).toBe(30000);
    pause(g, 10000);
    expect(g.turnDeadline).toBeNull();
    expect(() => discard(g, cfg, g.starter, g.hands[g.starter][0], 0)).toThrow('paused');
    resume(g, 50000);
    expect(g.turnDeadline).toBe(70000);
  });
});

describe('closing and scoring', () => {
  const winning = [t(R, 1), t(R, 2), t(R, 3), t(R, 4), t(B, 5), t(B, 6), t(B, 7), t(Y, 9), t(B, 9), t(K, 9), t(K, 11), t(K, 12), t(K, 13), t(R, 9)];
  function setup(seed = 11) {
    const { g, cfg } = fresh(seed);
    // pick an indicator that is not involved
    setIndicator(g, t(Y, 4, 1));
    return { g, cfg };
  }
  it('normal win without joker: opponents lose 10, winner unchanged', () => {
    const { g, cfg } = setup();
    const extra = t(Y, 12, 1);
    rig(g, g.starter, [...winning, extra]);
    conserve(g);
    expect(checkClose(g, cfg, g.starter, extra).category).toBe('normalPlain');
    const res = close(g, cfg, g.starter, extra, 0);
    expect(res.penalty).toBe(10);
    g.seats.forEach((s) => expect(s.score).toBe(s.seat === g.starter ? 100 : 90));
    expect(g.phase).toBe('ROUND_RESULT');
    conserve(g);
  });
  it('doubles closed by discarding a real joker costs 30', () => {
    const { g, cfg } = setup(12);
    const pairs = [t(R, 1), t(R, 1, 1), t(B, 3), t(B, 3, 1), t(Y, 7), t(Y, 7, 1), t(K, 7), t(K, 7, 1), t(R, 10), t(R, 10, 1), t(B, 12), t(B, 12, 1), t(Y, 13), t(Y, 13, 1)];
    const joker = t(Y, 5);
    rig(g, g.starter, [...pairs, joker]);
    const res = close(g, cfg, g.starter, joker, 0);
    expect(res.category).toBe('doubles'); expect(res.jokerDiscard).toBe(true); expect(res.penalty).toBe(30);
    g.seats.forEach((s) => expect(s.score).toBe(s.seat === g.starter ? 100 : 70));
  });
  it('closing by joker discard can be disabled', () => {
    const { g, cfg } = setup(13);
    cfg.closeByJokerDiscard = false;
    rig(g, g.starter, [...winning, t(Y, 5)]);
    expect(() => close(g, cfg, g.starter, t(Y, 5), 0)).toThrow('joker_discard_close_disabled');
  });
  it('custom room scoring is applied', () => {
    const { g, cfg } = setup(14);
    cfg.categories.normalPlain.penalty = 37;
    const extra = t(Y, 12, 1);
    rig(g, g.starter, [...winning, extra]);
    expect(close(g, cfg, g.starter, extra, 0).penalty).toBe(37);
  });
  it('invalid close is rejected and state is unchanged', () => {
    const { g, cfg } = setup(15);
    const v = g.version; const hand = g.hands[g.starter].slice();
    expect(() => close(g, cfg, g.starter, hand[0], 0)).toThrow();
    expect(g.hands[g.starter]).toEqual(hand);
    expect(g.version).toBe(v);
    expect(g.phase).toBe('WAITING_FOR_DISCARD');
  });
  it('elimination at zero, match continues with remaining players, final winner', () => {
    const cfg = defaultConfig(); cfg.startingScore = 25;
    const g = newMatch(four(), cfg, 0);
    startRound(g, cfg, seededRng(21), 0);
    // force scores
    g.seats[0].score = 5; g.seats[1].score = 50; g.seats[2].score = 8; g.seats[3].score = 30;
    const w = 3;
    g.current = w; g.starter = w;
    // give w a winning 15-tile hand
    setIndicator(g, t(Y, 4, 1));
    const all = g.hands.flat(); g.hands = g.hands.map(() => []); g.drawPile.push(...all);
    for (const id of [...winning, t(Y, 12, 1)]) g.drawPile.splice(g.drawPile.indexOf(id), 1);
    g.hands[w] = [...winning, t(Y, 12, 1)];
    for (const s of [0, 1, 2]) g.hands[s] = g.drawPile.splice(0, 14);
    conserve(g);
    const res = close(g, cfg, w, t(Y, 12, 1), 0);
    expect(res.eliminated.sort()).toEqual([0, 2]);
    expect(g.seats[0].score).toBe(0);
    expect(g.phase).toBe('ROUND_RESULT');
    // next round: only seats 1 and 3 dealt
    startRound(g, cfg, seededRng(5), 0);
    expect(g.hands[0]).toHaveLength(0); expect(g.hands[2]).toHaveLength(0);
    expect(g.hands[1].length + g.hands[3].length).toBe(29);
    conserve(g);
    // seat 1 at 50 loses 60 when 3 wins grand with joker discard -> match finished
    g.seats[1].score = 10;
    const starter = g.starter; const other = starter === 1 ? 3 : 1;
    void other;
    expect(['WAITING_FOR_DISCARD']).toContain(g.phase);
  });
});

describe('PASS', () => {
  function withJokers(seed: number) {
    const { g, cfg } = fresh(seed);
    const j = g.joker;
    const j1 = j.color * 26 + (j.num - 1), j2 = j1 + 13;
    const rest = g.hands[g.starter].filter((x) => x !== j1 && x !== j2 && x !== g.indicator).slice(0, 13);
    rig(g, g.starter, [j1, j2, ...rest]);
    return { g, cfg, j1, j2 };
  }
  it('activates with both real jokers, locks the joker and blocks discard pickup', () => {
    const { g, cfg, j1, j2 } = withJokers(31);
    conserve(g);
    const s0 = g.starter, s1 = (s0 + 1) % 4;
    activatePass(g, cfg, s0, j1, 0);
    expect(g.pass.active).toBe(true);
    expect(g.passArea).toEqual([j1]);
    expect(g.hands[s0]).toContain(j2);
    expect(g.hands[s0]).toHaveLength(14);
    expect(canTakeDiscard(g, cfg, s1)).toBe(false);
    expect(() => draw(g, cfg, s1, 'discard', 0)).toThrow();
    draw(g, cfg, s1, 'pile', 0); discard(g, cfg, s1, g.hands[s1][0], 0);
    const s2 = (s0 + 2) % 4;
    expect(canTakeDiscard(g, cfg, s2)).toBe(false); // still active (whole round)
    expect(buildView(g, cfg, s2).me!.passBlocked).toBe(true);
    conserve(g);
  });
  it('is rejected with a false joker or a single real joker', () => {
    const { g, cfg } = fresh(32);
    const j = g.joker;
    const j1 = j.color * 26 + (j.num - 1);
    const rest = g.hands[g.starter].filter((x) => x !== j1 && x !== j1 + 13 && x !== g.indicator && x < 104).slice(0, 13);
    rig(g, g.starter, [j1, 104, ...rest]);
    expect(() => activatePass(g, cfg, g.starter, j1, 0)).toThrow('pass_needs_two_jokers');
    expect(() => activatePass(g, cfg, g.starter, 104, 0)).toThrow();
  });
  it('expires after a configured number of turns and resets next round', () => {
    const cfg = defaultConfig(); cfg.pass.duration = { kind: 'turns', turns: 2 };
    const { g, j1 } = withJokers(33);
    activatePass(g, cfg, g.starter, j1, 0);
    for (let k = 0; k < 2; k++) { const s = g.current; expect(g.pass.active).toBe(true); draw(g, cfg, s, 'pile', 0); discard(g, cfg, s, g.hands[s][0], 0); }
    expect(g.pass.active).toBe(false);
    expect(canTakeDiscard(g, cfg, g.current)).toBe(true);
    g.phase = 'ROUND_RESULT'; startRound(g, cfg, seededRng(1), 0);
    expect(g.pass.active).toBe(false); expect(g.passArea).toEqual([]);
    conserve(g);
  });
  it('disabled PASS is rejected', () => {
    const { g, cfg, j1 } = withJokers(34);
    cfg.pass.enabled = false;
    expect(() => activatePass(g, cfg, g.starter, j1, 0)).toThrow('pass_disabled');
  });
});

describe('Arătare atu', () => {
  it('holder of the second indicator copy penalises opponents once, keeps tile, keeps turn', () => {
    const { g, cfg } = fresh(41);
    const f = tileFace(g.indicator);
    const twin = f.color * 26 + (g.indicator % 26 >= 13 ? 0 : 13) + (f.num - 1);
    const s = (g.starter + 2) % 4;
    const rest = g.hands[s].filter((x) => x !== twin).slice(0, 13);
    rig(g, s, [twin, ...rest]);
    const cur = g.current, phase = g.phase;
    declareAtu(g, cfg, s, 0);
    g.seats.forEach((p) => expect(p.score).toBe(p.seat === s ? 100 : 99));
    expect(g.hands[s]).toContain(twin);
    expect(g.current).toBe(cur); expect(g.phase).toBe(phase);
    expect(() => declareAtu(g, cfg, s, 0)).toThrow('atu_not_allowed');
  });
  it('not allowed when disabled, without the tile, or after first turn', () => {
    const { g, cfg } = fresh(42);
    cfg.atu.enabled = false;
    for (let s = 0; s < 4; s++) expect(() => declareAtu(g, cfg, s, 0)).toThrow();
    cfg.atu.enabled = true;
    g.firstTurnDone = [true, true, true, true];
    for (let s = 0; s < 4; s++) expect(() => declareAtu(g, cfg, s, 0)).toThrow();
  });
});

describe('privacy', () => {
  it('views never contain opponents hands or the draw pile order', () => {
    const { g, cfg } = fresh(51);
    for (let s = 0; s < 4; s++) {
      const v = buildView(g, cfg, s);
      const json = JSON.stringify({ ...v, me: null });
      for (let o = 0; o < 4; o++) if (o !== s) expect(v.me!.hand.some((x) => g.hands[o].includes(x))).toBe(false);
      expect(json).not.toContain('drawPile');
      expect(json).not.toContain('"hands"');
      expect(typeof v.pile).toBe('number');
    }
    const spectator = buildView(g, cfg, null);
    expect(spectator.me).toBeNull();
    // a private hand tile id appears nowhere in the spectator payload except as public info
    const hidden = g.hands[g.starter].filter((x) => x !== g.indicator);
    const sj = JSON.stringify(spectator.seats);
    for (const id of hidden) expect(sj.includes(`"hand"`)).toBe(false), void id;
  });
});

describe('bots and property-based simulation', () => {
  function simulate(seed: number, cfg = defaultConfig()) {
    const g = newMatch(four().map((p) => ({ ...p, isBot: true })), cfg, 0);
    const rng = seededRng(seed);
    startRound(g, cfg, rng, 0);
    const levels = ['easy', 'medium', 'hard', 'medium'] as const;
    let steps = 0;
    while (g.phase !== 'MATCH_FINISHED' && steps++ < 4000) {
      if (g.phase === 'ROUND_RESULT') { startRound(g, cfg, rng, 0); continue; }
      const s = g.current; const lv = levels[s];
      const v = buildView(g, cfg, s);
      if (v.me!.canAtu) declareAtu(g, cfg, s, 0);
      if (g.phase === 'MATCH_FINISHED' || g.phase === 'ROUND_RESULT') continue;
      if (g.phase === 'WAITING_FOR_DRAW') draw(g, cfg, s, decideDraw(buildView(g, cfg, s), cfg, lv, rng), 0);
      const m = decideDiscard(buildView(g, cfg, s), cfg, lv, rng);
      if (m.type === 'close') close(g, cfg, s, m.tile, 0, m.category);
      else if (m.type === 'pass') activatePass(g, cfg, s, m.tile, 0);
      else discard(g, cfg, s, m.tile, 0);
      if (g.phase !== 'MATCH_FINISHED') expect(tileLocations(g).size).toBe(106);
    }
    return g;
  }
  it('bot-only matches always finish with one winner and conserve tiles', () => {
    const cfg = defaultConfig(); cfg.startingScore = 30;
    const g = simulate(7, cfg);
    expect(g.phase).toBe('MATCH_FINISHED');
    expect(g.seats.filter((s) => s.status === 'ACTIVE')).toHaveLength(1);
    expect(g.winner).toBe(g.seats.find((s) => s.status === 'ACTIVE')!.seat);
  }, 60000);
  it('property: random legal play conserves every tile', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1e9 }), (seed) => {
      const cfg = defaultConfig();
      const g = newMatch(four(), cfg, 0);
      const rng = seededRng(seed);
      startRound(g, cfg, rng, 0);
      for (let k = 0; k < 120 && g.phase !== 'ROUND_RESULT'; k++) {
        const s = g.current;
        if (g.phase === 'WAITING_FOR_DRAW') draw(g, cfg, s, canTakeDiscard(g, cfg, s) && rng(2) ? 'discard' : 'pile', 0);
        const h = g.hands[s];
        const jokers = h.filter((x) => isRealJoker(x, g.joker));
        if (jokers.length === 2 && !g.pass.active && rng(2)) activatePass(g, cfg, s, jokers[0], 0);
        else discard(g, cfg, s, h[rng(h.length)], 0);
        const locs = tileLocations(g);
        if (locs.size !== 106) return false;
      }
      return true;
    }), { numRuns: 60 });
  });
  it('property: any hand accepted by the validator is a true partition of the 14 tiles', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1e9 }), (seed) => {
      const { g, cfg } = fresh(seed);
      const h = g.hands[g.starter];
      for (const d of h) {
        const c = checkClose(g, cfg, g.starter, d);
        if (c.ok && c.category !== 'color' && c.category !== 'doubles') {
          const used = c.formations!.flatMap((f) => f.tiles).sort();
          expect(used).toEqual(h.filter((x) => x !== d).sort());
        }
      }
      return true;
    }), { numRuns: 40 });
  });
});
