/**
 * Septică — Romanian card game for 2–4 players (32-card deck: 7 8 9 10 J Q K A in four suits).
 * Pure, deterministic state machine (like the Remi engine). The room server is the only writer.
 *
 * Rules implemented (documented in RULES_SEPTICA.md):
 *  - Each player is dealt 4 cards; the rest is the stock. A random player leads.
 *  - Trick: the leader plays any card; its rank R is the rank to answer. The next player may answer ("taie") with a card of
 *    rank R or with ANY 7, or pass. Answering passes the turn on to the next player around the table, who may again answer
 *    (R or 7) or pass. The first player who passes ends the trick: the LAST player who played a card takes the whole pile and
 *    leads next. A player without a legal card passes automatically.
 *  - After each trick everybody draws back up to 4 cards (starting with the player who took the pile) while the stock lasts.
 *  - Aces and tens are worth 1 point each (8 points in total). When all cards are played the highest total wins; ties are
 *    broken by the number of cards taken; still tied = draw. With 4 players the table can play as two teams (seats 0+2 vs 1+3).
 */
import { Rng, shuffle } from './tiles';

export const S_RANKS = [7, 8, 9, 10, 11, 12, 13, 14] as const; // 11 = J, 12 = Q, 13 = K, 14 = A
export const S_DECK = 32;
export const HAND_SIZE = 4;
export const cardRank = (id: number) => S_RANKS[id % 8];
export const cardSuit = (id: number) => Math.floor(id / 8); // 0 ♥ 1 ♦ 2 ♣ 3 ♠
export const isPointCard = (id: number) => cardRank(id) === 10 || cardRank(id) === 14;

export class SepticaError extends Error { constructor(public code: string) { super(code); } }

export interface SepticaOpts { players: 2 | 3 | 4; teams: boolean; voluntaryPass: boolean }
export const defaultSepticaOpts = (): SepticaOpts => ({ players: 4, teams: false, voluntaryPass: true });

export function sanitizeSepticaOpts(i: unknown): SepticaOpts {
  const o = (i && typeof i === 'object' ? i : {}) as any; const d = defaultSepticaOpts();
  const players = [2, 3, 4].includes(o.players) ? o.players : d.players;
  return { players, teams: players === 4 && o.teams === true, voluntaryPass: typeof o.voluntaryPass === 'boolean' ? o.voluntaryPass : d.voluntaryPass };
}

export interface SepticaSeat { seat: number; name: string; isBot: boolean; score: number; status: 'ACTIVE'; stats: { tricks: number; cards: number } }
export interface SepticaEvent { n: number; type: 'play' | 'pass' | 'trick' | 'deal' | 'end'; seat: number | null; card?: number; data?: any }
export interface SepticaResult { points: number[]; cards: number[]; teamPoints: number[] | null; winners: number[]; draw: boolean }

export interface SepticaState {
  kind: 'septica';
  /** Same phase names as Remi so the generic room scheduler (timers, bots, away…) works unchanged. */
  phase: 'WAITING_FOR_DISCARD' | 'MATCH_FINISHED';
  version: number; round: number;
  opts: SepticaOpts; turnSeconds: number;
  seats: SepticaSeat[]; hands: number[][]; stock: number[]; taken: number[][];
  table: { card: number; by: number }[];
  rank: number | null; current: number; leader: number; last: number | null;
  turnDeadline: number | null; pausedRemaining: number | null;
  winner: number | null; draw: boolean; result: SepticaResult | null;
  lastTrick: { taker: number; cards: number[]; points: number; seq: number } | null;
  startedAt: number; finishedAt: number | null;
  events: SepticaEvent[]; eventSeq: number;
  /** compatibility with the shared room code */
  atuDeclaredBy: number[]; nextRoundAt: number | null; outTiles: number[]; pot: number;
}

function ev(g: SepticaState, type: SepticaEvent['type'], seat: number | null, extra: Partial<SepticaEvent> = {}) {
  g.events.push({ n: ++g.eventSeq, type, seat, ...extra });
  if (g.events.length > 40) g.events.splice(0, g.events.length - 40);
}

export function newSeptica(players: { name: string; isBot: boolean }[], opts: SepticaOpts, turnSeconds: number, rng: Rng, now: number): SepticaState {
  if (players.length < 2 || players.length > 4) throw new SepticaError('bad_player_count');
  const deck = shuffle(Array.from({ length: S_DECK }, (_, i) => i), rng);
  const hands = players.map(() => [] as number[]);
  for (let r = 0; r < HAND_SIZE; r++) for (let p = 0; p < players.length; p++) hands[p].push(deck.pop()!);
  const starter = rng(players.length);
  const g: SepticaState = {
    kind: 'septica', phase: 'WAITING_FOR_DISCARD', version: 0, round: 1,
    opts: { ...opts, players: players.length as 2 | 3 | 4, teams: opts.teams && players.length === 4 }, turnSeconds,
    seats: players.map((p, seat) => ({ seat, name: p.name, isBot: p.isBot, score: 0, status: 'ACTIVE', stats: { tricks: 0, cards: 0 } })),
    hands, stock: deck, taken: players.map(() => []), table: [], rank: null, current: starter, leader: starter, last: null,
    turnDeadline: null, pausedRemaining: null, winner: null, draw: false, result: null, lastTrick: null,
    startedAt: now, finishedAt: null, events: [], eventSeq: 0, atuDeclaredBy: [], nextRoundAt: null, outTiles: [], pot: 0,
  };
  ev(g, 'deal', starter);
  settle(g, now);
  g.version++;
  return g;
}

const next = (g: SepticaState, seat: number) => (seat + 1) % g.seats.length;

export function legalCards(g: SepticaState, seat: number): number[] {
  const h = g.hands[seat] ?? [];
  if (g.table.length === 0) return h.slice();
  return h.filter((c) => cardRank(c) === g.rank || cardRank(c) === 7);
}
export function canPassNow(g: SepticaState, seat: number): boolean {
  if (g.table.length === 0) return false; // the leader must play
  return g.opts.voluntaryPass || legalCards(g, seat).length === 0;
}

function setDeadline(g: SepticaState, now: number) { g.turnDeadline = g.turnSeconds > 0 ? now + g.turnSeconds * 1000 : null; }

function assertTurn(g: SepticaState, seat: number) {
  if (g.phase !== 'WAITING_FOR_DISCARD') throw new SepticaError('wrong_phase');
  if (g.pausedRemaining !== null) throw new SepticaError('paused');
  if (g.current !== seat) throw new SepticaError('not_your_turn');
}

export function playCard(g: SepticaState, seat: number, card: number, now: number) {
  assertTurn(g, seat);
  if (!g.hands[seat].includes(card)) throw new SepticaError('not_owner');
  if (!legalCards(g, seat).includes(card)) throw new SepticaError('illegal_card');
  g.hands[seat].splice(g.hands[seat].indexOf(card), 1);
  if (g.table.length === 0) g.rank = cardRank(card);
  g.table.push({ card, by: seat });
  g.last = seat;
  ev(g, 'play', seat, { card });
  g.current = next(g, seat);
  settle(g, now);
  g.version++;
}

export function passTurn(g: SepticaState, seat: number, now: number) {
  assertTurn(g, seat);
  if (!canPassNow(g, seat)) throw new SepticaError('must_play');
  endTrick(g, now, seat);
  settle(g, now);
  g.version++;
}

/** The player who passed ends the trick; the last player who played takes the pile. */
function endTrick(g: SepticaState, now: number, passer: number | null) {
  const taker = g.last!;
  const cards = g.table.map((t) => t.card);
  const points = cards.filter(isPointCard).length;
  g.taken[taker].push(...cards);
  g.seats[taker].stats.tricks++; g.seats[taker].stats.cards = g.taken[taker].length;
  g.lastTrick = { taker, cards, points, seq: (g.lastTrick?.seq ?? 0) + 1 };
  if (passer !== null) ev(g, 'pass', passer);
  ev(g, 'trick', taker, { data: { cards, points } });
  g.table = []; g.rank = null; g.last = null;
  // everybody draws back up to 4, starting with the taker
  let progress = true;
  while (progress && g.stock.length) {
    progress = false;
    for (let k = 0; k < g.seats.length && g.stock.length; k++) {
      const s = (taker + k) % g.seats.length;
      if (g.hands[s].length < HAND_SIZE) { g.hands[s].push(g.stock.pop()!); progress = true; }
    }
  }
  g.leader = taker; g.current = taker;
  refreshScores(g);
  void now;
}

function refreshScores(g: SepticaState) {
  g.seats.forEach((s, i) => { s.score = g.taken[i].filter(isPointCard).length; s.stats.cards = g.taken[i].length; });
}

/** Advance until a human/bot decision is really needed: forced passes, empty hands, end of the game. */
function settle(g: SepticaState, now: number) {
  for (let guard = 0; guard < 64; guard++) {
    if (g.phase === 'MATCH_FINISHED') return;
    const allEmpty = g.hands.every((h) => h.length === 0);
    if (g.table.length === 0 && allEmpty && g.stock.length === 0) return finish(g, now);
    const s = g.current;
    if (g.table.length > 0) {
      if (legalCards(g, s).length === 0) { endTrick(g, now, s); continue; } // cannot answer: forced pass
      setDeadline(g, now); return;
    }
    // leading
    if (g.hands[s].length === 0) { g.current = next(g, s); if (g.current === g.leader && g.hands.every((h) => h.length === 0)) return finish(g, now); continue; }
    g.leader = s; setDeadline(g, now); return;
  }
}

function finish(g: SepticaState, now: number) {
  refreshScores(g);
  const n = g.seats.length;
  const points = g.seats.map((s) => s.score), cards = g.taken.map((t) => t.length);
  let teamPoints: number[] | null = null; let winners: number[] = [];
  if (g.opts.teams && n === 4) {
    teamPoints = [points[0] + points[2], points[1] + points[3]];
    const tc = [cards[0] + cards[2], cards[1] + cards[3]];
    const best = teamPoints[0] !== teamPoints[1] ? (teamPoints[0] > teamPoints[1] ? 0 : 1) : tc[0] !== tc[1] ? (tc[0] > tc[1] ? 0 : 1) : -1;
    winners = best < 0 ? [] : [best, best + 2];
  } else {
    const key = (i: number) => points[i] * 100 + cards[i];
    const top = Math.max(...g.seats.map((_, i) => key(i)));
    winners = g.seats.map((_, i) => i).filter((i) => key(i) === top);
    if (winners.length === n) winners = [];
  }
  g.draw = winners.length === 0;
  g.winner = winners.length ? winners[0] : null;
  g.result = { points, cards, teamPoints, winners, draw: g.draw };
  g.phase = 'MATCH_FINISHED'; g.turnDeadline = null; g.finishedAt = now;
  ev(g, 'end', g.winner);
}

/** Automatic move when the turn timer expires (always legal, never blocks the table). */
export function autoMove(g: SepticaState, seat: number, now: number) {
  if (g.table.length === 0) {
    const h = g.hands[seat].slice().sort((a, b) => Number(isPointCard(a)) - Number(isPointCard(b)) || cardRank(a) - cardRank(b));
    return playCard(g, seat, h[0], now);
  }
  if (canPassNow(g, seat)) return passTurn(g, seat, now);
  const l = legalCards(g, seat).sort((a, b) => Number(cardRank(a) === 7) - Number(cardRank(b) === 7));
  return playCard(g, seat, l[0], now);
}

// ------------------------------------------------------------------------------------------------ views & bots
export interface SepticaView {
  kind: 'septica'; phase: SepticaState['phase']; version: number; round: number; opts: SepticaOpts;
  current: number; leader: number; rank: number | null; stock: number;
  table: { card: number; by: number }[];
  seats: { seat: number; name: string; isBot: boolean; score: number; status: 'ACTIVE'; tiles: number; taken: number; tricks: number }[];
  turnDeadline: number | null; paused: boolean; pausedRemaining: number | null;
  lastTrick: SepticaState['lastTrick']; winner: number | null; draw: boolean; result: SepticaResult | null;
  events: SepticaEvent[]; startedAt: number; finishedAt: number | null;
  /** only the viewer's own cards; opponents' hands and the stock order are never sent */
  me: null | { seat: number; hand: number[]; legal: number[]; canPass: boolean; myTurn: boolean };
}

export function septicaView(g: SepticaState, seat: number | null): SepticaView {
  const mine = seat !== null && g.seats[seat] ? seat : null;
  return {
    kind: 'septica', phase: g.phase, version: g.version, round: g.round, opts: g.opts, current: g.current, leader: g.leader, rank: g.rank, stock: g.stock.length,
    table: g.table.slice(),
    seats: g.seats.map((s, i) => ({ seat: s.seat, name: s.name, isBot: s.isBot, score: s.score, status: 'ACTIVE', tiles: g.hands[i].length, taken: g.taken[i].length, tricks: s.stats.tricks })),
    turnDeadline: g.turnDeadline, paused: g.pausedRemaining !== null, pausedRemaining: g.pausedRemaining,
    lastTrick: g.lastTrick, winner: g.winner, draw: g.draw, result: g.result, events: g.events.slice(-10), startedAt: g.startedAt, finishedAt: g.finishedAt,
    me: mine === null ? null : { seat: mine, hand: g.hands[mine].slice().sort((a, b) => cardSuit(a) - cardSuit(b) || cardRank(a) - cardRank(b)), legal: g.current === mine ? legalCards(g, mine) : [],
      canPass: g.current === mine && canPassNow(g, mine), myTurn: g.current === mine && g.phase === 'WAITING_FOR_DISCARD' },
  };
}

export type SepticaMove = { type: 'play'; card: number } | { type: 'pass' };
export type SLevel = 'easy' | 'medium' | 'hard';

/** Bots see exactly what a human sees (own hand + public information). */
export function septicaBot(v: SepticaView, level: SLevel, rng: Rng): SepticaMove {
  const me = v.me!; const hand = me.hand;
  const rankOf = cardRank;
  if (v.table.length === 0) {
    // leading: easy = random; otherwise lead a cheap card, preferably of a rank I hold twice (so I can answer an answer)
    if (level === 'easy') return { type: 'play', card: hand[rng(hand.length)] };
    const count = (r: number) => hand.filter((c) => rankOf(c) === r).length;
    const cheap = hand.filter((c) => !isPointCard(c) && rankOf(c) !== 7);
    const pool = cheap.length ? cheap : hand.filter((c) => rankOf(c) !== 7).length ? hand.filter((c) => rankOf(c) !== 7) : hand;
    pool.sort((a, b) => count(rankOf(b)) - count(rankOf(a)) || rankOf(a) - rankOf(b));
    return { type: 'play', card: pool[0] };
  }
  const legal = me.legal; const pile = v.table.map((t) => t.card);
  const pts = pile.filter(isPointCard).length;
  if (!legal.length) return { type: 'pass' };
  const same = legal.filter((c) => rankOf(c) !== 7); const sevens = legal.filter((c) => rankOf(c) === 7);
  if (level === 'easy') return rng(100) < 80 ? { type: 'play', card: legal[rng(legal.length)] } : (me.canPass ? { type: 'pass' } : { type: 'play', card: legal[0] });
  if (same.length) return { type: 'play', card: same[0] }; // a same-rank answer is free: keep the 7s
  // only 7s can answer: spend one when the pile is worth it
  const worth = level === 'hard' ? pts >= 1 || pile.length >= 4 : pts >= 1 || pile.length >= 3;
  if (worth || !me.canPass) return { type: 'play', card: sevens[0] };
  return { type: 'pass' };
}
