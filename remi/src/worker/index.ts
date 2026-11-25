/** Worker entry: API router, WebSocket upgrade to the room Durable Object, static assets, cron backups. */
import type { Env } from './db';
import { logError } from './db';
import { json } from './util';
import { serveStatic } from './static';
import { identify, socialApi, announceRoom } from './social';
import { adminApi, runBackup } from './admin';
import { ROOM_CODE_ALPHABET, isRoomCode } from '../shared/protocol';
import { defaultConfig, sanitizeConfig } from '../engine/config';
import { secureRng } from '../engine/tiles';

export { RemiRoom } from './room';

const memLimiter = new Map<string, number[]>();
async function limited(env: Env, req: Request, bucket: string, max: number, windowMs: number): Promise<boolean> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  const key = `${bucket}:${ip}`;
  if (env.JOIN_LIMITER && bucket === 'join') {
    try { const r = await env.JOIN_LIMITER.limit({ key }); if (!r.success) return true; } catch { /* fall back */ }
  }
  const now = Date.now();
  const arr = (memLimiter.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now); memLimiter.set(key, arr);
  if (memLimiter.size > 5000) memLimiter.clear();
  return arr.length > max;
}

function newCode() { let s = ''; for (let i = 0; i < 6; i++) s += ROOM_CODE_ALPHABET[secureRng(ROOM_CODE_ALPHABET.length)]; return s; }
const stub = (env: Env, code: string) => env.ROOM.get(env.ROOM.idFromName(code));
const doCall = (env: Env, code: string, op: string, body?: unknown) =>
  stub(env, code).fetch(`https://room/${op}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

async function flags(env: Env): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  try { for (const r of (await env.DB.prepare('SELECT key, value FROM feature_flags').all<{ key: string; value: string }>()).results) out[r.key] = JSON.parse(r.value); } catch { /* db optional */ }
  return out;
}

function sameOrigin(req: Request): boolean {
  const o = req.headers.get('origin');
  if (!o) return true;
  try { return new URL(o).host === new URL(req.url).host || /^localhost(:\d+)?$/.test(new URL(o).host); } catch { return false; }
}

async function createRoom(env: Env, b: any, ident: Awaited<ReturnType<typeof identify>>, extra: Record<string, unknown> = {}) {
  for (let i = 0; i < 6; i++) {
    const code = newCode();
    const res = await doCall(env, code, 'init', { ...b, ...extra, code, playerKey: ident.playerKey, registered: ident.registered });
    if (res.ok) {
      const data: any = await res.json();
      await env.DB?.prepare('INSERT OR REPLACE INTO rooms_index VALUES (?,?,?,?,?)').bind(code, Date.now(), ident.playerKey, b.mode ?? 'human', Date.now()).run().catch(() => null);
      return data;
    }
  }
  throw new Error('code_generation_failed');
}

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  if (req.method !== 'GET' && !sameOrigin(req)) return json({ error: 'bad_origin' }, { status: 403 });
  if (path === '/api/health') return json({ ok: true, time: Date.now(), env: env.ENVIRONMENT ?? 'production' });
  if (path.startsWith('/api/admin/')) {
    return adminApi(req, env, path,
      async (codes) => Promise.all(codes.map(async (c) => { const r = await doCall(env, c, 'stats'); return r.ok ? r.json() : null; })),
      async (code) => { if (isRoomCode(code)) await doCall(env, code, 'adminClose', {}); });
  }
  const ident = await identify(req, env);
  if (path === '/api/config/defaults') {
    const f = await flags(env);
    const cfg = f.defaultRules ? sanitizeConfig(f.defaultRules) : defaultConfig();
    return json({ config: cfg, maintenance: f.maintenance ?? { enabled: false }, voice: f.voice?.enabled !== false, video: f.video?.enabled !== false, tournaments: f.tournaments?.enabled !== false, limits: f.limits ?? {} });
  }
  if (path === '/api/rooms' && req.method === 'POST') {
    if (await limited(env, req, 'create', 20, 600e3)) return json({ error: 'rate_limited' }, { status: 429 });
    const f = await flags(env);
    if (f.maintenance?.enabled) return json({ error: 'maintenance', message: f.maintenance.message ?? '' }, { status: 503 });
    const b: any = await req.json().catch(() => ({}));
    if (b.config) { b.config = sanitizeConfig(b.config); if (f.voice?.enabled === false) b.config.voice = false; if (f.video?.enabled === false) b.config.video = false; }
    if (ident.registered && ident.nickname && !b.name) b.name = ident.nickname;
    const data = await createRoom(env, b, ident);
    if (b.announce && ident.userId && b.mode !== 'training' && b.mode !== 'bots') await announceRoom(env, ident.userId, ident.nickname ?? b.name, data.code).catch(() => null);
    return json(data);
  }
  const tm = path.match(/^\/api\/tournaments\/([0-9a-f-]{36})\/room\/([0-9a-f-]{36})$/);
  if (tm && req.method === 'POST') {
    if (!ident.userId) return json({ error: 'login_required' }, { status: 401 });
    const t = await env.DB.prepare('SELECT * FROM tournaments WHERE id = ?').bind(tm[1]).first<any>();
    const m = await env.DB.prepare('SELECT * FROM tournament_matches WHERE id = ? AND tournament_id = ?').bind(tm[2], tm[1]).first<any>();
    if (!t || !m) return json({ error: 'not_found' }, { status: 404 });
    const players: string[] = JSON.parse(m.players_json);
    if (!players.includes(ident.userId)) return json({ error: 'forbidden' }, { status: 403 });
    if (m.status === 'done') return json({ error: 'match_done' }, { status: 409 });
    if (m.room_code) {
      const j = await doCall(env, m.room_code, 'join', { name: ident.nickname, playerKey: ident.playerKey, registered: true });
      return json({ ...(await j.json() as any), code: m.room_code });
    }
    const cfg = JSON.parse(t.config_json); delete cfg._t;
    cfg.bots = { ...(cfg.bots ?? {}), fillEmpty: false };
    const data = await createRoom(env, { name: ident.nickname, config: cfg, mode: 'human' }, ident, { tournament: { id: t.id, matchId: m.id }, allowedKeys: players.map((p) => 'u:' + p) });
    const upd = await env.DB.prepare('UPDATE tournament_matches SET room_code = ?, status = ? WHERE id = ? AND room_code IS NULL').bind(data.code, 'playing', m.id).run();
    if (!upd.meta.changes) { // someone else created it concurrently: use theirs
      const again = await env.DB.prepare('SELECT room_code FROM tournament_matches WHERE id = ?').bind(m.id).first<any>();
      await doCall(env, data.code, 'adminClose', {});
      const j = await doCall(env, again.room_code, 'join', { name: ident.nickname, playerKey: ident.playerKey, registered: true });
      return json({ ...(await j.json() as any), code: again.room_code });
    }
    return json(data);
  }
  const rm = path.match(/^\/api\/rooms\/([A-Z0-9]{6})(\/join|\/ice)?$/);
  if (rm) {
    if (await limited(env, req, 'join', 40, 60e3)) return json({ error: 'rate_limited' }, { status: 429 });
    const code = rm[1];
    if (!rm[2]) { const r = await doCall(env, code, 'info'); return json(await r.json(), { status: r.status }); }
    if (rm[2] === '/join' && req.method === 'POST') {
      const b: any = await req.json().catch(() => ({}));
      if (ident.registered && ident.nickname && !b.name) b.name = ident.nickname;
      const r = await doCall(env, code, 'join', { name: b.name, spectator: !!b.spectator, playerKey: ident.playerKey, registered: ident.registered });
      return json(await r.json(), { status: r.status });
    }
    if (rm[2] === '/ice' && req.method === 'POST') {
      const b: any = await req.json().catch(() => ({}));
      const v: any = await (await doCall(env, code, 'verify', { token: b.token })).json();
      if (!v.ok) return json({ error: 'forbidden' }, { status: 403 });
      const ice: any[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
      if (env.TURN_KEY_ID && env.TURN_KEY_TOKEN) {
        // short-lived (1h) TURN credentials scoped to this request
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
          method: 'POST', headers: { authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ ttl: 3600 }) });
        if (r.ok) ice.push(...(((await r.json()) as any).iceServers ?? []));
      }
      return json({ iceServers: ice, turn: !!env.TURN_KEY_ID });
    }
  }
  const s = await socialApi(req, env, path, ident);
  if (s) return s;
  return json({ error: 'not_found' }, { status: 404 });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/ws/')) {
        const code = url.pathname.slice(4);
        if (!isRoomCode(code)) return new Response('bad code', { status: 400 });
        if (!sameOrigin(req)) return new Response('bad origin', { status: 403 });
        return stub(env, code).fetch(new Request(`https://room/ws?${url.searchParams}`, req));
      }
      if (url.pathname.startsWith('/api/')) return await api(req, env, url);
      return await serveStatic(req, env, ctx);
    } catch (e: any) {
      ctx.waitUntil(logError(env, 'worker', 'unhandled', String(e?.stack ?? e)));
      return json({ error: 'server_error' }, { status: 500 });
    }
  },
  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      try {
        const f = await flags(env);
        await runBackup(env, Number(f.backupRetentionDays) || 30);
        await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
        await env.DB.prepare('DELETE FROM notifications WHERE created_at < ?').bind(Date.now() - 30 * 864e5).run();
        await env.DB.prepare('DELETE FROM error_log WHERE ts < ?').bind(Date.now() - 14 * 864e5).run();
      } catch (e) { await logError(env, 'cron', 'backup_failed', String(e)); }
    })());
  },
} satisfies ExportedHandler<Env>;
