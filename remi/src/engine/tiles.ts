/** Tile model: 106 physical tiles, each with a unique id 0..105. */
export type Color = 0 | 1 | 2 | 3; // 0 red, 1 blue, 2 yellow, 3 black
export const COLORS: Color[] = [0, 1, 2, 3];
export const COLOR_KEYS = ['red', 'blue', 'yellow', 'black'] as const;
export const TILE_COUNT = 106;
export const FALSE_JOKER_IDS = [104, 105];

export interface TileFace { id: number; color: Color; num: number; falseJoker: boolean }
export interface JokerInfo { color: Color; num: number }

/** Physical description of a tile (independent of the round). */
export function tileFace(id: number): TileFace {
  if (id < 0 || id >= TILE_COUNT || !Number.isInteger(id)) throw new Error(`bad tile id ${id}`);
  if (id >= 104) return { id, color: 0, num: 0, falseJoker: true };
  const c = Math.floor(id / 26) as Color;
  const r = id % 26;
  return { id, color: c, num: (r % 13) + 1, falseJoker: false };
}

export function allTileIds(): number[] {
  return Array.from({ length: TILE_COUNT }, (_, i) => i);
}

/** Real joker = next number after the indicator, same colour (13 wraps to 1). */
export function jokerFromIndicator(indicatorId: number): JokerInfo {
  const f = tileFace(indicatorId);
  if (f.falseJoker) throw new Error('indicator cannot be a false joker');
  return { color: f.color, num: f.num === 13 ? 1 : f.num + 1 };
}

export function isRealJoker(id: number, j: JokerInfo): boolean {
  const f = tileFace(id);
  return !f.falseJoker && f.color === j.color && f.num === j.num;
}

/** Effective face of a tile in this round. Real jokers are wild (returned as null). False jokers take the joker's value. */
export function effective(id: number, j: JokerInfo): { color: Color; num: number } | null {
  const f = tileFace(id);
  if (f.falseJoker) return { color: j.color, num: j.num };
  if (f.color === j.color && f.num === j.num) return null;
  return { color: f.color, num: f.num };
}

/** Natural face used where jokers are not allowed as wildcards. */
export function natural(id: number, j: JokerInfo): { color: Color; num: number } {
  const f = tileFace(id);
  if (f.falseJoker) return { color: j.color, num: j.num };
  return { color: f.color, num: f.num };
}

export type Rng = (maxExclusive: number) => number;

/** Cryptographically secure RNG (Web Crypto, available in Workers, browsers and Node 20+). */
export const secureRng: Rng = (max) => {
  if (max <= 0) return 0;
  const lim = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < lim) return buf[0] % max;
  }
};

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const k = rng(i + 1);
    [a[i], a[k]] = [a[k], a[i]];
  }
  return a;
}

/** Deterministic seeded RNG for tests/replays only. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return (max) => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s % Math.max(1, max);
  };
}
