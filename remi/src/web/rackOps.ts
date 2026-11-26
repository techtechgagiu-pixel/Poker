/** Pure rack operations (no DOM, no stores) — unit tested. */
export type Layout = (number | null)[];

/**
 * Insert `ids` (in order) at slot `index`, like inserting into a line of tiles. The dragged tiles are lifted
 * first; neighbours in the target row slide aside into the NEAREST gap (either side), so dropping a 6 between an
 * adjacent 5 and 7 yields 5 6 7. When the row is completely full the drop swaps: the tile that was under the
 * pointer goes to the slot the dragged tile came from — a drop is never refused or bounced back.
 */
export function insertTiles(layout: Layout, cols: number, ids: number[], index: number): Layout {
  const origins = ids.map((id) => layout.indexOf(id)).filter((i) => i >= 0);
  const out = layout.map((x) => (x !== null && ids.includes(x) ? null : x));
  const row = Math.floor(index / cols);
  const start = row * cols, end = start + cols; // [start, end)
  let p = Math.max(start, Math.min(end - 1, index));
  const displaced: number[] = [];
  for (const id of ids) {
    if (p >= end) { displaced.push(id); continue; }
    if (out[p] === null) { out[p] = id; p++; continue; }
    // nearest gap on either side (ties go right)
    let jr = -1, jl = -1;
    for (let k = p + 1; k < end; k++) if (out[k] === null) { jr = k; break; }
    for (let k = p - 1; k >= start; k--) if (out[k] === null) { jl = k; break; }
    const dr = jr >= 0 ? jr - p : Infinity, dl = jl >= 0 ? p - jl : Infinity;
    if (dr === Infinity && dl === Infinity) {
      // row full: swap with the tile under the pointer
      displaced.push(out[p]!); out[p] = id; p++; continue;
    }
    if (dr <= dl) { for (let k = jr; k > p; k--) out[k] = out[k - 1]; out[p] = id; p++; }
    else { for (let k = jl; k < p - 1; k++) out[k] = out[k + 1]; out[p - 1] = id; }
  }
  // displaced tiles take the slots the dragged tiles came from, otherwise any free slot
  for (const d of displaced) {
    let f = origins.find((o) => out[o] === null);
    if (f === undefined) f = out.indexOf(null);
    if (f >= 0) out[f] = d;
  }
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
