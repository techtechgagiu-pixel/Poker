/**
 * Personal wooden rack. Layout is local-only. Dragging writes transforms directly to the DOM in rAF
 * (no React renders per pointer move); React only re-renders on drop.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { useRack, COLS, Layout } from '../rack';
import { Tile } from './Tile';
import { sfx } from '../sound';
import type { JokerInfo } from '../../engine/tiles';

export const TILE_DIM = { s: [54, 74], m: [62, 86], l: [70, 96] } as const;

interface Props { joker: JokerInfo; scale: () => number; onDropDiscard: (tile: number) => void; focusIndex: number | null; heldIndex: number | null; hintTiles: Set<number> }

export function Rack({ joker, scale, onDropDiscard, focusIndex, heldIndex, hintTiles }: Props) {
  const layout = useRack((s) => s.layout);
  const settings = useStore((s) => s.settings);
  const selected = useStore((s) => s.selected);
  const rows = settings.rackRows; const cols = COLS[rows];
  const base = TILE_DIM[settings.tileSize];
  const k = rows === 3 ? 0.86 : 1;
  const tw = Math.round(base[0] * k), th = Math.round(base[1] * k);
  const gap = settings.tileSpacing;
  const pad = 14;
  const width = cols * (tw + gap) - gap + pad * 2;
  const height = rows * (th + 10) - 10 + pad * 2;
  const pos = (i: number) => ({ x: pad + (i % cols) * (tw + gap), y: pad + Math.floor(i / cols) * (th + 10) });
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; from: number; sx: number; sy: number; el: HTMLElement; moved: boolean; pid: number; raf: number; px: number; py: number } | null>(null);
  const slots = useMemo(() => layout.map((id, i) => ({ id, i })), [layout]);

  const slotAt = (clientX: number, clientY: number): number | null => {
    const r = ref.current!.getBoundingClientRect(); const s = scale();
    const x = (clientX - r.left) / s - pad, y = (clientY - r.top) / s - pad;
    if (x < -tw / 2 || y < -th / 2 || x > width || y > height) return null;
    const c = Math.max(0, Math.min(cols - 1, Math.round((x - tw / 2) / (tw + gap))));
    const rr = Math.max(0, Math.min(rows - 1, Math.round((y - th / 2) / (th + 10))));
    return rr * cols + c;
  };

  const onDown = (e: React.PointerEvent, id: number, from: number) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    drag.current = { id, from, sx: e.clientX, sy: e.clientY, el, moved: false, pid: e.pointerId, raf: 0, px: e.clientX, py: e.clientY };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.pid !== e.pointerId) return;
    d.px = e.clientX; d.py = e.clientY;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) { d.moved = true; d.el.classList.add('dragging'); }
    if (d.moved && !d.raf) d.raf = requestAnimationFrame(() => {
      d.raf = 0; const s = scale(); const p = pos(d.from);
      d.el.style.transform = `translate3d(${p.x + (d.px - d.sx) / s}px, ${p.y + (d.py - d.sy) / s - 6}px, 0) scale(1.06)`;
    });
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.pid !== e.pointerId) return;
    drag.current = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    d.el.classList.remove('dragging');
    const st = useStore.getState();
    if (!d.moved) {
      const sel = st.selected.includes(d.id) ? st.selected.filter((x) => x !== d.id) : e.shiftKey || e.ctrlKey || e.metaKey ? [...st.selected, d.id] : [d.id];
      st.set({ selected: sel }); sfx('move');
      return;
    }
    // drop on the discard zone?
    d.el.style.visibility = 'hidden';
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop]');
    d.el.style.visibility = '';
    // restore the React-managed transform; the layout change below then animates the tile into place
    const home = pos(d.from); d.el.style.transform = `translate3d(${home.x}px, ${home.y}px, 0)`;
    if (under?.getAttribute('data-drop') === 'discard') { onDropDiscard(d.id); return; }
    const to = slotAt(e.clientX, e.clientY);
    if (to === null || to === d.from) return;
    moveTiles(d.id, to, st.selected.includes(d.id) ? st.selected : [d.id]);
    sfx('snap');
  };

  // keyboard / controller "held" tile visual
  useEffect(() => () => { if (drag.current?.raf) cancelAnimationFrame(drag.current.raf); }, []);

  return (
    <div className="rack-wrap" style={{ width: width + 36 }}>
      <div className="rack" ref={ref} style={{ width, height }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {Array.from({ length: rows }, (_, r) => <div key={r} className="rack-ledge" style={{ top: pad + r * (th + 10) + th - 4 }} />)}
        {focusIndex !== null && <div className="rack-focus" style={{ transform: `translate3d(${pos(focusIndex).x - 4}px, ${pos(focusIndex).y - 4}px,0)`, width: tw + 8, height: th + 8 }} />}
        {slots.map(({ id, i }) => id === null ? null : (
          <div key={id} className={`rack-tile ${heldIndex === i ? 'held' : ''}`} style={{ transform: `translate3d(${pos(i).x}px, ${pos(i).y}px, 0)` }}
            onPointerDown={(e) => onDown(e, id, i)}>
            <Tile id={id} joker={joker} w={tw} h={th} selected={selected.includes(id)} hint={hintTiles.has(id)} />
          </div>
        ))}
        <div className="rack-brand">Gagiu's WorkArt</div>
      </div>
    </div>
  );
}

/** Move one or several tiles so the dragged one lands on `to`; displaced tiles swap into vacated slots. */
export function moveTiles(dragged: number, to: number, group: number[]) {
  const st = useRack.getState();
  const l: Layout = st.layout.slice();
  if (group.length <= 1) {
    const from = l.indexOf(dragged);
    const other = l[to];
    l[to] = dragged; l[from] = other ?? null;
    st.set(l); return;
  }
  // multi-tile: keep the group's reading order, place consecutively from `to`
  const ordered = l.filter((x): x is number => x !== null && group.includes(x));
  for (let i = 0; i < l.length; i++) if (l[i] !== null && group.includes(l[i]!)) l[i] = null;
  const displaced: number[] = [];
  ordered.forEach((id, k) => { const p = Math.min(l.length - 1, to + k); if (l[p] !== null) displaced.push(l[p]!); l[p] = id; });
  for (const id of displaced) { const free = l.indexOf(null); if (free >= 0) l[free] = id; }
  st.set(l);
}
