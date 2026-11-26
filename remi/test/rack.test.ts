import { describe, it, expect } from 'vitest';
import { insertTiles, insertionIndex } from '../src/web/rackOps';
const row = (s: string) => s.split(',').map((x) => (x === '_' ? null : Number(x)));
const C = 8; // cols for tests

describe('rack insertion', () => {
  it('5 7 + 6 dropped on 7 becomes 5 6 7 (7 slides right into the gap)', () => {
    const l = row('_,5,7,_,_,_,_,_,9,_,_,_,_,_,_,_');
    expect(insertTiles(l, C, [6], 2)).toEqual(row('_,5,6,7,_,_,_,_,9,_,_,_,_,_,_,_'));
  });
  it('dragging a tile from the same row leaves no hole problems', () => {
    const l = row('6,5,7,_,_,_,_,_');
    expect(insertTiles(l, C, [6], 2)).toEqual(row('_,5,6,7,_,_,_,_'));
  });
  it('moving a tile right within its row lands between the intended neighbours', () => {
    // 5 6 7: drag 5 onto 7 -> between 6 and 7
    expect(insertTiles(row('_,5,6,7,_,_,_,_'), C, [5], 3)).toEqual(row('_,_,6,5,7,_,_,_'));
    // drag 5 after 7 (right half of 7 -> index 4)
    expect(insertTiles(row('_,5,6,7,_,_,_,_'), C, [5], 4)).toEqual(row('_,_,6,7,5,_,_,_'));
  });
  it('nearest gap wins: a gap on the left is used instead of pushing a long run right', () => {
    const l = row('_,1,2,3,4,5,6,_,_,_,_,_,_,_,_,_');
    // drop X between 1 and 2 (index 2): gap left is 1 step away (index 0 is 2 away; right gap at 7 is 5 away)
    const out = insertTiles(l.concat([]).map((x, i) => (i === 10 ? 9 : x)), 16, [9], 2);
    expect(out.slice(0, 8)).toEqual([1, 9, 2, 3, 4, 5, 6, null]);
  });
  it('no gap on the right: neighbours slide left', () => {
    const l = row('_,1,2,3,4,5,7,8');
    expect(insertTiles(l, C, [6], 6)).toEqual(row('1,2,3,4,5,6,7,8'));
  });
  it('empty slot: just place', () => {
    expect(insertTiles(row('1,_,3,_,_,_,_,_'), C, [2], 1)).toEqual(row('1,2,3,_,_,_,_,_'));
  });
  it('never crosses into the next row; a full row swaps and keeps every tile', () => {
    const l = row('1,2,3,4,5,6,7,8,_,_,_,_,_,_,_,_');
    const out = insertTiles(l.concat([]).map((x, i) => (i === 10 ? 9 : x)), 8, [9], 3);
    expect(out.slice(0, 8)).toEqual([1, 2, 3, 9, 5, 6, 7, 8]);
    expect(out.indexOf(4)).toBe(10); // 4 took the slot 9 came from
    expect(out.filter((x) => x !== null).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('multi-tile group inserted in order', () => {
    expect(insertTiles(row('3,7,_,_,_,_,_,_,4,5,6,_,_,_,_,_'), C, [4, 5, 6], 1)).toEqual(row('3,4,5,6,7,_,_,_,_,_,_,_,_,_,_,_'));
  });
  it('tile count is always preserved', () => {
    for (let t = 0; t < 300; t++) {
      const l = Array.from({ length: 16 }, () => (Math.random() < 0.6 ? 1 : null)).map((x, i) => (x ? i + 100 : null));
      const tiles = l.filter((x) => x !== null) as number[];
      if (!tiles.length) continue;
      const pick = tiles[Math.floor(Math.random() * tiles.length)];
      const out = insertTiles(l, C, [pick], Math.floor(Math.random() * 16));
      expect(out.filter((x) => x !== null).sort()).toEqual(tiles.sort());
    }
  });
  it('right half of a tile inserts after it', () => {
    const l = row('_,5,7,_,_,_,_,_');
    // tile width 60, gap 4 -> slot 1 spans x 64..124; right half x=110
    expect(insertionIndex(110, 10, 60, 80, 4, 10, C, 1, l)).toBe(2);
    expect(insertionIndex(70, 10, 60, 80, 4, 10, C, 1, l)).toBe(1);
  });
});

import { effective } from '../src/engine/tiles';
describe('joker stays hidden in arrangement', () => {
  it('with a joker that matches nothing, a real joker is an ordinary tile and a false joker sorts last', () => {
    const NO = { color: 9, num: 99 } as any;
    expect(effective(7, NO)).toEqual({ color: 0, num: 8 }); // red 8 stays red 8 even if it is the real joker
    expect(effective(104, NO)!.num).toBe(99);
  });
});
