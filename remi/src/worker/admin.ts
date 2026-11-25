/**
 * Admin Center API. Two independent checks on every request:
 *  1) a valid Cloudflare Access JWT (signature, audience, issuer, expiry) and
 *  2) the authenticated email is in the ADMIN_EMAILS allow-list.
 * No endpoint can read hidden hands or modify live match state / scores.
 */
import type { Env } from './db';
import { json, sha256 } from './util';

let jwksCache: { at: number; keys: any[] } | null = null;
const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export async function verifyAccess(req: Request, env: Env): Promise<string | null> {
  const token = req.headers.get('cf-access-jwt-assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAILS) return null;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
    if (!jwksCache || Date.now() - jwksCache.at > 3600e3) {
      const r = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
      jwksCache = { at: Date.now(), keys: ((await r.json()) as any).keys };
    }
    const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
    if (!jwk || header.alg !== 'RS256') return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    const email = String(payload.email ?? '').toLowerCase();
    const allowed = env.ADMIN_EMAILS.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    return allowed.includes(email) ? email : null;
  } catch { return null; }
}

/** Tamper-evident audit log: each row hashes the previous row's hash. */
export async function audit(env: Env, admin: string, action: string, target: string | null, details: unknown) {
  const prev = await env.DB.prepare('SELECT hash FROM admin_audit ORDER BY id DESC LIMIT 1').first<{ hash: string }>();
  const ts = Date.now(); const d = JSON.stringify(details ?? null);
  const prevHash = prev?.hash ?? 'genesis';
  const hash = await sha256(`${prevHash}|${ts}|${admin}|${action}|${target}|${d}`);
  await env.DB.prepare('INSERT INTO admin_audit (ts, admin, action, target, details_json, prev_hash, hash) VALUES (?,?,?,?,?,?,?)').bind(ts, admin, action, target, d, prevHash, hash).run();
}

export async function verifyAuditChain(env: Env): Promise<{ ok: boolean; rows: number; brokenAt?: number }> {
  const rows = await env.DB.prepare('SELECT * FROM admin_audit ORDER BY id').all<any>();
  let prev = 'genesis';
  for (const r of rows.results) {
    const h = await sha256(`${prev}|${r.ts}|${r.admin}|${r.action}|${r.target}|${r.details_json}`);
    if (r.prev_hash !== prev || r.hash !== h) return { ok: false, rows: rows.results.length, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true, rows: rows.results.length };
}

const BACKUP_TABLES = ['users', 'guests', 'player_stats', 'matches', 'match_players', 'achievements', 'user_achievements', 'friendships', 'blocks', 'saved_matches',
  'tournaments', 'tournament_participants', 'tournament_matches', 'feature_flags', 'admin_audit', 'rooms_index'];

export async function runBackup(env: Env, retentionDays = 30) {
  if (!env.BACKUPS) throw new Error('no_backup_bucket');
  const dump: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) dump[t] = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
  const body = JSON.stringify({ version: 1, createdAt: Date.now(), env: env.ENVIRONMENT ?? 'production', tables: dump });
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `d1/${env.ENVIRONMENT ?? 'production'}/${id}.json`;
  await env.BACKUPS.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare('INSERT INTO backups VALUES (?,?,?,?,?,?)').bind(id, Date.now(), key, body.length, BACKUP_TABLES.length, 'ok').run();
  // retention
  const cutoff = Date.now() - retentionDays * 864e5;
  const old = await env.DB.prepare('SELECT id, r2_key FROM backups WHERE created_at < ?').bind(cutoff).all<any>();
  for (const o of old.results) { await env.BACKUPS.delete(o.r2_key); await env.DB.prepare('DELETE FROM backups WHERE id = ?').bind(o.id).run(); }
  return { id, key, bytes: body.length };
}

export async function adminApi(req: Request, env: Env, path: string, roomStats: (codes: string[]) => Promise<any[]>, closeRoom: (code: string) => Promise<void>): Promise<Response> {
  const admin = await verifyAccess(req, env);
  if (!admin) return json({ error: 'forbidden' }, { status: 403 });
  const m = req.method;
  const body = m === 'POST' || m === 'PUT' ? await req.json().catch(() => ({})) as any : {};
  if (path === '/api/admin/whoami') return json({ email: admin });
  if (path === '/api/admin/metrics') {
    const since = Date.now() - 6 * 3600e3;
    const codes = (await env.DB.prepare('SELECT code FROM rooms_index WHERE last_seen > ? ORDER BY last_seen DESC LIMIT 100').bind(since).all<{ code: string }>()).results.map((r) => r.code);
    const rooms = (await roomStats(codes)).filter(Boolean);
    const [users, matches, today, errs] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS c FROM matches').first<{ c: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS c FROM matches WHERE finished_at > ?').bind(Date.now() - 864e5).first<{ c: number }>(),
      env.DB.prepare('SELECT source, code, COUNT(*) AS c FROM error_log WHERE ts > ? GROUP BY source, code').bind(Date.now() - 864e5).all(),
    ]);
    const live = rooms.filter((r) => r.connected > 0);
    const sum = (k: string) => live.reduce((s, r) => s + (r[k] ?? 0), 0);
    const online = sum('connected');
    return json({
      online, activeRooms: live.length, activeMatches: live.filter((r) => r.status === 'PLAYING').length, spectators: sum('spectators'), bots: live.reduce((s, r) => s + (r.status === 'PLAYING' ? r.bots : 0), 0),
      voice: sum('mic'), video: sum('cam'), websockets: online, completedMatches: matches?.c ?? 0, matches24h: today?.c ?? 0, registeredPlayers: users?.c ?? 0,
      errors24h: errs.results, rooms,
      costEstimate: { note: 'Durable Object duration billed only while sockets are awake (hibernation). See COST_ESTIMATE.md.', perHourUsdApprox: +(online * 0.0009).toFixed(4) },
    });
  }
  if (path === '/api/admin/users' && m === 'GET') {
    const q = new URL(req.url).searchParams.get('q') ?? '';
    const r = await env.DB.prepare("SELECT id, username, nickname, created_at, suspended, last_seen FROM users WHERE username LIKE ? ORDER BY created_at DESC LIMIT 50").bind(q.replace(/[%_]/g, '') + '%').all();
    return json({ users: r.results });
  }
  if (path === '/api/admin/users/suspend' && m === 'POST') {
    await env.DB.prepare('UPDATE users SET suspended = ? WHERE id = ?').bind(body.suspended ? 1 : 0, String(body.userId)).run();
    if (body.suspended) await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(String(body.userId)).run();
    await audit(env, admin, body.suspended ? 'suspend_user' : 'unsuspend_user', String(body.userId), { reason: String(body.reason ?? '').slice(0, 200) });
    return json({ ok: true });
  }
  if (path === '/api/admin/rooms/close' && m === 'POST') {
    const code = String(body.code ?? '').toUpperCase();
    await closeRoom(code);
    await audit(env, admin, 'close_room', code, { reason: String(body.reason ?? '').slice(0, 200) });
    return json({ ok: true });
  }
  if (path === '/api/admin/flags' && m === 'GET') return json({ flags: (await env.DB.prepare('SELECT * FROM feature_flags').all()).results });
  if (path === '/api/admin/flags' && m === 'PUT') {
    const key = String(body.key ?? '');
    if (!/^[a-zA-Z_]{2,30}$/.test(key)) return json({ error: 'bad_key' }, { status: 400 });
    const value = JSON.stringify(body.value ?? {});
    if (value.length > 20000) return json({ error: 'too_large' }, { status: 400 });
    const prev = await env.DB.prepare('SELECT value FROM feature_flags WHERE key = ?').bind(key).first<{ value: string }>();
    await env.DB.prepare('INSERT INTO feature_flags VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(key, value, Date.now()).run();
    await audit(env, admin, 'set_flag', key, { from: prev?.value ?? null, to: value });
    return json({ ok: true });
  }
  if (path === '/api/admin/achievements' && m === 'GET') return json({ achievements: (await env.DB.prepare('SELECT * FROM achievements ORDER BY key, threshold').all()).results });
  if (path === '/api/admin/achievements' && m === 'PUT') {
    const threshold = Math.max(1, Math.min(100000, Number(body.threshold) || 1));
    await env.DB.prepare('UPDATE achievements SET threshold = ? WHERE key = ? AND tier = ?').bind(threshold, String(body.key), String(body.tier)).run();
    await audit(env, admin, 'set_achievement_threshold', `${body.key}/${body.tier}`, { threshold });
    return json({ ok: true });
  }
  if (path === '/api/admin/matches') {
    // public metadata only — never hands
    const r = await env.DB.prepare('SELECT id, room_code, mode, started_at, finished_at, rounds, winner_name, humans, tournament_id FROM matches ORDER BY finished_at DESC LIMIT 50').all();
    return json({ matches: r.results });
  }
  if (path === '/api/admin/tournaments') return json({ tournaments: (await env.DB.prepare('SELECT id, name, format, status, max_players, created_at FROM tournaments ORDER BY created_at DESC LIMIT 50').all()).results });
  if (path === '/api/admin/logs') return json({ errors: (await env.DB.prepare('SELECT * FROM error_log ORDER BY id DESC LIMIT 100').all()).results });
  if (path === '/api/admin/audit') {
    const rows = await env.DB.prepare('SELECT * FROM admin_audit ORDER BY id DESC LIMIT 100').all();
    return json({ audit: rows.results, chain: await verifyAuditChain(env) });
  }
  if (path === '/api/admin/backups' && m === 'GET') return json({ backups: (await env.DB.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT 60').all()).results });
  if (path === '/api/admin/backups' && m === 'POST') {
    const lim = await env.DB.prepare("SELECT value FROM feature_flags WHERE key = 'backupRetentionDays'").first<{ value: string }>();
    const r = await runBackup(env, lim ? Number(JSON.parse(lim.value)) || 30 : 30);
    await audit(env, admin, 'backup', r.id, { bytes: r.bytes });
    return json(r);
  }
  if (path === '/api/admin/version') return json({ environment: env.ENVIRONMENT ?? 'production', version: (globalThis as any).__BUILD__ ?? 'dev' });
  return json({ error: 'not_found' }, { status: 404 });
}
