/** Training-mode assistant. Uses only the player's own tiles and public info. Explanations in Romanian. */
import { RoomConfig } from './config';
import { GameView } from './view';
import { effective, isRealJoker, COLOR_KEYS } from './tiles';
import { findClose, decideDiscard } from './bot';
import type { Hint } from '../shared/protocol';

const RO_COLOR = ['roșu', 'albastru', 'galben', 'negru'];
const RO_CAT: Record<string, string> = { normalJoker: 'normal cu joker', normalPlain: 'normal fără joker', sequences: 'doar suite', triples: 'doar terțe', doubles: 'duble', color: 'culoare', grand: 'Grand' };

export function computeHints(view: GameView, cfg: RoomConfig): Hint[] {
  const me = view.me; if (!me) return [];
  const j = view.joker; const hand = me.hand;
  const hints: Hint[] = [];
  const jokers = hand.filter((x) => isRealJoker(x, j));
  if (jokers.length) hints.push({ kind: 'joker', tiles: jokers, text: `Ai ${jokers.length} joker${jokers.length > 1 ? 'i' : ''} real${jokers.length > 1 ? 'i' : ''} (${RO_COLOR[j.color]} ${j.num}). Pot înlocui orice piesă lipsă dintr-o formație.` });
  if (hand.length === 15) {
    const c = findClose(view, cfg);
    if (c) hints.push({ kind: 'close', tiles: [c.tile], text: `Poți închide! Aruncă piesa evidențiată: categoria ${RO_CAT[c.category]}, ${c.penalty} puncte pentru adversari.` });
  }
  const byCell = new Map<string, number[]>();
  const byColor: number[][] = [[], [], [], []];
  for (const id of hand) {
    const e = effective(id, j); if (!e) continue;
    const k = `${e.color}-${e.num}`;
    byCell.set(k, [...(byCell.get(k) ?? []), id]);
    byColor[e.color].push(id);
  }
  // runs
  for (let c = 0; c < 4; c++) {
    let run: number[] = [];
    for (let n = 1; n <= 14; n++) {
      const ids = byCell.get(`${c}-${n === 14 ? 1 : n}`);
      if (ids && (n < 14 || cfg.highAce)) run.push(ids[0]);
      else { if (run.length >= 3) hints.push({ kind: 'run', tiles: run, text: `Suită ${RO_COLOR[c]} de ${run.length} piese.` }); else if (run.length === 2) hints.push({ kind: 'near-run', tiles: run, text: `Aproape suită ${RO_COLOR[c]}: îți lipsește o piesă la capăt.` }); run = []; }
    }
  }
  // sets
  for (let n = 1; n <= 13; n++) {
    const ids = [0, 1, 2, 3].map((c) => byCell.get(`${c}-${n}`)?.[0]).filter((x): x is number => x !== undefined);
    if (ids.length >= 3) hints.push({ kind: 'set', tiles: ids, text: `Terță de ${n} în ${ids.length} culori diferite.` });
    else if (ids.length === 2 && jokers.length) hints.push({ kind: 'near-set', tiles: [...ids, jokers[0]], text: `Cu jokerul poți completa terța de ${n}.` });
  }
  const pairs = [...byCell.values()].filter((v) => v.length >= 2);
  if (cfg.categories.doubles.enabled && pairs.length >= 4) hints.push({ kind: 'doubles', tiles: pairs.flatMap((p) => p.slice(0, 2)), text: `Ai ${pairs.length} perechi identice — închiderea pe duble (7 perechi) e posibilă.` });
  if (cfg.categories.color.enabled) {
    const best = byColor.reduce((a, b, i) => (b.length > byColor[a].length ? i : a), 0);
    const cnt = byColor[best].length + (cfg.categories.color.allowJokers ? jokers.length : 0);
    if (cnt >= 9) hints.push({ kind: 'color', tiles: byColor[best], text: `${cnt} piese ${RO_COLOR[best]} (${COLOR_KEYS[best]}). Pentru culoare îți trebuie 14 piese de aceeași culoare, în orice ordine.` });
  }
  if (hand.length === 15) {
    const m = decideDiscard(view, cfg, 'hard', () => 0);
    if (m.type === 'discard') hints.push({ kind: 'discard', tiles: [m.tile], text: 'Sugestie de aruncare: piesa evidențiată contribuie cel mai puțin la formațiile tale.' });
  }
  if (me.canPass) hints.push({ kind: 'pass', tiles: jokers, text: 'Ai ambii jokeri: poți activa PASS — niciun jucător nu mai poate lua piese aruncate.' });
  if (me.canAtu) hints.push({ kind: 'atu', tiles: [], text: 'Ai a doua piesă identică cu atuul: apasă ARATĂ ATU înainte de prima mutare.' });
  return hints.slice(0, 12);
}
