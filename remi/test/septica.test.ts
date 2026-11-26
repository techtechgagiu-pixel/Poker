import { describe, it, expect } from 'vitest';
import { newSeptica, playCard, passTurn, legalCards, cardRank, isPointCard, autoMove, septicaView, septicaBot, defaultSepticaOpts, SepticaState } from '../src/engine/septica';
import { secureRng } from '../src/engine/tiles';

const mk = (n: 2 | 3 | 4, teams = false) =>
  newSeptica(Array.from({ length: n }, (_, i) => ({ name: 'P' + i, isBot: false })), { ...defaultSepticaOpts(), players: n, teams }, 30, secureRng, 0);

describe('Septică engine', () => {
  it('deals 4 cards each from a 32-card deck, no duplicates', () => {
    for (const n of [2, 3, 4] as const) {
      const g = mk(n);
      expect(g.hands.every((h) => h.length === 4)).toBe(true);
      const all = [...g.hands.flat(), ...g.stock];
      expect(new Set(all).size).toBe(32);
      expect(all.length).toBe(32);
    }
  });
  it('same rank or any 7 answers; others rejected', () => {
    const g = mk(2);
    const lead = g.current, other = (lead + 1) % 2;
    g.hands[lead] = [8, 1, 2, 3]; // card 8 = rank 7? (id%8==0 -> 7)
    g.hands[lead] = [1, 9, 17, 25]; // rank 8 in four suits
    g.hands[other] = [2, 0, 4, 5]; // 9, 7, 11(J), Q
    playCard(g, lead, 1, 0);
    expect(legalCards(g, other).sort()).toEqual([0]); // only the 7
    expect(() => playCard(g, other, 2, 0)).toThrow();
    playCard(g, other, 0, 0);
    expect(g.rank).toBe(8);
  });
  it('first pass ends the trick; last player to play takes the pile', () => {
    const g = mk(3);
    const a = g.current, b = (a + 1) % 3, c = (a + 2) % 3;
    g.hands[a] = [1, 2, 3, 4]; g.hands[b] = [9, 10, 11, 12]; g.hands[c] = [5, 6, 7, 13];
    playCard(g, a, 1, 0); // rank 8
    playCard(g, b, 9, 0); // answer with 8
    // c has no 8 and no 7 (ids 5,6,7,13 are ranks J,Q,K ... 13 = suit1 rank J) -> forced pass: b takes
    expect(g.taken[b].length).toBe(2);
    expect(g.current).toBe(b);
    expect(g.table.length).toBe(0);
  });
  it('draws back to 4 and ends with consistent totals', () => {
    for (const n of [2, 3, 4] as const) for (let t = 0; t < 30; t++) {
      const g = mk(n);
      let guard = 0;
      while (g.phase !== 'MATCH_FINISHED' && guard++ < 2000) {
        const v = septicaView(g, g.current);
        const mv = septicaBot(v, 'medium', secureRng);
        if (mv.type === 'play') playCard(g, g.current, mv.card, 0); else passTurn(g, g.current, 0);
      }
      expect(g.phase).toBe('MATCH_FINISHED');
      const total = g.taken.reduce((a, t2) => a + t2.length, 0);
      expect(total).toBe(32);
      expect(g.result!.points.reduce((a, b) => a + b, 0)).toBe(8);
    }
  });
  it('autoMove never throws and always advances', () => {
    const g = mk(4);
    let guard = 0;
    while (g.phase !== 'MATCH_FINISHED' && guard++ < 2000) autoMove(g, g.current, 0);
    expect(g.phase).toBe('MATCH_FINISHED');
  });
  it('views never leak other hands or the stock', () => {
    const g = mk(3);
    const v = septicaView(g, 1);
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(g.stock));
    expect(v.me!.hand.sort()).toEqual(g.hands[1].slice().sort());
    expect(septicaView(g, null).me).toBeNull();
    expect((v as any).hands).toBeUndefined();
  });
  it('team scoring 2v2 sums partners', () => {
    const g = mk(4, true);
    let guard = 0;
    while (g.phase !== 'MATCH_FINISHED' && guard++ < 2000) autoMove(g, g.current, 0);
    expect(g.result!.teamPoints!.reduce((a, b) => a + b, 0)).toBe(8);
  });
  it('point cards are tens and aces', () => {
    expect([...Array(32).keys()].filter(isPointCard).length).toBe(8);
    expect(cardRank(0)).toBe(7);
  });
});
