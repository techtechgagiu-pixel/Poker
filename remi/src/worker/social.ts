/** Profiles, friends, notifications, leaderboards and private tournaments (D1). */
import type { Env } from './db';
import { awardAchievements } from './db';
import { json, randomToken, sha256 } from './util';
import { sanitizeConfig, defaultConfig } from '../engine/config';
import type { GameState } from '../engine/game';

export interface Identity { userId: string | null; playerKey: string | null; registered: boolean; nickname?: string }

const SESSION_DAYS = 30;
const now = () => Date.now();
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;
const AVATARS = ['🦊', '🐻', '🦁', '🐯', '🐼', '🐸', '🦉', '🐺', '🦅', '🐙', '🎩', '👑', '⭐', '🍀', '🎲', '♠️'];

export async function identify(req: Request, env: Env): Promise<Identity> {
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ') && env.DB) {
    const th = await sha256(auth.slice(7));
    const row = await env.DB.prepare('SELECT s.user_id, u.nickname, u.suspended FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
      .bind(th, now()).first<{ user_id: string; nickname: string; suspended: number }>();
    if (row && !row.suspended) return { userId: row.user_id, playerKey: 'u:' + row.user_id, registered: true, nickname: row.nickname };
  }
  const guest = req.headers.get('x-guest') ?? '';
  if (guest.length >= 20 && guest.length <= 100) return { userId: null, playerKey: 'g:' + (await sha256('guest:' + guest)).slice(0, 32), registered: false };
  return { userId: null, playerKey: null, registered: false };
}

function bad(code: string, status = 400) { return json({ error: code }, { status }); }
async function body(req: Request): Promise<any> { try { return await req.json(); } catch { return {}; } }
const clean = (s: unknown, max = 40) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

async function newSession(env: Env, userId: string) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(await sha256(token), userId, now(), now() + SESSION_DAYS * 864e5).run();
  return token;
}

async function linkGuest(env: Env, req: Request, userId: string) {
  // verified ownership: the caller presents the guest secret itself
  const guest = req.headers.get('x-guest') ?? '';
  if (guest.length < 20) return;
  const gh = (await sha256('guest:' + guest)).slice(0, 32);
  const gk = 'g:' + gh; const uk = 'u:' + userId;
  const owned = await env.DB.prepare('SELECT user_id FROM guests WHERE guest_hash = ?').bind(gh).first<{ user_id: string | null }>();
  if (owned?.user_id && owned.user_id !== userId) return; // already linked to someone else
  await env.DB.prepare('INSERT INTO guests VALUES (?,?,?) ON CONFLICT(guest_hash) DO UPDATE SET user_id = excluded.user_id').bind(gh, userId, now()).run();
  const rows = await env.DB.prepare('SELECT * FROM player_stats WHERE player_key = ?').bind(gk).all<any>();
  const cols = ['matches', 'wins', 'losses', 'rounds_won', 'normal_joker', 'normal_plain', 'sequences', 'triples', 'doubles', 'color', 'grand', 'joker_closes', 'pass_activations', 'atu_declarations', 'hosted', 'full_tables', 'tournaments_won', 'friend_tables'];
  const st: D1PreparedStatement[] = [];
  for (const r of rows.results) {
    st.push(env.DB.prepare('INSERT OR IGNORE INTO player_stats (player_key, mode) VALUES (?,?)').bind(uk, r.mode));
    st.push(env.DB.prepare(`UPDATE player_stats SET ${cols.map((c) => `${c} = ${c} + ?`).join(', ')}, best_streak = MAX(best_streak, ?) WHERE player_key = ? AND mode = ?`)
      .bind(...cols.map((c) => r[c] ?? 0), r.best_streak ?? 0, uk, r.mode));
  }
  st.push(env.DB.prepare('DELETE FROM player_stats WHERE player_key = ?').bind(gk));
  st.push(env.DB.prepare('UPDATE match_players SET player_key = ? WHERE player_key = ?').bind(uk, gk));
  st.push(env.DB.prepare('UPDATE OR IGNORE user_achievements SET player_key = ? WHERE player_key = ?').bind(uk, gk));
  await env.DB.batch(st);
  await awardAchievements(env, uk);
}

export async function blocked(env: Env, a: string, b: string) {
  const r = await env.DB.prepare('SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)').bind(a, b, b, a).first();
  return !!r;
}
async function areFriends(env: Env, a: string, b: string) {
  const [x, y] = [a, b].sort();
  return !!(await env.DB.prepare("SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'accepted'").bind(x, y).first());
}
function privacy(u: any) { const p = JSON.parse(u.privacy_json || '{}'); return { showOnline: p.showOnline ?? 'friends', friendRequests: p.friendRequests ?? 'everyone', invites: p.invites ?? 'friends', profile: p.profile ?? 'friends' }; }
function prefs(u: any) { return JSON.parse(u.prefs_json || '{}'); }

export async function notify(env: Env, userId: string, kind: string, payload: any, dedupe: string) {
  const u = await env.DB.prepare('SELECT prefs_json FROM users WHERE id = ?').bind(userId).first<any>();
  if (!u) return;
  const n = prefs(u).notify ?? {};
  const optIn: Record<string, boolean> = { friendRoom: n.friendRoom ?? false, invite: n.invite ?? true, friendOnline: n.friendOnline ?? false, friendRequest: n.friendRequest ?? true, savedReady: n.savedReady ?? true, tournament: n.tournament ?? true };
  if (optIn[kind] === false) return;
  // frequency limit: max 30 notifications per user per hour
  const c = await env.DB.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND created_at > ?').bind(userId, now() - 3600e3).first<{ c: number }>();
  if ((c?.c ?? 0) >= 30) return;
  await env.DB.prepare('INSERT OR IGNORE INTO notifications VALUES (?,?,?,?,?,NULL,?)').bind(crypto.randomUUID(), userId, kind, JSON.stringify(payload), now(), dedupe).run();
}

/** Called when a registered user creates a room with announce enabled. */
export async function announceRoom(env: Env, userId: string, nickname: string, code: string) {
  const fr = await env.DB.prepare("SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS f FROM friendships WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'").bind(userId, userId, userId).all<{ f: string }>();
  for (const { f } of fr.results) if (!(await blocked(env, userId, f))) await notify(env, f, 'friendRoom', { from: nickname, code, text: `${nickname} a creat o masă de Remi. Intră în joc!` }, `room:${code}:${f}`);
}

export async function socialApi(req: Request, env: Env, path: string, id: Identity): Promise<Response | null> {
  const m = req.method;
  // ---------------- auth
  if (path === '/api/auth/register' && m === 'POST') {
    const b = await body(req);
    const username = String(b.username ?? '').trim();
    if (!USERNAME_RE.test(username)) return bad('bad_username');
    const nickname = clean(b.nickname || username, 20);
    if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) return bad('username_taken', 409);
    const userId = crypto.randomUUID();
    const recovery = randomToken(18);
    await env.DB.prepare('INSERT INTO users (id, username, nickname, avatar, recovery_hash, created_at, prefs_json, privacy_json) VALUES (?,?,?,?,?,?,?,?)')
      .bind(userId, username, nickname, AVATARS[0], await sha256('recovery:' + recovery), now(), '{}', '{}').run();
    await linkGuest(env, req, userId);
    return json({ token: await newSession(env, userId), recoveryKey: recovery, userId });
  }
  if (path === '/api/auth/login' && m === 'POST') {
    const b = await body(req);
    const u = await env.DB.prepare('SELECT id, recovery_hash, suspended FROM users WHERE username = ?').bind(String(b.username ?? '')).first<any>();
    const ok = u && u.recovery_hash === (await sha256('recovery:' + String(b.recoveryKey ?? '')));
    if (!ok) return bad('invalid_credentials', 401);
    if (u.suspended) return bad('suspended', 403);
    await linkGuest(env, req, u.id);
    return json({ token: await newSession(env, u.id), userId: u.id });
  }
  if (path === '/api/auth/logout' && m === 'POST') {
    const auth = req.headers.get('authorization') ?? '';
    if (auth.startsWith('Bearer ')) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(auth.slice(7))).run();
    return json({ ok: true });
  }
  if (path.startsWith('/api/me') || path.startsWith('/api/friends') || path.startsWith('/api/notifications') || path.startsWith('/api/invite') || path === '/api/users/search' || path === '/api/presence' || path === '/api/auth/rotate') {
    if (!id.userId) return bad('login_required', 401);
  }
  const uid = id.userId!;
  if (path === '/api/auth/rotate' && m === 'POST') {
    const recovery = randomToken(18);
    await env.DB.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').bind(await sha256('recovery:' + recovery), uid).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid).run();
    return json({ recoveryKey: recovery, token: await newSession(env, uid) });
  }
  if (path === '/api/me' && m === 'GET') {
    const u = await env.DB.prepare('SELECT id, username, nickname, avatar, lang, prefs_json, privacy_json, created_at FROM users WHERE id = ?').bind(uid).first<any>();
    const ach = await env.DB.prepare('SELECT key, tier, earned_at FROM user_achievements WHERE player_key = ? ORDER BY earned_at DESC').bind('u:' + uid).all();
    return json({ ...u, prefs: prefs(u), privacy: privacy(u), achievements: ach.results, avatars: AVATARS });
  }
  if (path === '/api/me' && m === 'PUT') {
    const b = await body(req);
    const sets: string[] = []; const vals: any[] = [];
    if (b.nickname !== undefined) { sets.push('nickname = ?'); vals.push(clean(b.nickname, 20) || 'Jucător'); }
    if (b.avatar !== undefined && AVATARS.includes(b.avatar)) { sets.push('avatar = ?'); vals.push(b.avatar); } // no uploads: curated avatars only
    if (b.lang === 'ro' || b.lang === 'en') { sets.push('lang = ?'); vals.push(b.lang); }
    if (b.prefs && typeof b.prefs === 'object') { const s = JSON.stringify(b.prefs); if (s.length < 4000) { sets.push('prefs_json = ?'); vals.push(s); } }
    if (b.privacy && typeof b.privacy === 'object') {
      const p = { showOnline: ['everyone', 'friends', 'nobody'].includes(b.privacy.showOnline) ? b.privacy.showOnline : 'friends',
        friendRequests: ['everyone', 'nobody'].includes(b.privacy.friendRequests) ? b.privacy.friendRequests : 'everyone',
        invites: ['friends', 'nobody'].includes(b.privacy.invites) ? b.privacy.invites : 'friends',
        profile: ['everyone', 'friends', 'nobody'].includes(b.privacy.profile) ? b.privacy.profile : 'friends' };
      sets.push('privacy_json = ?'); vals.push(JSON.stringify(p));
    }
    if (sets.length) await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, uid).run();
    return json({ ok: true });
  }
  if (path === '/api/me' && m === 'DELETE') {
    const k = 'u:' + uid;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid), env.DB.prepare('DELETE FROM friendships WHERE user_a = ? OR user_b = ?').bind(uid, uid),
      env.DB.prepare('DELETE FROM blocks WHERE user_id = ? OR blocked_id = ?').bind(uid, uid), env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(uid),
      env.DB.prepare('DELETE FROM player_stats WHERE player_key = ?').bind(k), env.DB.prepare('DELETE FROM user_achievements WHERE player_key = ?').bind(k),
      env.DB.prepare('UPDATE match_players SET player_key = NULL WHERE player_key = ?').bind(k), env.DB.prepare('UPDATE guests SET user_id = NULL WHERE user_id = ?').bind(uid),
      env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(uid), env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid),
    ]);
    return json({ ok: true });
  }
  if (path === '/api/me/export' && m === 'GET') {
    const k = 'u:' + uid;
    const [u, st, mp, ach, fr] = await Promise.all([
      env.DB.prepare('SELECT id, username, nickname, avatar, lang, prefs_json, privacy_json, created_at FROM users WHERE id = ?').bind(uid).first(),
      env.DB.prepare('SELECT * FROM player_stats WHERE player_key = ?').bind(k).all(),
      env.DB.prepare('SELECT * FROM match_players WHERE player_key = ?').bind(k).all(),
      env.DB.prepare('SELECT * FROM user_achievements WHERE player_key = ?').bind(k).all(),
      env.DB.prepare('SELECT * FROM friendships WHERE user_a = ? OR user_b = ?').bind(uid, uid).all(),
    ]);
    return json({ exportedAt: now(), user: u, stats: st.results, matches: mp.results, achievements: ach.results, friendships: fr.results });
  }
  // ---------------- presence & search
  if (path === '/api/presence' && m === 'POST') {
    const b = await body(req);
    const status = ['online', 'available', 'lobby', 'playing', 'dnd'].includes(b.status) ? b.status : 'online';
    await env.DB.prepare('UPDATE users SET last_seen = ?, presence = ? WHERE id = ?').bind(now(), status, uid).run();
    return json({ ok: true });
  }
  if (path === '/api/users/search' && m === 'GET') {
    const q = new URL(req.url).searchParams.get('q') ?? '';
    if (q.length < 2) return json({ users: [] });
    const rows = await env.DB.prepare("SELECT id, username, nickname, avatar, privacy_json FROM users WHERE username LIKE ? ESCAPE '\\' AND id != ? AND suspended = 0 LIMIT 15")
      .bind(q.replace(/[\\%_]/g, (c) => '\\' + c) + '%', uid).all<any>();
    const users = [];
    for (const r of rows.results) if (privacy(r).friendRequests === 'everyone' && !(await blocked(env, uid, r.id))) users.push({ id: r.id, username: r.username, nickname: r.nickname, avatar: r.avatar });
    return json({ users });
  }
  // ---------------- friends
  if (path === '/api/friends' && m === 'GET') {
    const rows = await env.DB.prepare(`SELECT f.*, u.id AS uid, u.username, u.nickname, u.avatar, u.last_seen, u.presence, u.privacy_json FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END WHERE (f.user_a = ? OR f.user_b = ?)`).bind(uid, uid, uid).all<any>();
    const list = rows.results.filter((r) => r.status === 'accepted' || !r.expires_at || r.expires_at > now()).map((r) => {
      const pv = privacy(r); const visible = pv.showOnline !== 'nobody';
      const online = visible && r.last_seen && now() - r.last_seen < 90e3;
      return { id: r.uid, username: r.username, nickname: r.nickname, avatar: r.avatar, status: r.status,
        direction: r.status === 'pending' ? (r.requested_by === uid ? 'outgoing' : 'incoming') : null,
        presence: r.status === 'accepted' ? (online ? r.presence ?? 'online' : 'offline') : null };
    });
    const bl = await env.DB.prepare('SELECT b.blocked_id AS id, u.username FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ?').bind(uid).all();
    return json({ friends: list, blocked: bl.results });
  }
  if (path === '/api/friends/request' && m === 'POST') {
    const b = await body(req);
    const t = await env.DB.prepare('SELECT id, privacy_json FROM users WHERE username = ? AND suspended = 0').bind(String(b.username ?? '')).first<any>();
    if (!t || t.id === uid) return bad('user_not_found', 404);
    if (await blocked(env, uid, t.id)) return bad('user_not_found', 404); // do not reveal blocks
    if (privacy(t).friendRequests === 'nobody') return bad('requests_disabled', 403);
    const pending = await env.DB.prepare("SELECT COUNT(*) AS c FROM friendships WHERE requested_by = ? AND status = 'pending' AND expires_at > ?").bind(uid, now()).first<{ c: number }>();
    if ((pending?.c ?? 0) >= 20) return bad('too_many_requests', 429);
    const [a, c] = [uid, t.id].sort();
    const ex = await env.DB.prepare('SELECT status, expires_at FROM friendships WHERE user_a = ? AND user_b = ?').bind(a, c).first<any>();
    if (ex && (ex.status === 'accepted' || ex.expires_at > now())) return bad('already_exists', 409);
    await env.DB.prepare('INSERT OR REPLACE INTO friendships VALUES (?,?,?,?,?,?)').bind(a, c, 'pending', uid, now(), now() + 14 * 864e5).run();
    await notify(env, t.id, 'friendRequest', { from: id.nickname, text: `${id.nickname} ți-a trimis o cerere de prietenie.` }, `fr:${uid}:${t.id}:${Math.floor(now() / 864e5)}`);
    return json({ ok: true });
  }
  if (path === '/api/friends/respond' && m === 'POST') {
    const b = await body(req); const other = String(b.userId ?? '');
    const [a, c] = [uid, other].sort();
    const ex = await env.DB.prepare("SELECT requested_by FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'pending' AND expires_at > ?").bind(a, c, now()).first<any>();
    if (!ex || ex.requested_by === uid) return bad('no_request', 404);
    if (b.accept) await env.DB.prepare("UPDATE friendships SET status = 'accepted', expires_at = NULL WHERE user_a = ? AND user_b = ?").bind(a, c).run();
    else await env.DB.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').bind(a, c).run();
    return json({ ok: true });
  }
  if (path === '/api/friends/remove' && m === 'POST') {
    const b = await body(req); const [a, c] = [uid, String(b.userId ?? '')].sort();
    await env.DB.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').bind(a, c).run();
    return json({ ok: true });
  }
  if (path === '/api/friends/block' && m === 'POST') {
    const b = await body(req); const other = String(b.userId ?? ''); const [a, c] = [uid, other].sort();
    if (b.unblock) { await env.DB.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').bind(uid, other).run(); return json({ ok: true }); }
    await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO blocks VALUES (?,?,?)').bind(uid, other, now()), env.DB.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').bind(a, c)]);
    return json({ ok: true });
  }
  if (path === '/api/invite' && m === 'POST') {
    const b = await body(req); const to = String(b.userId ?? ''); const code = String(b.code ?? '').toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return bad('bad_code');
    if (!(await areFriends(env, uid, to)) || (await blocked(env, uid, to))) return bad('not_friends', 403);
    const t = await env.DB.prepare('SELECT privacy_json FROM users WHERE id = ?').bind(to).first<any>();
    if (privacy(t).invites === 'nobody') return bad('invites_disabled', 403);
    await notify(env, to, 'invite', { from: id.nickname, code, text: `${id.nickname} te invită la masa ${code}.` }, `inv:${uid}:${to}:${code}`);
    return json({ ok: true });
  }
  if (path === '/api/notifications' && m === 'GET') {
    const rows = await env.DB.prepare('SELECT id, kind, payload_json, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').bind(uid).all<any>();
    return json({ notifications: rows.results.map((r) => ({ ...r, payload: JSON.parse(r.payload_json), payload_json: undefined })) });
  }
  if (path === '/api/notifications/read' && m === 'POST') {
    await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(now(), uid).run();
    return json({ ok: true });
  }
  // ---------------- stats & leaderboard (guests allowed for own stats)
  if (path === '/api/stats' && m === 'GET') {
    if (!id.playerKey) return json({ stats: [], achievements: [] });
    const st = await env.DB.prepare('SELECT * FROM player_stats WHERE player_key = ?').bind(id.playerKey).all();
    const ach = await env.DB.prepare('SELECT key, tier, earned_at FROM user_achievements WHERE player_key = ?').bind(id.playerKey).all();
    const recent = await env.DB.prepare('SELECT m.id, m.finished_at, m.mode, m.rounds, m.winner_name, mp.rank, mp.final_score FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.player_key = ? ORDER BY m.finished_at DESC LIMIT 20').bind(id.playerKey).all();
    const defs = await env.DB.prepare('SELECT * FROM achievements').all();
    return json({ stats: st.results, achievements: ach.results, recent: recent.results, definitions: defs.results });
  }
  if (path === '/api/leaderboard' && m === 'GET') {
    if (!id.userId) return bad('login_required', 401);
    const sp = new URL(req.url).searchParams;
    const period = sp.get('period') ?? 'all';
    const mode = sp.get('mode') ?? 'human';
    const minMatches = Math.max(1, Math.min(100, Number(sp.get('min') ?? 3) || 3));
    let from = 0; let to = now() + 1;
    if (period === 'week') from = now() - 7 * 864e5;
    if (period === 'month') { const d = new Date(); from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
    if (period === 'custom') { from = Number(sp.get('from')) || 0; to = Number(sp.get('to')) || to; }
    const fr = await env.DB.prepare("SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS f FROM friendships WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'").bind(uid, uid, uid).all<{ f: string }>();
    const ids = [uid, ...fr.results.map((r) => r.f)];
    const keys = ids.map((x) => 'u:' + x);
    const modeSql = mode === 'tournament' ? 'm.tournament_id IS NOT NULL' : 'm.mode = ? AND m.tournament_id IS NULL';
    const rows = await env.DB.prepare(`SELECT mp.player_key, mp.rank, mp.rounds_won, mp.categories_json, mp.joker_closes, mp.pass_activations, mp.atu_declarations, m.finished_at
      FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.player_key IN (${keys.map(() => '?').join(',')}) AND m.finished_at >= ? AND m.finished_at < ? AND ${modeSql} ORDER BY m.finished_at`)
      .bind(...keys, from, to, ...(mode === 'tournament' ? [] : [mode])).all<any>();
    const users = await env.DB.prepare(`SELECT id, nickname, username, avatar FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<any>();
    const board = users.results.map((u) => {
      const mine = rows.results.filter((r) => r.player_key === 'u:' + u.id);
      const cats: Record<string, number> = {};
      let streak = 0, best = 0;
      for (const r of mine) {
        for (const [k, v] of Object.entries(JSON.parse(r.categories_json) as Record<string, number>)) cats[k] = (cats[k] ?? 0) + v;
        if (r.rank === 1) { streak++; best = Math.max(best, streak); } else streak = 0;
      }
      const wins = mine.filter((r) => r.rank === 1).length;
      return { id: u.id, nickname: u.nickname, username: u.username, avatar: u.avatar, matches: mine.length, wins, losses: mine.length - wins,
        winRate: mine.length ? wins / mine.length : 0, ranked: mine.length >= minMatches, roundsWon: mine.reduce((s, r) => s + r.rounds_won, 0),
        jokerCloses: mine.reduce((s, r) => s + r.joker_closes, 0), passActivations: mine.reduce((s, r) => s + r.pass_activations, 0),
        atuDeclarations: mine.reduce((s, r) => s + r.atu_declarations, 0), categories: cats, currentStreak: streak, longestStreak: best };
    }).sort((a, b) => Number(b.ranked) - Number(a.ranked) || b.winRate - a.winRate || b.wins - a.wins);
    return json({ board, minMatches, period, mode });
  }
  if (path === '/api/saved' && m === 'GET') {
    if (!id.playerKey) return json({ saved: [] });
    const rows = await env.DB.prepare("SELECT room_code, saved_at, players_json, round FROM saved_matches WHERE status = 'saved' AND players_json LIKE ? ORDER BY saved_at DESC LIMIT 20")
      .bind(`%"key":"${id.playerKey}"%`).all<any>();
    return json({ saved: rows.results.map((r) => ({ code: r.room_code, savedAt: r.saved_at, round: r.round, players: JSON.parse(r.players_json).map((p: any) => p.name) })) });
  }
  return tournamentsApi(req, env, path, id);
}

// ------------------------------------------------------------------ tournaments
type Format = 'league' | 'roundrobin' | 'elimination' | 'groups';

/** Split players into tables of 2–4 as evenly as possible. */
export function tables(players: string[]): string[][] {
  const n = players.length; if (n <= 4) return [players];
  const k = Math.ceil(n / 4); const out: string[][] = Array.from({ length: k }, () => []);
  players.forEach((p, i) => out[i % k].push(p));
  return out;
}
/** Deterministic schedule. Round robin: greedy rounds (best of many seeded permutations) until every pair has shared a table. */
export function schedule(format: Format, players: string[], rounds: number): string[][][] {
  if (format === 'elimination' || format === 'groups') return [tables(players)];
  const out: string[][][] = [];
  const met = new Set<string>();
  const pairs = (t: string[]) => t.flatMap((a, i) => t.slice(i + 1).map((b) => [a, b].sort().join('|')));
  const total = (players.length * (players.length - 1)) / 2;
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let r = 0; r < 60; r++) {
    let best: string[][] = tables(players); let bestGain = -1;
    for (let k = 0; k < 200; k++) {
      const perm = players.slice();
      for (let i = perm.length - 1; i > 0; i--) { const j = rnd(i + 1); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      const tb = tables(perm);
      const gain = new Set(tb.flatMap(pairs).filter((p) => !met.has(p))).size;
      if (gain > bestGain) { best = tb; bestGain = gain; }
    }
    out.push(best); best.forEach((t) => pairs(t).forEach((p) => met.add(p)));
    if (format === 'league' && out.length >= rounds) break;
    if (format === 'roundrobin' && met.size >= total) break;
  }
  return out;
}

async function createRounds(env: Env, tid: string, round: number, tbs: string[][]) {
  const st = tbs.map((t) => env.DB.prepare('INSERT INTO tournament_matches (id, tournament_id, round, players_json, status) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), tid, round, JSON.stringify(t), 'pending'));
  if (st.length) await env.DB.batch(st);
}

async function tournamentsApi(req: Request, env: Env, path: string, id: Identity): Promise<Response | null> {
  if (!path.startsWith('/api/tournaments')) return null;
  if (!id.userId) return bad('login_required', 401);
  const uid = id.userId; const m = req.method;
  const flag = await env.DB.prepare("SELECT value FROM feature_flags WHERE key = 'tournaments'").first<{ value: string }>();
  if (flag && !JSON.parse(flag.value).enabled) return bad('feature_disabled', 403);
  if (path === '/api/tournaments' && m === 'GET') {
    const rows = await env.DB.prepare('SELECT t.id, t.name, t.code, t.format, t.status, t.owner_id, t.max_players FROM tournaments t JOIN tournament_participants p ON p.tournament_id = t.id WHERE p.user_id = ? ORDER BY t.created_at DESC').bind(uid).all();
    return json({ tournaments: rows.results });
  }
  if (path === '/api/tournaments' && m === 'POST') {
    const b = await body(req);
    const format: Format = ['league', 'roundrobin', 'elimination', 'groups'].includes(b.format) ? b.format : 'roundrobin';
    const maxPlayers = Math.max(2, Math.min(16, Number(b.maxPlayers) || 4));
    const points = Array.isArray(b.points) ? b.points.slice(0, 4).map((x: any) => Math.max(0, Math.min(100, Number(x) || 0))) : [3, 2, 1, 0];
    while (points.length < 4) points.push(0);
    const cfg = sanitizeConfig(b.config ?? defaultConfig()); cfg.training = false;
    const tid = crypto.randomUUID();
    let code = '';
    for (let i = 0; i < 5; i++) { code = randomToken(6).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase().padEnd(6, 'X'); if (!(await env.DB.prepare('SELECT 1 FROM tournaments WHERE code = ?').bind(code).first())) break; }
    const extra = { rounds: Math.max(1, Math.min(20, Number(b.rounds) || 3)), tieBreak: ['wins', 'rounds', 'headtohead'].includes(b.tieBreak) ? b.tieBreak : 'wins', advance: Math.max(1, Math.min(3, Number(b.advance) || 2)) };
    await env.DB.batch([
      env.DB.prepare('INSERT INTO tournaments VALUES (?,?,?,?,?,?,?,?,?,?,NULL)').bind(tid, clean(b.name, 40) || 'Turneu', code, uid, format, JSON.stringify({ ...cfg, _t: extra }), JSON.stringify(points), maxPlayers, 'open', now()),
      env.DB.prepare('INSERT INTO tournament_participants (tournament_id, user_id, name) VALUES (?,?,?)').bind(tid, uid, id.nickname ?? 'Jucător'),
    ]);
    return json({ id: tid, code });
  }
  if (path === '/api/tournaments/join' && m === 'POST') {
    const b = await body(req);
    const t = await env.DB.prepare('SELECT * FROM tournaments WHERE code = ?').bind(String(b.code ?? '').toUpperCase()).first<any>();
    if (!t) return bad('not_found', 404);
    if (t.status !== 'open') return bad('tournament_started', 409);
    const c = await env.DB.prepare('SELECT COUNT(*) AS c FROM tournament_participants WHERE tournament_id = ?').bind(t.id).first<{ c: number }>();
    if ((c?.c ?? 0) >= t.max_players) return bad('tournament_full', 409);
    if (await blocked(env, uid, t.owner_id)) return bad('not_found', 404);
    await env.DB.prepare('INSERT OR IGNORE INTO tournament_participants (tournament_id, user_id, name) VALUES (?,?,?)').bind(t.id, uid, id.nickname ?? 'Jucător').run();
    return json({ id: t.id });
  }
  const mm = path.match(/^\/api\/tournaments\/([0-9a-f-]{36})(\/start|\/room\/([0-9a-f-]{36}))?$/);
  if (!mm) return bad('not_found', 404);
  const t = await env.DB.prepare('SELECT * FROM tournaments WHERE id = ?').bind(mm[1]).first<any>();
  if (!t) return bad('not_found', 404);
  const isMember = await env.DB.prepare('SELECT 1 FROM tournament_participants WHERE tournament_id = ? AND user_id = ?').bind(t.id, uid).first();
  if (!isMember) return bad('forbidden', 403);
  if (!mm[2] && m === 'GET') {
    const parts = await env.DB.prepare('SELECT user_id, name, points, played, wins, eliminated FROM tournament_participants WHERE tournament_id = ? ORDER BY points DESC, wins DESC').bind(t.id).all();
    const matches = await env.DB.prepare('SELECT id, round, players_json, room_code, status, result_json FROM tournament_matches WHERE tournament_id = ? ORDER BY round, id').bind(t.id).all<any>();
    return json({ ...t, config: JSON.parse(t.config_json), points: JSON.parse(t.points_json), config_json: undefined, participants: parts.results,
      matches: matches.results.map((x) => ({ ...x, players: JSON.parse(x.players_json), result: x.result_json ? JSON.parse(x.result_json) : null })), isOwner: t.owner_id === uid });
  }
  if (mm[2] === '/start' && m === 'POST') {
    if (t.owner_id !== uid) return bad('owner_only', 403);
    if (t.status !== 'open') return bad('already_started', 409);
    const parts = await env.DB.prepare('SELECT user_id FROM tournament_participants WHERE tournament_id = ?').bind(t.id).all<{ user_id: string }>();
    if (parts.results.length < 2) return bad('not_enough_players');
    const ex = JSON.parse(t.config_json)._t;
    const rounds = schedule(t.format, parts.results.map((p) => p.user_id), ex.rounds);
    for (let i = 0; i < rounds.length; i++) await createRounds(env, t.id, i + 1, rounds[i]);
    await env.DB.prepare("UPDATE tournaments SET status = 'running' WHERE id = ?").bind(t.id).run();
    for (const p of parts.results) if (p.user_id !== uid) await notify(env, p.user_id, 'tournament', { text: `Turneul „${t.name}” a început.`, tournamentId: t.id }, `tstart:${t.id}:${p.user_id}`);
    return json({ ok: true, rounds: rounds.length });
  }
  return null; // room creation for a tournament match is handled in index.ts (needs the DO)
}

/** Applied once per recorded tournament match (recordMatch is idempotent). */
export async function applyTournamentResult(env: Env, tr: { id: string; matchId: string }, g: GameState, keys: (string | null)[]) {
  const t = await env.DB.prepare('SELECT * FROM tournaments WHERE id = ?').bind(tr.id).first<any>();
  const tm = await env.DB.prepare('SELECT * FROM tournament_matches WHERE id = ? AND tournament_id = ?').bind(tr.matchId, tr.id).first<any>();
  if (!t || !tm || tm.status === 'done') return;
  const points: number[] = JSON.parse(t.points_json);
  const order = g.seats.map((s) => s.seat).sort((a, b) => (a === g.winner ? -1 : b === g.winner ? 1 : g.seats[b].score - g.seats[a].score));
  const st: D1PreparedStatement[] = [];
  const result = order.map((seat, rank) => ({ userId: keys[seat]?.startsWith('u:') ? keys[seat]!.slice(2) : null, name: g.seats[seat].name, rank: rank + 1, points: points[rank] ?? 0 }));
  for (const r of result) if (r.userId) st.push(env.DB.prepare('UPDATE tournament_participants SET points = points + ?, played = played + 1, wins = wins + ? WHERE tournament_id = ? AND user_id = ?').bind(r.points, r.rank === 1 ? 1 : 0, t.id, r.userId));
  st.push(env.DB.prepare("UPDATE tournament_matches SET status = 'done', result_json = ? WHERE id = ?").bind(JSON.stringify(result), tm.id));
  await env.DB.batch(st);
  const left = await env.DB.prepare("SELECT COUNT(*) AS c FROM tournament_matches WHERE tournament_id = ? AND status != 'done'").bind(t.id).first<{ c: number }>();
  if ((left?.c ?? 0) > 0) return;
  const ex = JSON.parse(t.config_json)._t;
  if (t.format === 'elimination' || t.format === 'groups') {
    // advance the top players of each table of the last round; final table decides the winner
    const last = await env.DB.prepare('SELECT MAX(round) AS r FROM tournament_matches WHERE tournament_id = ?').bind(t.id).first<{ r: number }>();
    const lastRound = await env.DB.prepare('SELECT result_json FROM tournament_matches WHERE tournament_id = ? AND round = ?').bind(t.id, last!.r).all<any>();
    if (lastRound.results.length > 1) {
      const adv = lastRound.results.flatMap((x) => (JSON.parse(x.result_json) as any[]).filter((p) => p.userId).slice(0, ex.advance).map((p) => p.userId as string));
      await createRounds(env, t.id, last!.r + 1, tables(adv));
      return;
    }
    const winner = (JSON.parse(lastRound.results[0].result_json) as any[]).find((p) => p.userId)?.userId ?? null;
    await finishTournament(env, t, winner);
    return;
  }
  const top = await env.DB.prepare('SELECT user_id FROM tournament_participants WHERE tournament_id = ? ORDER BY points DESC, wins DESC, played ASC LIMIT 1').bind(t.id).first<{ user_id: string }>();
  await finishTournament(env, t, top?.user_id ?? null);
}

async function finishTournament(env: Env, t: any, winner: string | null) {
  await env.DB.prepare("UPDATE tournaments SET status = 'finished', winner_id = ? WHERE id = ?").bind(winner, t.id).run();
  if (winner) {
    await env.DB.prepare("INSERT OR IGNORE INTO player_stats (player_key, mode) VALUES (?, 'human')").bind('u:' + winner).run();
    await env.DB.prepare("UPDATE player_stats SET tournaments_won = tournaments_won + 1 WHERE player_key = ? AND mode = 'human'").bind('u:' + winner).run();
    await awardAchievements(env, 'u:' + winner);
  }
}
