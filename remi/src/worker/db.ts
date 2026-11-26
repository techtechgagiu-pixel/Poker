import type { GameState } from '../engine/game';
import type { RoomConfig } from '../engine/config';

export interface Env {
  ROOM: DurableObjectNamespace;
  DB: D1Database;
  BACKUPS?: R2Bucket;
  STATIC: R2Bucket;
  ADMIN_EMAILS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ENVIRONMENT?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
  JOIN_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

const CAT_COL: Record<string, string> = { normalJoker: 'normal_joker', normalPlain: 'normal_plain', sequences: 'sequences', triples: 'triples', doubles: 'doubles', color: 'color', grand: 'grand' };

export interface RecordInput {
  id: string; code: string; mode: 'human' | 'bots' | 'training'; game: GameState; config: RoomConfig;
  players: ({ key: string | null; registered: boolean } | null)[]; hostKey: string | null;
  tournament: { id: string; matchId: string } | null;
}

/** Idempotent: the match row is inserted first with INSERT OR IGNORE; stats only update if it was new. */
export async function recordMatch(env: Env, x: RecordInput) {
  const g = x.game;
  const humans = x.players.filter(Boolean).length;
  const mode = x.mode === 'training' ? 'training' : humans >= 2 ? 'human' : 'bots';
  const winnerKey = g.winner !== null ? x.players[g.winner]?.key ?? null : null;
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO matches (id, room_code, match_no, mode, started_at, finished_at, rounds, winner_key, winner_name, config_json, humans, tournament_id, tournament_match_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(x.id, x.code, Number(x.id.split('-').pop()), mode, g.startedAt, g.finishedAt ?? Date.now(), g.round, winnerKey, g.winner !== null ? g.seats[g.winner].name : null,
      JSON.stringify(x.config), humans, x.tournament?.id ?? null, x.tournament?.matchId ?? null).run();
  if (!ins.meta.changes) return; // already recorded
  // ranking: winner first, then by score, eliminated later by elimination order (score 0)
  const order = g.seats.map((s) => s.seat).sort((a, b) => (a === g.winner ? -1 : b === g.winner ? 1 : g.seats[b].score - g.seats[a].score));
  const stmts: D1PreparedStatement[] = [];
  // "Prietenii la joc": a registered player who completed a match with three registered friends
  const reg = x.players.map((p) => (p?.registered && p.key?.startsWith('u:') ? p.key.slice(2) : null));
  const friendCount = new Map<string, number>();
  const ids = reg.filter((r): r is string => !!r);
  if (ids.length >= 4) {
    const fr = await env.DB.prepare(`SELECT user_a, user_b FROM friendships WHERE status = 'accepted' AND user_a IN (${ids.map(() => '?').join(',')}) AND user_b IN (${ids.map(() => '?').join(',')})`).bind(...ids, ...ids).all<{ user_a: string; user_b: string }>();
    for (const f of fr.results) { friendCount.set(f.user_a, (friendCount.get(f.user_a) ?? 0) + 1); friendCount.set(f.user_b, (friendCount.get(f.user_b) ?? 0) + 1); }
  }
  for (const s of g.seats) {
    const p = x.players[s.seat];
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO match_players VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(x.id, s.seat, p?.key ?? null, s.name, s.isBot ? 1 : 0,
      Math.max(0, s.score), order.indexOf(s.seat) + 1, s.stats.roundsWon, JSON.stringify(s.stats.categories), s.stats.jokerCloses, s.stats.passActivations, s.stats.atuDeclarations));
    if (!p?.key) continue;
    const won = g.winner === s.seat ? 1 : 0;
    const cats = Object.entries(s.stats.categories);
    const catSql = cats.map(([k]) => `, ${CAT_COL[k]} = ${CAT_COL[k]} + ?`).join('');
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO player_stats (player_key, mode) VALUES (?, ?)').bind(p.key, mode));
    stmts.push(env.DB.prepare(`UPDATE player_stats SET matches = matches + 1, wins = wins + ?, losses = losses + ?, rounds_won = rounds_won + ?,
      joker_closes = joker_closes + ?, pass_activations = pass_activations + ?, atu_declarations = atu_declarations + ?,
      current_streak = CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END,
      best_streak = MAX(best_streak, CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END),
      hosted = hosted + ?, full_tables = full_tables + ?, friend_tables = friend_tables + ? ${catSql} WHERE player_key = ? AND mode = ?`)
      .bind(won, 1 - won, s.stats.roundsWon, s.stats.jokerCloses, s.stats.passActivations, s.stats.atuDeclarations, won, won,
        p.key === x.hostKey ? 1 : 0, humans === 4 ? 1 : 0, (friendCount.get(p.key.slice(2)) ?? 0) >= 3 ? 1 : 0, ...cats.map(([, v]) => v), p.key, mode));
  }
  await env.DB.batch(stmts);
  for (const p of x.players) if (p?.key) await awardAchievements(env, p.key);
  if (x.tournament) {
    const { applyTournamentResult } = await import('./social');
    await applyTournamentResult(env, x.tournament, g, x.players.map((p) => p?.key ?? null));
  }
}

/** Award achievements from verified server-side stats. Primary key prevents duplicates. */
export async function awardAchievements(env: Env, key: string): Promise<{ key: string; tier: string }[]> {
  const rows = await env.DB.prepare('SELECT * FROM player_stats WHERE player_key = ?').bind(key).all<any>();
  const ach = await env.DB.prepare('SELECT * FROM achievements').all<any>();
  const out: { key: string; tier: string }[] = [];
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const a of ach.results) {
    const pool = rows.results.filter((r) => a.mode === 'any' ? r.mode !== 'training' : r.mode === a.mode);
    const val = pool.reduce((s, r) => (a.stat === 'best_streak' ? Math.max(s, r[a.stat] ?? 0) : s + (r[a.stat] ?? 0)), 0);
    if (val >= a.threshold) { stmts.push(env.DB.prepare('INSERT OR IGNORE INTO user_achievements VALUES (?,?,?,?)').bind(key, a.key, a.tier, now)); out.push({ key: a.key, tier: a.tier }); }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return out;
}

export async function logError(env: Env, source: string, code: string, detail: string) {
  try { await env.DB.prepare('INSERT INTO error_log (ts, source, code, detail) VALUES (?,?,?,?)').bind(Date.now(), source, code, detail.slice(0, 500)).run(); } catch { /* ignore */ }
}
