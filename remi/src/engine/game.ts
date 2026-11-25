/**
 * Authoritative, deterministic game state machine. Pure functions over a serialisable GameState.
 * The Durable Object owns one GameState per room and is the only writer.
 */
import { RoomConfig, CategoryKey } from './config';
import { JokerInfo, Rng, allTileIds, isRealJoker, jokerFromIndicator, shuffle, tileFace } from './tiles';
import { Formation, chooseWin, detectWins } from './validator';

export type Phase = 'LOBBY' | 'DEALING' | 'WAITING_FOR_DRAW' | 'WAITING_FOR_DISCARD' | 'VALIDATING_CLOSE' | 'ROUND_RESULT' | 'NEXT_ROUND' | 'MATCH_FINISHED';
export type PlayerStatus = 'ACTIVE' | 'ELIMINATED';

export interface SeatState {
  seat: number;
  name: string;
  isBot: boolean;
  score: number;
  status: PlayerStatus;
  /** per-match stats */
  stats: { roundsWon: number; categories: Partial<Record<CategoryKey, number>>; jokerCloses: number; passActivations: number; atuDeclarations: number };
}

export interface PassState { active: boolean; by: number | null; turnsLeft: number | null; activations: number; jokerId: number | null }

export interface RoundResult {
  kind: 'win' | 'draw';
  winner: number | null;
  category: CategoryKey | null;
  formations: Formation[];
  hand: number[];
  discard: number | null;
  jokerDiscard: boolean;
  penalty: number;
  before: number[];
  after: number[];
  eliminated: number[];
}

export interface PublicEvent {
  n: number; // sequence number
  type: 'deal' | 'draw_pile' | 'draw_discard' | 'discard' | 'pass' | 'atu' | 'close' | 'draw_round' | 'eliminated' | 'timeout' | 'match_end';
  seat: number | null;
  tile?: number; // only for public tiles
  data?: any;
}

export interface GameState {
  phase: Phase;
  version: number;
  round: number;
  seats: SeatState[];
  starter: number;
  current: number;
  indicator: number;
  joker: JokerInfo;
  hands: number[][];
  drawPile: number[];
  discards: number[][];
  /** seat whose top discard may be taken by the current player (null = none eligible) */
  lastDiscardSeat: number | null;
  pass: PassState;
  passArea: number[];
  atuDeclaredBy: number[];
  firstTurnDone: boolean[];
  turnDeadline: number | null;
  /** remaining ms when paused */
  pausedRemaining: number | null;
  result: RoundResult | null;
  nextRoundAt: number | null;
  winner: number | null;
  events: PublicEvent[];
  eventSeq: number;
  startedAt: number;
  finishedAt: number | null;
  /** tiles of eliminated players (kept for conservation) */
  outTiles: number[];
}

export class GameError extends Error { constructor(public code: string) { super(code); } }

export function activeSeats(g: GameState): number[] {
  return g.seats.filter((s) => s.status === 'ACTIVE').map((s) => s.seat);
}
export function nextActive(g: GameState, seat: number): number {
  const n = g.seats.length;
  for (let k = 1; k <= n; k++) { const s = (seat + k) % n; if (g.seats[s].status === 'ACTIVE') return s; }
  return seat;
}
export function prevActive(g: GameState, seat: number): number {
  const n = g.seats.length;
  for (let k = 1; k <= n; k++) { const s = (seat - k + n) % n; if (g.seats[s].status === 'ACTIVE') return s; }
  return seat;
}

function ev(g: GameState, type: PublicEvent['type'], seat: number | null, extra: Partial<PublicEvent> = {}) {
  g.events.push({ n: ++g.eventSeq, type, seat, ...extra });
  if (g.events.length > 60) g.events.splice(0, g.events.length - 60);
}

export function newMatch(players: { name: string; isBot: boolean }[], cfg: RoomConfig, now: number): GameState {
  if (players.length < 2 || players.length > 4) throw new GameError('bad_player_count');
  return {
    phase: 'LOBBY', version: 0, round: 0,
    seats: players.map((p, seat) => ({ seat, name: p.name, isBot: p.isBot, score: cfg.startingScore, status: 'ACTIVE',
      stats: { roundsWon: 0, categories: {}, jokerCloses: 0, passActivations: 0, atuDeclarations: 0 } })),
    starter: -1, current: 0, indicator: 0, joker: { color: 0, num: 1 }, hands: players.map(() => []), drawPile: [],
    discards: players.map(() => []), lastDiscardSeat: null,
    pass: { active: false, by: null, turnsLeft: null, activations: 0, jokerId: null }, passArea: [], atuDeclaredBy: [],
    firstTurnDone: players.map(() => false), turnDeadline: null, pausedRemaining: null, result: null, nextRoundAt: null,
    winner: null, events: [], eventSeq: 0, startedAt: now, finishedAt: null, outTiles: [],
  };
}

function setDeadline(g: GameState, cfg: RoomConfig, now: number) {
  g.turnDeadline = cfg.turnSeconds > 0 ? now + cfg.turnSeconds * 1000 : null;
}

/** Shuffle, choose indicator, deal 14 (15 to starter). */
export function startRound(g: GameState, cfg: RoomConfig, rng: Rng, now: number) {
  if (g.phase === 'MATCH_FINISHED') throw new GameError('match_finished');
  const active = activeSeats(g);
  if (active.length < 2) throw new GameError('not_enough_players');
  g.phase = 'DEALING';
  g.round += 1;
  g.starter = g.starter < 0 ? active[rng(active.length)] : nextActive(g, g.starter);
  const deck = shuffle(allTileIds(), rng);
  const indIdx = deck.findIndex((id) => !tileFace(id).falseJoker);
  g.indicator = deck.splice(indIdx, 1)[0];
  g.joker = jokerFromIndicator(g.indicator);
  g.hands = g.seats.map(() => []);
  // eliminated players' tiles are not dealt
  let seat = g.starter;
  for (let k = 0; k < active.length; k++) {
    const count = seat === g.starter ? 15 : 14;
    g.hands[seat] = deck.splice(0, count);
    seat = nextActive(g, seat);
  }
  g.drawPile = deck;
  g.outTiles = [];
  g.discards = g.seats.map(() => []);
  g.lastDiscardSeat = null;
  g.pass = { active: false, by: null, turnsLeft: null, activations: 0, jokerId: null };
  g.passArea = [];
  g.atuDeclaredBy = [];
  g.firstTurnDone = g.seats.map(() => false);
  g.result = null; g.nextRoundAt = null; g.pausedRemaining = null;
  g.current = g.starter;
  g.phase = 'WAITING_FOR_DISCARD';
  setDeadline(g, cfg, now);
  ev(g, 'deal', g.starter, { tile: g.indicator, data: { round: g.round } });
  g.version++;
}

function assertTurn(g: GameState, seat: number, phase: Phase) {
  if (g.pausedRemaining !== null) throw new GameError('paused');
  if (g.seats[seat]?.status !== 'ACTIVE') throw new GameError('not_active');
  if (g.current !== seat) throw new GameError('not_your_turn');
  if (g.phase !== phase) throw new GameError('wrong_phase');
}

export function passBlocksSeat(g: GameState, cfg: RoomConfig, seat: number): boolean {
  if (!g.pass.active) return false;
  if (!cfg.pass.affectsActivator && g.pass.by === seat) return false;
  return true;
}

export function canTakeDiscard(g: GameState, cfg: RoomConfig, seat: number): boolean {
  if (g.phase !== 'WAITING_FOR_DRAW' || g.current !== seat) return false;
  if (passBlocksSeat(g, cfg, seat)) return false;
  const from = prevActive(g, seat);
  return g.lastDiscardSeat === from && g.discards[from].length > 0;
}

export function draw(g: GameState, cfg: RoomConfig, seat: number, source: 'pile' | 'discard', now: number): number {
  assertTurn(g, seat, 'WAITING_FOR_DRAW');
  let tile: number;
  if (source === 'discard') {
    if (!canTakeDiscard(g, cfg, seat)) throw new GameError(g.pass.active ? 'pass_active' : 'discard_not_eligible');
    const from = prevActive(g, seat);
    tile = g.discards[from].pop()!;
    g.lastDiscardSeat = null;
    ev(g, 'draw_discard', seat, { tile, data: { from } });
  } else {
    if (!g.drawPile.length) throw new GameError('pile_empty');
    tile = g.drawPile.shift()!;
    ev(g, 'draw_pile', seat);
  }
  g.hands[seat].push(tile);
  g.phase = 'WAITING_FOR_DISCARD';
  g.version++;
  void now;
  return tile;
}

function endTurn(g: GameState, cfg: RoomConfig, seat: number, now: number) {
  g.firstTurnDone[seat] = true;
  if (g.pass.active && g.pass.turnsLeft !== null) {
    g.pass.turnsLeft -= 1;
    if (g.pass.turnsLeft <= 0) { g.pass.active = false; g.pass.turnsLeft = null; }
  }
  g.current = nextActive(g, seat);
  if (!g.drawPile.length) {
    // nobody can draw: round ends as a draw (no penalties). Discards are never recycled.
    endRoundDraw(g, cfg, now);
    return;
  }
  g.phase = 'WAITING_FOR_DRAW';
  setDeadline(g, cfg, now);
}

export function discard(g: GameState, cfg: RoomConfig, seat: number, tile: number, now: number) {
  assertTurn(g, seat, 'WAITING_FOR_DISCARD');
  const h = g.hands[seat];
  const i = h.indexOf(tile);
  if (i < 0) throw new GameError('not_owner');
  h.splice(i, 1);
  g.discards[seat].push(tile);
  g.lastDiscardSeat = seat;
  ev(g, 'discard', seat, { tile });
  endTurn(g, cfg, seat, now);
  g.version++;
}

export function canPass(g: GameState, cfg: RoomConfig, seat: number): boolean {
  if (!cfg.pass.enabled || g.phase !== 'WAITING_FOR_DISCARD' || g.current !== seat) return false;
  if (g.pass.active || g.pass.activations >= cfg.pass.maxPerRound) return false;
  return g.hands[seat].filter((id) => isRealJoker(id, g.joker)).length >= 2;
}

export function activatePass(g: GameState, cfg: RoomConfig, seat: number, jokerTile: number, now: number) {
  assertTurn(g, seat, 'WAITING_FOR_DISCARD');
  if (!cfg.pass.enabled) throw new GameError('pass_disabled');
  if (g.pass.active) throw new GameError('pass_already_active');
  if (g.pass.activations >= cfg.pass.maxPerRound) throw new GameError('pass_limit');
  const h = g.hands[seat];
  const jokers = h.filter((id) => isRealJoker(id, g.joker));
  if (jokers.length < 2) throw new GameError('pass_needs_two_jokers');
  if (!jokers.includes(jokerTile)) throw new GameError('pass_tile_not_joker');
  h.splice(h.indexOf(jokerTile), 1);
  g.passArea.push(jokerTile);
  const n = activeSeats(g).length;
  const d = cfg.pass.duration;
  g.pass = { active: true, by: seat, activations: g.pass.activations + 1, jokerId: jokerTile,
    // +1 because the activating turn itself is decremented in endTurn
    turnsLeft: d.kind === 'round' ? null : d.kind === 'rotation' ? n + 1 : d.turns + 1 };
  // nothing may be taken from the activator's (now unchanged) discard stack this turn
  g.lastDiscardSeat = null;
  g.seats[seat].stats.passActivations++;
  if (cfg.pass.activatorScoreDelta) g.seats[seat].score += cfg.pass.activatorScoreDelta;
  ev(g, 'pass', seat, { tile: jokerTile });
  endTurn(g, cfg, seat, now);
  if (cfg.pass.activatorScoreDelta < 0) applyEliminations(g, cfg, now, [seat]);
  g.version++;
}

export function canDeclareAtu(g: GameState, cfg: RoomConfig, seat: number): boolean {
  if (!cfg.atu.enabled) return false;
  if (g.phase !== 'WAITING_FOR_DRAW' && g.phase !== 'WAITING_FOR_DISCARD') return false;
  if (g.pausedRemaining !== null || g.seats[seat]?.status !== 'ACTIVE') return false;
  if (g.firstTurnDone[seat]) return false;
  if (g.atuDeclaredBy.includes(seat)) return false;
  if (cfg.atu.oncePerRound && g.atuDeclaredBy.length > 0) return false;
  const ind = tileFace(g.indicator);
  return g.hands[seat].some((id) => { const f = tileFace(id); return !f.falseJoker && id !== g.indicator && f.color === ind.color && f.num === ind.num; });
}

export function declareAtu(g: GameState, cfg: RoomConfig, seat: number, now: number) {
  if (!canDeclareAtu(g, cfg, seat)) throw new GameError('atu_not_allowed');
  g.atuDeclaredBy.push(seat);
  g.seats[seat].stats.atuDeclarations++;
  const victims = activeSeats(g).filter((s) => s !== seat);
  for (const s of victims) g.seats[s].score -= cfg.atu.penalty;
  const ind = tileFace(g.indicator);
  const shown = g.hands[seat].find((id) => { const f = tileFace(id); return !f.falseJoker && f.color === ind.color && f.num === ind.num; });
  ev(g, 'atu', seat, { tile: shown, data: { penalty: cfg.atu.penalty } });
  applyEliminations(g, cfg, now, victims);
  g.version++;
}

/** Eliminate players at <=0 mid-round (Atu / PASS penalty). Keeps the round consistent. */
function applyEliminations(g: GameState, cfg: RoomConfig, now: number, candidates: number[]) {
  const out: number[] = [];
  for (const s of candidates) {
    const st = g.seats[s];
    if (st.status === 'ACTIVE' && st.score <= 0) { st.status = 'ELIMINATED'; st.score = 0; out.push(s); }
  }
  if (!out.length) return;
  for (const s of out) {
    g.outTiles.push(...g.hands[s]); g.hands[s] = [];
    ev(g, 'eliminated', s);
    if (g.lastDiscardSeat === s) g.lastDiscardSeat = null;
  }
  const act = activeSeats(g);
  if (act.length <= 1) { finishMatch(g, act[0] ?? null, now); return; }
  if (out.includes(g.current)) {
    g.current = nextActive(g, g.current);
    g.phase = g.hands[g.current].length === 15 ? 'WAITING_FOR_DISCARD' : 'WAITING_FOR_DRAW';
    setDeadline(g, cfg, now);
  }
}

function finishMatch(g: GameState, winner: number | null, now: number) {
  g.phase = 'MATCH_FINISHED';
  g.winner = winner;
  g.turnDeadline = null; g.nextRoundAt = null;
  g.finishedAt = now;
  ev(g, 'match_end', winner);
}

export interface CloseCheck { ok: boolean; category?: CategoryKey; penalty?: number; formations?: Formation[]; error?: string }

/** Pure check (used by server, bots and client hints). */
export function checkClose(g: GameState, cfg: RoomConfig, seat: number, discardTile: number, requested?: CategoryKey): CloseCheck {
  const h = g.hands[seat];
  if (h.length !== 15) return { ok: false, error: 'need_15_tiles' };
  if (!h.includes(discardTile)) return { ok: false, error: 'not_owner' };
  const jokerDiscard = isRealJoker(discardTile, g.joker);
  if (jokerDiscard && !cfg.closeByJokerDiscard) return { ok: false, error: 'joker_discard_close_disabled' };
  const hand = h.filter((id) => id !== discardTile);
  const matches = detectWins(hand, g.joker, cfg);
  const win = chooseWin(matches, jokerDiscard, hand, g.joker, cfg, requested);
  if (!win) return { ok: false, error: matches.length ? 'category_not_matched' : 'invalid_hand' };
  return { ok: true, category: win.category, penalty: win.penalty, formations: win.formations };
}

export function close(g: GameState, cfg: RoomConfig, seat: number, discardTile: number, now: number, requested?: CategoryKey): RoundResult {
  assertTurn(g, seat, 'WAITING_FOR_DISCARD');
  g.phase = 'VALIDATING_CLOSE';
  const chk = checkClose(g, cfg, seat, discardTile, requested);
  if (!chk.ok) { g.phase = 'WAITING_FOR_DISCARD'; throw new GameError(chk.error!); }
  const h = g.hands[seat];
  h.splice(h.indexOf(discardTile), 1);
  g.discards[seat].push(discardTile);
  const jokerDiscard = isRealJoker(discardTile, g.joker);
  const before = g.seats.map((s) => s.score);
  const eliminated: number[] = [];
  for (const s of activeSeats(g)) {
    if (s === seat) continue;
    g.seats[s].score -= chk.penalty!;
    if (g.seats[s].score <= 0) { g.seats[s].score = 0; g.seats[s].status = 'ELIMINATED'; eliminated.push(s); }
  }
  const st = g.seats[seat].stats;
  st.roundsWon++; st.categories[chk.category!] = (st.categories[chk.category!] ?? 0) + 1;
  if (jokerDiscard) st.jokerCloses++;
  g.result = { kind: 'win', winner: seat, category: chk.category!, formations: chk.formations!, hand: h.slice(), discard: discardTile,
    jokerDiscard, penalty: chk.penalty!, before, after: g.seats.map((s) => s.score), eliminated };
  ev(g, 'close', seat, { tile: discardTile, data: { category: chk.category, penalty: chk.penalty, hand: h.slice() } });
  for (const s of eliminated) ev(g, 'eliminated', s);
  g.turnDeadline = null;
  if (activeSeats(g).length <= 1) finishMatch(g, seat, now);
  else { g.phase = 'ROUND_RESULT'; g.nextRoundAt = now + cfg.nextRoundSeconds * 1000; }
  g.version++;
  return g.result;
}

function endRoundDraw(g: GameState, cfg: RoomConfig, now: number) {
  const sc = g.seats.map((s) => s.score);
  g.result = { kind: 'draw', winner: null, category: null, formations: [], hand: [], discard: null, jokerDiscard: false, penalty: 0, before: sc, after: sc, eliminated: [] };
  g.pass = { active: false, by: null, turnsLeft: null, activations: 0, jokerId: null };
  g.phase = 'ROUND_RESULT';
  g.turnDeadline = null;
  g.nextRoundAt = now + cfg.nextRoundSeconds * 1000;
  ev(g, 'draw_round', null);
}

/** Tile conservation: every physical tile in exactly one location. */
export function tileLocations(g: GameState): Map<number, string> {
  const m = new Map<number, string>();
  const put = (id: number, loc: string) => { if (m.has(id)) throw new Error(`tile ${id} duplicated in ${m.get(id)} and ${loc}`); m.set(id, loc); };
  put(g.indicator, 'indicator');
  g.hands.forEach((h, s) => h.forEach((id) => put(id, `hand${s}`)));
  g.drawPile.forEach((id) => put(id, 'pile'));
  g.discards.forEach((d, s) => d.forEach((id) => put(id, `discard${s}`)));
  g.passArea.forEach((id) => put(id, 'pass'));
  g.outTiles.forEach((id) => put(id, 'out'));
  return m;
}

/** Freeze/unfreeze the authoritative timer. */
export function pause(g: GameState, now: number) {
  if (g.pausedRemaining !== null) return;
  g.pausedRemaining = g.turnDeadline !== null ? Math.max(0, g.turnDeadline - now) : -1;
  g.turnDeadline = null; g.version++;
}
export function resume(g: GameState, now: number) {
  if (g.pausedRemaining === null) return;
  g.turnDeadline = g.pausedRemaining >= 0 ? now + g.pausedRemaining : null;
  g.pausedRemaining = null; g.version++;
}

export { isRealJoker };
