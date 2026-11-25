import { Color } from '../src/engine/tiles';
export const R = 0, B = 1, Y = 2, K = 3;
/** physical tile id for colour, number, copy (0/1) */
export const t = (c: Color | number, n: number, copy = 0) => c * 26 + copy * 13 + (n - 1);
export const FJ = [104, 105];
