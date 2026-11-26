/** Pure rack operations (no DOM, no stores) — unit tested. */
export type Layout = (number | null)[];

/**
 * Insert `ids` (in order) at slot `index`, like inserting into a line of tiles:
 * the dragged tiles are lifted first, then neighbours in the same row slide aside into the nearest gaps
 * (right first, then left). Dropping a 6 between an adjacent 5 and 7 yields 5 6 7.
 */
export function insertTiles(layout: Layout, cols: number, ids: number[], index: number): Layout {
  const out = layout.map((x) => (x !== null && ids.includes(x) ? null : x));
  const row = Math.floor(index / cols);
  const start = row * cols, end = start + cols; // [start, end)
  let p = Math.max(start, Math.min(end - 1, index));
  const overflow: number[] = [];
  for (const id of ids) {
    if (p >= end) { overflow.push(id); continue; }
    if (out[p] === null) { out[p] = id; p++; continue; }
    let j = -1;
    for (let k = p + 1; k < end; k++) if (out[k] === null) { j = k; break; }
    if (j >= 0) { for (let k = j; k > p; k--) out[k] = out[k - 1]; out[p] = id; p++; continue; }
    for (let k = p - 1; k >= start; k--) if (out[k] === null) { j = k; break; }
    if (j >= 0) { for (let k = j; k < p - 1; k++) out[k] = out[k + 1]; out[p - 1] = id; continue; }
    overflow.push(id); // row completely full
  }
  for (const id of overflow) { const f = out.indexOf(null); if (f >= 0) out[f] = id; }
  return out;
}

/** Continuous hit-test: which slot, and whether the pointer is on the right half of it. */
export function insertionIndex(x: number, y: number, tw: number, th: number, gap: number, rowGap: number, cols: number, rows: number, layout: Layout): number {
  const pitch = tw + gap;
  const c = Math.max(0, Math.min(cols - 1, Math.floor((x + gap / 2) / pitch)));
  const r = Math.max(0, Math.min(rows - 1, Math.floor((y + rowGap / 2) / (th + rowGap))));
  const idx = r * cols + c;
  const within = (x - c * pitch) / tw; // 0..1 across the tile under the pointer
  // right half of an occupied tile => insert after it (still within the row)
  if (layout[idx] !== null && within > 0.5 && c < cols - 1) return idx + 1;
  return idx;
}
