/**
 * Per-seat filtered views. This is the ONLY game data that leaves the server.
 * Opponents' hands and the draw-pile order are never included (only counts).
 */
import { RoomConfig } from './config';
import { GameState, Phase, PublicEvent, RoundResult, canDeclareAtu, canPass, canTakeDiscard, prevActive, passBlocksSeat } from './game';
import { JokerInfo } from './tiles';

export interface PublicSeat { seat: number; name: string; isBot: boolean; score: number; status: string; tiles: number; discardCount: number; discardTop: number | null; stats: GameState['seats'][number]['stats'] }

export interface GameView {
  phase: Phase;
  version: number;
  round: number;
  current: number;
  starter: number;
  indicator: number;
  joker: JokerInfo;
  pile: number;
  pot: number;
  seats: PublicSeat[];
  /** full public discard histories (discarded tiles are public) */
  discards: number[][];
  lastDiscardSeat: number | null;
  pass: { active: boolean; by: number | null; turnsLeft: number | null; activations: number; tiles: number[] };
  atuDeclaredBy: number[];
  turnDeadline: number | null;
  paused: boolean;
  pausedRemaining: number | null;
  result: RoundResult | null;
  nextRoundAt: number | null;
  winner: number | null;
  events: PublicEvent[];
  startedAt: number;
  finishedAt: number | null;
  me: null | {
    seat: number;
    hand: number[];
    canTakeDiscard: boolean;
    canPass: boolean;
    canAtu: boolean;
    passBlocked: boolean;
    discardFrom: number;
  };
}

export function buildView(g: GameState, cfg: RoomConfig, seat: number | null): GameView {
  const me = seat !== null && g.seats[seat] && g.seats[seat].status === 'ACTIVE' ? {
    seat,
    hand: g.hands[seat].slice(),
    canTakeDiscard: canTakeDiscard(g, cfg, seat),
    canPass: canPass(g, cfg, seat),
    canAtu: canDeclareAtu(g, cfg, seat),
    passBlocked: passBlocksSeat(g, cfg, seat),
    discardFrom: prevActive(g, seat),
  } : null;
  // Result hands are revealed only for the winner (public winning reveal).
  return {
    phase: g.phase, version: g.version, round: g.round, current: g.current, starter: g.starter,
    indicator: g.indicator, joker: g.joker, pile: g.drawPile.length, pot: g.pot ?? 0,
    seats: g.seats.map((s) => ({ seat: s.seat, name: s.name, isBot: s.isBot, score: Math.max(0, s.score), status: s.status,
      tiles: g.hands[s.seat].length, discardCount: g.discards[s.seat].length, discardTop: g.discards[s.seat].at(-1) ?? null, stats: s.stats })),
    discards: g.discards.map((d) => d.slice()),
    lastDiscardSeat: g.lastDiscardSeat,
    pass: { active: g.pass.active, by: g.pass.by, turnsLeft: g.pass.turnsLeft, activations: g.pass.activations, tiles: g.passArea.slice() },
    atuDeclaredBy: g.atuDeclaredBy.slice(),
    turnDeadline: g.turnDeadline, paused: g.pausedRemaining !== null, pausedRemaining: g.pausedRemaining,
    result: g.result, nextRoundAt: g.nextRoundAt, winner: g.winner,
    // events never carry private tiles: draw_pile events have no tile
    events: g.events.slice(-12), startedAt: g.startedAt, finishedAt: g.finishedAt,
    me,
  };
}
