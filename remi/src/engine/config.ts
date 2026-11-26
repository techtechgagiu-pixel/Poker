/** Room / match configuration. Every scoring value lives here — never in the validator. */
export type CategoryKey = 'normalJoker' | 'normalPlain' | 'sequences' | 'triples' | 'doubles' | 'color' | 'grand';
export const CATEGORY_KEYS: CategoryKey[] = ['normalJoker', 'normalPlain', 'sequences', 'triples', 'doubles', 'color', 'grand'];

export interface CategoryConfig {
  enabled: boolean;
  /** Standard penalty applied to every other active player. */
  penalty: number;
  /** Penalty when the winner discards a real joker as the 15th tile. */
  jokerPenalty: number;
  /** Whether real jokers may act as wildcards in this category (ignored for normalJoker). */
  allowJokers: boolean;
}

export type PassDuration = { kind: 'round' } | { kind: 'rotation' } | { kind: 'turns'; turns: number };

export interface RoomConfig {
  startingScore: number;
  /** seconds; 0 = unlimited */
  turnSeconds: number;
  categories: Record<CategoryKey, CategoryConfig>;
  /** If empty -> pick the matching category with the highest applicable penalty. */
  priority: CategoryKey[];
  closeByJokerDiscard: boolean;
  highAce: boolean;
  /** Two real jokers may form one pair in Doubles. */
  doubleJokerPair: boolean;
  /** Triples-only: allow 4-tile sets (required for 14 tiles: 3+3+4+4). */
  triplesAllowFour: boolean;
  jokerMultiplier: { enabled: boolean; factorPerJoker: number };
  pass: {
    enabled: boolean;
    duration: PassDuration;
    affectsActivator: boolean;
    maxPerRound: number;
    /** Score change applied to the activator (negative = penalty, positive = reward). */
    activatorScoreDelta: number;
  };
  atu: { enabled: boolean; penalty: number; oncePerRound: boolean };
  bots: { fillEmpty: boolean; difficulty: 'easy' | 'medium' | 'hard' };
  spectators: boolean;
  chat: boolean;
  voice: boolean;
  video: boolean;
  reconnectGraceSeconds: number;
  botTakeover: boolean;
  nextRoundSeconds: number;
  confirmJokerDiscard: boolean;
  pauseVote: { enabled: boolean; voteSeconds: number; maxPauseSeconds: number; maxPerPlayer: number };
  /** Training rooms: assistant hints allowed, stats separate. Forced false in competitive rooms. */
  training: boolean;
  /** The points lost by the opponents are added to the player who closed. */
  winnerCollects: boolean;
  /**
   * Colț (corner pot): on every redeal after a draw (agreed or exhausted pile) each active player puts `amount` aside.
   * The whole pot goes to a player who closes with an eligible special.
   */
  corner: { enabled: boolean; amount: number; jokerClose: boolean; color: boolean; doubles: boolean; pass: boolean; grand: boolean };
  /** Players may end the current round as a draw by unanimous vote. */
  drawVote: boolean;
  /** Room appears in the public "live tables" list (spectating only; hands stay hidden). */
  listed: boolean;
}

export const DEFAULT_CATEGORIES: Record<CategoryKey, CategoryConfig> = {
  normalJoker: { enabled: true, penalty: 5, jokerPenalty: 20, allowJokers: true },
  normalPlain: { enabled: true, penalty: 10, jokerPenalty: 20, allowJokers: true },
  sequences: { enabled: true, penalty: 10, jokerPenalty: 20, allowJokers: true },
  triples: { enabled: true, penalty: 10, jokerPenalty: 20, allowJokers: true },
  doubles: { enabled: true, penalty: 15, jokerPenalty: 30, allowJokers: true },
  color: { enabled: true, penalty: 15, jokerPenalty: 30, allowJokers: true },
  grand: { enabled: true, penalty: 30, jokerPenalty: 60, allowJokers: true },
};

export function defaultConfig(): RoomConfig {
  return {
    startingScore: 100,
    turnSeconds: 30,
    categories: structuredClone(DEFAULT_CATEGORIES),
    priority: [],
    closeByJokerDiscard: true,
    highAce: true,
    doubleJokerPair: true,
    triplesAllowFour: true,
    jokerMultiplier: { enabled: false, factorPerJoker: 2 },
    pass: { enabled: true, duration: { kind: 'round' }, affectsActivator: true, maxPerRound: 1, activatorScoreDelta: 0 },
    atu: { enabled: true, penalty: 1, oncePerRound: true },
    bots: { fillEmpty: true, difficulty: 'medium' },
    spectators: true,
    chat: true,
    voice: true,
    video: true,
    reconnectGraceSeconds: 15,
    botTakeover: true,
    nextRoundSeconds: 8,
    confirmJokerDiscard: true,
    pauseVote: { enabled: true, voteSeconds: 15, maxPauseSeconds: 300, maxPerPlayer: 2 },
    training: false,
    winnerCollects: true,
    corner: { enabled: true, amount: 5, jokerClose: true, color: true, doubles: true, pass: true, grand: false },
    drawVote: true,
    listed: true,
  };
}

export type PresetKey = 'remyPro' | 'classic' | 'fast' | 'normalOnly';
export function preset(key: PresetKey): RoomConfig {
  const c = defaultConfig();
  if (key === 'classic') {
    c.pass.enabled = false; c.atu.enabled = true;
    for (const k of ['sequences', 'triples', 'color', 'grand'] as CategoryKey[]) c.categories[k].enabled = false;
  } else if (key === 'fast') {
    c.turnSeconds = 15; c.startingScore = 50; c.nextRoundSeconds = 5;
  } else if (key === 'normalOnly') {
    for (const k of CATEGORY_KEYS) c.categories[k].enabled = k === 'normalJoker' || k === 'normalPlain';
  }
  return c;
}

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d;
  return Math.min(hi, Math.max(lo, n));
};
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Sanitise an untrusted config coming from a client. Unknown keys are dropped; values are clamped. */
export function sanitizeConfig(input: unknown): RoomConfig {
  const d = defaultConfig();
  const i = (input && typeof input === 'object' ? input : {}) as any;
  const out = defaultConfig();
  out.startingScore = clampInt(i.startingScore, 1, 10000, d.startingScore);
  out.turnSeconds = clampInt(i.turnSeconds, 0, 600, d.turnSeconds);
  if (out.turnSeconds !== 0 && out.turnSeconds < 5) out.turnSeconds = 5;
  for (const k of CATEGORY_KEYS) {
    const s = i.categories?.[k] ?? {};
    out.categories[k] = {
      enabled: bool(s.enabled, d.categories[k].enabled),
      penalty: clampInt(s.penalty, 0, 10000, d.categories[k].penalty),
      jokerPenalty: clampInt(s.jokerPenalty, 0, 10000, d.categories[k].jokerPenalty),
      allowJokers: bool(s.allowJokers, d.categories[k].allowJokers),
    };
  }
  out.priority = Array.isArray(i.priority) ? [...new Set(i.priority.filter((x: any) => CATEGORY_KEYS.includes(x)))] as CategoryKey[] : [];
  out.closeByJokerDiscard = bool(i.closeByJokerDiscard, d.closeByJokerDiscard);
  out.highAce = bool(i.highAce, d.highAce);
  out.doubleJokerPair = bool(i.doubleJokerPair, d.doubleJokerPair);
  out.triplesAllowFour = bool(i.triplesAllowFour, d.triplesAllowFour);
  out.jokerMultiplier = { enabled: bool(i.jokerMultiplier?.enabled, false), factorPerJoker: clampInt(i.jokerMultiplier?.factorPerJoker, 1, 10, 2) };
  const p = i.pass ?? {};
  let duration: PassDuration = { kind: 'round' };
  if (p.duration?.kind === 'rotation') duration = { kind: 'rotation' };
  else if (p.duration?.kind === 'turns') duration = { kind: 'turns', turns: clampInt(p.duration.turns, 1, 200, 4) };
  out.pass = {
    enabled: bool(p.enabled, d.pass.enabled), duration,
    affectsActivator: bool(p.affectsActivator, d.pass.affectsActivator),
    maxPerRound: clampInt(p.maxPerRound, 1, 10, 1),
    activatorScoreDelta: clampInt(p.activatorScoreDelta, -1000, 1000, 0),
  };
  out.atu = { enabled: bool(i.atu?.enabled, d.atu.enabled), penalty: clampInt(i.atu?.penalty, 0, 1000, 1), oncePerRound: bool(i.atu?.oncePerRound, true) };
  const diff = ['easy', 'medium', 'hard'].includes(i.bots?.difficulty) ? i.bots.difficulty : d.bots.difficulty;
  out.bots = { fillEmpty: bool(i.bots?.fillEmpty, d.bots.fillEmpty), difficulty: diff };
  out.spectators = bool(i.spectators, d.spectators);
  out.chat = bool(i.chat, d.chat);
  out.voice = bool(i.voice, d.voice);
  out.video = bool(i.video, d.video);
  out.reconnectGraceSeconds = clampInt(i.reconnectGraceSeconds, 5, 600, d.reconnectGraceSeconds);
  out.botTakeover = bool(i.botTakeover, d.botTakeover);
  out.nextRoundSeconds = clampInt(i.nextRoundSeconds, 3, 120, d.nextRoundSeconds);
  out.confirmJokerDiscard = bool(i.confirmJokerDiscard, d.confirmJokerDiscard);
  const pv = i.pauseVote ?? {};
  out.pauseVote = {
    enabled: bool(pv.enabled, true), voteSeconds: clampInt(pv.voteSeconds, 5, 120, 15),
    maxPauseSeconds: clampInt(pv.maxPauseSeconds, 30, 3600, 300), maxPerPlayer: clampInt(pv.maxPerPlayer, 0, 20, 2),
  };
  out.training = bool(i.training, false);
  out.winnerCollects = bool(i.winnerCollects, d.winnerCollects);
  const co = i.corner ?? {};
  out.corner = { enabled: bool(co.enabled, d.corner.enabled), amount: clampInt(co.amount, 0, 1000, d.corner.amount),
    jokerClose: bool(co.jokerClose, d.corner.jokerClose), color: bool(co.color, d.corner.color), doubles: bool(co.doubles, d.corner.doubles),
    pass: bool(co.pass, d.corner.pass), grand: bool(co.grand, d.corner.grand) };
  out.drawVote = bool(i.drawVote, d.drawVote);
  out.listed = bool(i.listed, d.listed);
  return out;
}

export function anyCategoryEnabled(c: RoomConfig): boolean {
  return CATEGORY_KEYS.some((k) => c.categories[k].enabled);
}
