/**
 * RemiRoom — one Durable Object per private room. Single-threaded, authoritative.
 * WebSocket Hibernation API + a single alarm drive timers, bots and countdowns.
 */
import { DurableObject } from 'cloudflare:workers';
import { RoomConfig, anyCategoryEnabled, defaultConfig, sanitizeConfig } from '../engine/config';
import {
  GameError, GameState, activatePass, close, declareAtu, discard, draw, newMatch, pause, resume, startRound, activeSeats, canTakeDiscard, agreeDraw,
} from '../engine/game';
import { buildView } from '../engine/view';
import { decideDiscard, decideDraw, shouldDeclareAtu, thinkDelay } from '../engine/bot';
import { computeHints } from '../engine/assistant';
import { Scenario, SCENARIOS, prepareStarter, rigScenario } from '../engine/scenarios';
import { secureRng } from '../engine/tiles';
import type { ChatMsg, ClientMsg, PublicMember, RoomView, SeatSlot, ServerMsg, VoteState } from '../shared/protocol';
import { recordMatch, type Env } from './db';
import { sha256, randomToken } from './util';

interface Member {
  pid: string; name: string; tokenHash: string; playerKey: string | null; registered: boolean;
  role: 'player' | 'spectator'; ready: boolean; connected: boolean; disconnectedAt: number | null; joinedAt: number;
  mic: boolean; cam: boolean; chatTimes: number[]; recentAids: string[]; pauseRequests: number;
}

interface RoomData {
  code: string; createdAt: number; lastActivity: number;
  hostPid: string; config: RoomConfig; mode: 'human' | 'bots' | 'training';
  members: Member[]; seats: SeatSlot[];
  status: RoomView['status'];
  game: GameState | null; matchConfig: RoomConfig | null; matchNo: number;
  gameSeatPids: (string | null)[]; gameBotLevels: (string | null)[];
  chat: ChatMsg[]; chatSeq: number;
  racks: Record<string, (number | null)[]>;
  vote: VoteState | null; pausedUntil: number | null;
  nextReady: string[]; botAt: number | null; recorded: number[];
  tournament: { id: string; matchId: string } | null;
  /** tournament rooms: only these player keys may join as players */
  allowedKeys: string[] | null;
  scenario: Scenario | null;
}

const BOT_NAMES = ['Bot Ionel', 'Bot Maria', 'Bot Vasile', 'Bot Elena', 'Bot Costel', 'Bot Ana'];
const MAX_MEMBERS = 24;

export class RemiRoom extends DurableObject<Env> {
  room: RoomData | null = null;

  async load(): Promise<RoomData | null> {
    if (!this.room) {
      this.room = (await this.ctx.storage.get<RoomData>('room')) ?? null;
      const r = this.room;
      if (r) {
        // rooms created before the corner/collect rules: keep their original rules for matches in progress
        if (r.matchConfig && (r.matchConfig as any).corner === undefined) r.matchConfig = { ...sanitizeConfig({ ...r.matchConfig, winnerCollects: false, corner: { enabled: false } }) };
        if ((r.config as any).corner === undefined) r.config = sanitizeConfig(r.config);
        if (r.game && (r.game as any).pot === undefined) r.game.pot = 0;
      }
    }
    return this.room;
  }
  async persist() { if (this.room) { this.room.lastActivity = Date.now(); await this.ctx.storage.put('room', this.room); } }

  // ---------------------------------------------------------------- HTTP (from the Worker only)
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const op = url.pathname.split('/').pop();
    if (op === 'ws') return this.handleWs(req, url);
    const body: any = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    try {
      if (op === 'init') return Response.json(await this.init(body));
      const r = await this.load();
      if (!r) return Response.json({ error: 'room_not_found' }, { status: 404 });
      if (op === 'info') return Response.json({ code: r.code, status: r.status, players: r.members.filter((m) => m.role === 'player').length, spectators: r.config.spectators, host: r.members.find((m) => m.pid === r.hostPid)?.name ?? '', mode: r.mode });
      if (op === 'join') return Response.json(await this.join(body));
      if (op === 'stats') return Response.json(this.stats());
      if (op === 'verify') { const th = await sha256(String(body.token ?? '')); const mm = r.members.find((x) => x.tokenHash === th); return Response.json({ ok: !!mm && mm.role === 'player' }); }
      if (op === 'adminClose') { await this.adminClose(); return Response.json({ ok: true }); }
      return Response.json({ error: 'bad_op' }, { status: 400 });
    } catch (e: any) {
      return Response.json({ error: e?.code ?? e?.message ?? 'error' }, { status: 400 });
    }
  }

  async init(b: any) {
    if (await this.load()) throw new GameError('room_exists');
    const cfg = sanitizeConfig(b.config ?? defaultConfig());
    const mode: RoomData['mode'] = b.mode === 'bots' ? 'bots' : b.mode === 'training' ? 'training' : 'human';
    cfg.training = mode === 'training';
    if (mode === 'training' && !b.config?.turnSeconds) cfg.turnSeconds = 0;
    const now = Date.now();
    const token = randomToken();
    const host: Member = this.newMember(b.name, await sha256(token), b.playerKey ?? null, !!b.registered, 'player', now);
    const seats: SeatSlot[] = [{ kind: 'human', pid: host.pid }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }];
    if (mode !== 'human') for (let i = 1; i < 4; i++) seats[i] = { kind: 'bot', level: cfg.bots.difficulty, name: BOT_NAMES[i - 1] };
    this.room = {
      code: b.code, createdAt: now, lastActivity: now, hostPid: host.pid, config: cfg, mode,
      members: [host], seats, status: 'LOBBY', game: null, matchConfig: null, matchNo: 0, gameSeatPids: [], gameBotLevels: [],
      chat: [], chatSeq: 0, racks: {}, vote: null, pausedUntil: null, nextReady: [], botAt: null, recorded: [],
      tournament: b.tournament ?? null, allowedKeys: Array.isArray(b.allowedKeys) ? b.allowedKeys : null,
      scenario: mode === 'training' && SCENARIOS.includes(b.scenario) ? b.scenario : null,
    };
    host.ready = true;
    await this.persist();
    await this.schedule();
    return { code: b.code, token, pid: host.pid };
  }

  newMember(name: unknown, tokenHash: string, playerKey: string | null, registered: boolean, role: Member['role'], now: number): Member {
    const n = String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Jucător';
    return { pid: crypto.randomUUID().slice(0, 12), name: n, tokenHash, playerKey, registered, role, ready: false, connected: false,
      disconnectedAt: null, joinedAt: now, mic: false, cam: false, chatTimes: [], recentAids: [], pauseRequests: 0 };
  }

  async join(b: any) {
    const r = this.room!;
    if (r.members.length >= MAX_MEMBERS) throw new GameError('room_full');
    const now = Date.now();
    const token = randomToken();
    let role: Member['role'] = 'spectator';
    if (r.allowedKeys && !b.spectator && !r.allowedKeys.includes(b.playerKey)) throw new GameError('tournament_participants_only');
    const free = r.seats.findIndex((s) => s.kind === 'empty');
    if (!b.spectator && r.status === 'LOBBY' && free >= 0) role = 'player';
    if (role === 'spectator' && !r.config.spectators) throw new GameError(r.status === 'LOBBY' ? 'room_full' : 'spectators_disabled');
    const m = this.newMember(b.name, await sha256(token), b.playerKey ?? null, !!b.registered, role, now);
    r.members.push(m);
    if (role === 'player') r.seats[free] = { kind: 'human', pid: m.pid };
    this.sys(`${m.name} a intrat${role === 'spectator' ? ' ca spectator' : ''}.`);
    await this.persist();
    this.broadcast();
    return { code: r.code, token, pid: m.pid, role };
  }

  stats() {
    const r = this.room!;
    const humans = r.members.filter((m) => m.connected);
    return {
      code: r.code, status: r.status, mode: r.mode, createdAt: r.createdAt, lastActivity: r.lastActivity,
      connected: humans.length, spectators: humans.filter((m) => m.role === 'spectator').length,
      bots: r.seats.filter((s) => s.kind === 'bot').length, mic: humans.filter((m) => m.mic).length, cam: humans.filter((m) => m.cam).length,
      round: r.game?.round ?? 0, matchNo: r.matchNo,
      // public info for the live-tables list (no hands, no tokens)
      listed: r.config.listed !== false && r.config.spectators && r.mode !== 'training' && !r.tournament,
      host: r.members.find((m) => m.pid === r.hostPid)?.name ?? '',
      players: r.game ? r.game.seats.map((s) => ({ name: s.name, score: Math.max(0, s.score), bot: s.isBot, out: s.status !== 'ACTIVE' })) : r.members.filter((m) => m.role === 'player').map((m) => ({ name: m.name, score: 0, bot: false, out: false })),
      pot: r.game?.pot ?? 0,
    };
  }

  async adminClose() {
    for (const ws of this.ctx.getWebSockets()) { try { this.send(ws, { t: 'kicked' }); ws.close(4003, 'closed_by_admin'); } catch { /* ignore */ } }
    await this.ctx.storage.deleteAll();
    this.room = null;
  }

  // ---------------------------------------------------------------- WebSockets
  async handleWs(req: Request, url: URL): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const r = await this.load();
    if (!r) return new Response('room_not_found', { status: 404 });
    const token = url.searchParams.get('token') ?? '';
    const th = await sha256(token);
    const m = r.members.find((x) => x.tokenHash === th);
    if (!m) return new Response('unauthorized', { status: 401 });
    // one live socket per member: older tabs are told they were replaced
    for (const ws of this.ctx.getWebSockets(m.pid)) { try { this.send(ws, { t: 'replaced' }); ws.close(4001, 'replaced'); } catch { /* ignore */ } }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [m.pid]);
    pair[1].serializeAttachment({ pid: m.pid });
    const wasDisconnected = !m.connected;
    m.connected = true; m.disconnectedAt = null;
    if (wasDisconnected && r.status !== 'LOBBY') this.sys(`${m.name} s-a reconectat.`);
    await this.persist();
    this.sendState(pair[1], m);
    this.broadcast(m.pid);
    await this.schedule();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  pidOf(ws: WebSocket): string | null { return (ws.deserializeAttachment() as any)?.pid ?? null; }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const r = await this.load();
    if (!r) { ws.close(4004, 'gone'); return; }
    const pid = this.pidOf(ws);
    const m = r.members.find((x) => x.pid === pid);
    if (!m) { ws.close(4003, 'kicked'); return; }
    if (typeof raw !== 'string' || raw.length > 65536) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'ping') { this.send(ws, { t: 'pong', ts: msg.ts, server: Date.now() }); return; }
    if (msg.t === 'rtc') { this.relayRtc(m, msg.to, msg.data); return; }
    try {
      const changed = await this.handle(m, msg, ws);
      if (changed) { await this.persist(); this.broadcast(); await this.schedule(); }
    } catch (e: any) {
      const code = e instanceof GameError ? e.code : 'server_error';
      if (!(e instanceof GameError)) console.error(JSON.stringify({ evt: 'room_error', code: r.code, err: String(e?.stack ?? e) }));
      this.send(ws, { t: 'err', code, aid: (msg as any).aid });
      // resync the client after any rejection (optimistic UI rollback)
      this.sendState(ws, m);
    }
  }

  async webSocketClose(ws: WebSocket) { await this.onLeave(ws); }
  async webSocketError(ws: WebSocket) { await this.onLeave(ws); }

  async onLeave(ws: WebSocket) {
    const r = await this.load(); if (!r) return;
    const pid = this.pidOf(ws);
    const m = r.members.find((x) => x.pid === pid); if (!m) return;
    const others = this.ctx.getWebSockets(m.pid).filter((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (others.length) return;
    m.connected = false; m.disconnectedAt = Date.now(); m.mic = false; m.cam = false;
    if (r.hostPid === m.pid) this.transferHost();
    await this.persist();
    this.broadcast();
    await this.schedule();
  }

  transferHost() {
    const r = this.room!;
    const next = r.members.find((x) => x.connected && x.pid !== r.hostPid && x.role === 'player') ?? r.members.find((x) => x.connected && x.pid !== r.hostPid);
    if (next) { r.hostPid = next.pid; this.sys(`${next.name} este noua gazdă.`); }
  }

  // ---------------------------------------------------------------- message handling
  async handle(m: Member, msg: ClientMsg, ws: WebSocket): Promise<boolean> {
    const r = this.room!;
    const isHost = r.hostPid === m.pid;
    switch (msg.t) {
      case 'config': {
        if (!isHost) throw new GameError('host_only');
        if (r.status !== 'LOBBY') throw new GameError('rules_locked');
        const c = sanitizeConfig(msg.config);
        c.training = r.mode === 'training';
        r.config = c;
        for (const s of r.seats) if (s.kind === 'bot') s.level = c.bots.difficulty;
        for (const x of r.members) if (x.pid !== r.hostPid) x.ready = false; // rules changed: re-confirm
        return true;
      }
      case 'ready': { if (r.status !== 'LOBBY' || m.role !== 'player') throw new GameError('bad_state'); m.ready = !!msg.ready; return true; }
      case 'seat': return this.seatOp(m, isHost, msg);
      case 'kick': {
        if (!isHost || r.status !== 'LOBBY') throw new GameError('host_only');
        const k = r.members.find((x) => x.pid === msg.pid);
        if (!k || k.pid === m.pid) throw new GameError('bad_target');
        r.members = r.members.filter((x) => x !== k);
        r.seats = r.seats.map((s) => (s.kind === 'human' && s.pid === k.pid ? { kind: 'empty' } : s));
        for (const s of this.ctx.getWebSockets(k.pid)) { this.send(s, { t: 'kicked' }); s.close(4003, 'kicked'); }
        this.sys(`${k.name} a fost scos din cameră.`);
        return true;
      }
      case 'start': return this.startMatch(m, isHost);
      case 'chat': case 'react': {
        if (!r.config.chat) throw new GameError('chat_disabled');
        const now = Date.now();
        m.chatTimes = m.chatTimes.filter((x) => now - x < 10000);
        if (m.chatTimes.length >= 6) throw new GameError('rate_limited');
        m.chatTimes.push(now);
        const text = msg.t === 'chat' ? String(msg.text ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) : String(msg.emoji ?? '').slice(0, 8);
        if (!text) return false;
        r.chat.push({ id: ++r.chatSeq, pid: m.pid, name: m.name, text, ts: now, kind: msg.t === 'chat' ? 'text' : 'reaction' });
        if (r.chat.length > 60) r.chat.splice(0, r.chat.length - 60);
        return true;
      }
      case 'rack': {
        if (!Array.isArray(msg.layout) || msg.layout.length > 48) return false;
        r.racks[m.pid] = msg.layout.map((x) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) < 106 ? x : null));
        await this.ctx.storage.put('room', r); // private, not broadcast
        return false;
      }
      case 'nextReady': {
        if (r.game?.phase !== 'ROUND_RESULT') return false;
        if (!r.nextReady.includes(m.pid)) r.nextReady.push(m.pid);
        const need = this.humanSeatPids().filter((p) => this.member(p)?.connected);
        if (need.every((p) => r.nextReady.includes(p))) await this.nextRound();
        return true;
      }
      case 'vote': return this.startVote(m, msg.kind);
      case 'voteAnswer': return this.answerVote(m, !!msg.yes);
      case 'resumeSaved': {
        if (r.status !== 'SAVED' || m.role !== 'player') throw new GameError('bad_state');
        if (!r.nextReady.includes(m.pid)) r.nextReady.push(m.pid);
        const need = this.humanSeatPids();
        if (need.every((p) => r.nextReady.includes(p) && this.member(p)?.connected)) {
          r.status = 'PLAYING'; r.nextReady = [];
          resume(r.game!, Date.now());
          this.sys('Partida salvată a fost reluată.');
          await this.env.DB?.prepare('UPDATE saved_matches SET status=? WHERE room_code=?').bind('resumed', r.code).run().catch(() => null);
        }
        return true;
      }
      case 'rematch': {
        if (!isHost) throw new GameError('host_only');
        if (r.status !== 'FINISHED') throw new GameError('bad_state');
        r.status = 'LOBBY'; r.game = null; r.matchConfig = null; r.nextReady = []; r.vote = null; r.pausedUntil = null; r.racks = {};
        for (const x of r.members) { x.ready = x.pid === r.hostPid; x.pauseRequests = 0; }
        // eliminated/spectating players keep their lobby seats
        this.sys('Revanșă! Confirmați că sunteți gata.');
        return true;
      }
      case 'restartTraining': {
        if (r.mode !== 'training' || !isHost || !r.game || !r.matchConfig) throw new GameError('training_only');
        if (msg.scenario !== undefined) r.scenario = SCENARIOS.includes(msg.scenario as Scenario) ? (msg.scenario as Scenario) : null;
        const players = r.game.seats.map((x) => ({ name: x.name, isBot: x.isBot }));
        r.game = newMatch(players, r.matchConfig, Date.now()); r.racks = {};
        this.deal(Date.now());
        this.sys('Antrenament repornit.');
        return true;
      }
      case 'hint': {
        if (!r.matchConfig?.training || !r.game) throw new GameError('hints_training_only');
        const seat = r.gameSeatPids.indexOf(m.pid);
        if (seat < 0) throw new GameError('not_player');
        this.send(ws, { t: 'hints', hints: computeHints(buildView(r.game, r.matchConfig, seat), r.matchConfig) });
        return false;
      }
      case 'media': {
        const allowedMic = r.config.voice && m.role === 'player';
        const allowedCam = r.config.video && m.role === 'player';
        m.mic = !!msg.mic && allowedMic; m.cam = !!msg.cam && allowedCam;
        return true;
      }
      case 'act': return this.gameAction(m, msg);
    }
    return false;
  }

  seatOp(m: Member, isHost: boolean, msg: Extract<ClientMsg, { t: 'seat' }>): boolean {
    const r = this.room!;
    if (r.status !== 'LOBBY') throw new GameError('rules_locked');
    const i = msg.seat;
    if (!Number.isInteger(i) || i < 0 || i > 3) throw new GameError('bad_seat');
    const s = r.seats[i];
    if (msg.kind === 'take') {
      if (s.kind !== 'empty') throw new GameError('seat_taken');
      r.seats = r.seats.map((x) => (x.kind === 'human' && x.pid === m.pid ? { kind: 'empty' } : x));
      r.seats[i] = { kind: 'human', pid: m.pid }; m.role = 'player'; m.ready = false;
      return true;
    }
    if (msg.kind === 'leave') {
      if (s.kind !== 'human' || s.pid !== m.pid) throw new GameError('bad_seat');
      r.seats[i] = { kind: 'empty' }; m.role = 'spectator'; m.ready = false;
      return true;
    }
    if (!isHost) throw new GameError('host_only');
    if (s.kind === 'human') {
      const who = this.member(s.pid); if (who) { who.role = 'spectator'; who.ready = false; }
    }
    if (msg.kind === 'bot') {
      const used = r.seats.filter((x) => x.kind === 'bot').map((x: any) => x.name);
      r.seats[i] = { kind: 'bot', level: msg.level ?? r.config.bots.difficulty, name: BOT_NAMES.find((n) => !used.includes(n)) ?? 'Bot' };
    } else r.seats[i] = { kind: 'empty' };
    return true;
  }

  member(pid: string | null) { return pid ? this.room!.members.find((x) => x.pid === pid) : undefined; }
  humanSeatPids(): string[] {
    const r = this.room!;
    if (!r.game) return [];
    return r.gameSeatPids.filter((p, s): p is string => !!p && r.game!.seats[s].status === 'ACTIVE');
  }

  async startMatch(m: Member, isHost: boolean): Promise<boolean> {
    const r = this.room!;
    if (!isHost) throw new GameError('host_only');
    if (r.status !== 'LOBBY') throw new GameError('bad_state');
    const maint = await this.env.DB?.prepare("SELECT value FROM feature_flags WHERE key='maintenance'").first<{ value: string }>().catch(() => null);
    if (maint && JSON.parse(maint.value)?.enabled) throw new GameError('maintenance');
    if (!anyCategoryEnabled(r.config)) throw new GameError('no_category_enabled');
    let seats = r.seats.slice();
    if (r.config.bots.fillEmpty) {
      const used = seats.filter((x) => x.kind === 'bot').map((x: any) => x.name);
      seats = seats.map((s) => (s.kind === 'empty' ? { kind: 'bot', level: r.config.bots.difficulty, name: BOT_NAMES.find((n) => !used.includes(n) && used.push(n)) ?? 'Bot' } : s));
    }
    const filled = seats.filter((s) => s.kind !== 'empty');
    if (filled.length < 2) throw new GameError('not_enough_players');
    for (const s of filled) if (s.kind === 'human') {
      const mm = this.member(s.pid);
      if (!mm?.connected) throw new GameError('player_disconnected');
      if (!mm.ready && mm.pid !== r.hostPid) throw new GameError('players_not_ready');
    }
    r.seats = seats;
    // immutable snapshot of the rules for this match
    r.matchConfig = structuredClone(r.config);
    r.gameSeatPids = filled.map((s) => (s.kind === 'human' ? s.pid : null));
    r.gameBotLevels = filled.map((s) => (s.kind === 'bot' ? s.level : null));
    const players = filled.map((s) => (s.kind === 'human' ? { name: this.member(s.pid)!.name, isBot: false } : { name: (s as any).name, isBot: true }));
    const now = Date.now();
    r.game = newMatch(players, r.matchConfig, now);
    r.matchNo += 1; r.status = 'PLAYING'; r.nextReady = []; r.racks = {}; r.vote = null; r.pausedUntil = null;
    this.deal(now);
    this.sys(`Partida #${r.matchNo} a început. Runda 1.`);
    return true;
  }

  async gameAction(m: Member, msg: Extract<ClientMsg, { t: 'act' }>): Promise<boolean> {
    const r = this.room!;
    const g = r.game; const cfg = r.matchConfig;
    if (!g || !cfg || r.status !== 'PLAYING') throw new GameError('no_game');
    if (typeof msg.aid !== 'string' || msg.aid.length > 40) throw new GameError('bad_action');
    if (m.recentAids.includes(msg.aid)) { this.sendTo(m.pid, { t: 'ack', aid: msg.aid }); return false; } // duplicate
    if (msg.v !== g.version) throw new GameError('stale_state');
    if (r.vote?.kind === 'save') throw new GameError('save_vote_in_progress');
    const seat = r.gameSeatPids.indexOf(m.pid);
    if (seat < 0) throw new GameError('not_player');
    m.recentAids.push(msg.aid); if (m.recentAids.length > 30) m.recentAids.shift();
    const now = Date.now(); const a = msg.a;
    if (a.type === 'atu') declareAtu(g, cfg, seat, now);
    else if (a.type === 'draw') draw(g, cfg, seat, a.source === 'discard' ? 'discard' : 'pile', now);
    else if (a.type === 'discard') discard(g, cfg, seat, Number(a.tile), now);
    else if (a.type === 'pass') activatePass(g, cfg, seat, Number(a.tile), now);
    else if (a.type === 'close') { close(g, cfg, seat, Number(a.tile), now, a.category); }
    else throw new GameError('bad_action');
    r.botAt = null;
    this.sendTo(m.pid, { t: 'ack', aid: msg.aid });
    await this.afterGameChange();
    return true;
  }

  async afterGameChange() {
    const r = this.room!; const g = r.game!;
    if (g.phase === 'MATCH_FINISHED' && r.status === 'PLAYING') {
      r.status = 'FINISHED';
      const w = g.winner !== null ? g.seats[g.winner].name : '-';
      this.sys(`Partida s-a încheiat. Câștigător: ${w}.`);
      await this.record();
    }
  }

  async record() {
    const r = this.room!;
    if (!this.env.DB || r.recorded.includes(r.matchNo)) return;
    try {
      await recordMatch(this.env, {
        id: `${r.code}-${r.createdAt}-${r.matchNo}`, code: r.code, mode: r.mode, game: r.game!, config: r.matchConfig!,
        players: r.gameSeatPids.map((p) => { const mm = this.member(p); return mm ? { key: mm.playerKey, registered: mm.registered } : null; }),
        hostKey: this.member(r.hostPid)?.playerKey ?? null, tournament: r.tournament,
      });
      r.recorded.push(r.matchNo);
    } catch (e) { console.error(JSON.stringify({ evt: 'record_failed', code: r.code, err: String(e) })); }
  }

  /** Deal a round; training scenarios make the trainee start with a rigged demonstration hand. */
  deal(now: number) {
    const r = this.room!; const g = r.game!; const cfg = r.matchConfig!;
    const trainee = r.gameSeatPids.findIndex((p) => !!p);
    if (r.scenario && trainee >= 0) prepareStarter(g, trainee);
    startRound(g, cfg, secureRng, now);
    if (r.scenario && trainee >= 0) rigScenario(g, trainee, r.scenario, secureRng);
  }

  async nextRound() {
    const r = this.room!; const g = r.game!;
    if (g.phase !== 'ROUND_RESULT') return;
    r.nextReady = []; r.racks = {};
    this.deal(Date.now());
  }

  // ---------------------------------------------------------------- votes (pause / resume / save)
  startVote(m: Member, kind: VoteState['kind']): boolean {
    const r = this.room!; const g = r.game; const cfg = r.matchConfig;
    if (!g || !cfg || r.status !== 'PLAYING') throw new GameError('no_game');
    const seat = r.gameSeatPids.indexOf(m.pid);
    if (seat < 0 || g.seats[seat].status !== 'ACTIVE') throw new GameError('not_player');
    if (r.vote) throw new GameError('vote_in_progress');
    if (kind === 'pause') {
      if (!cfg.pauseVote.enabled) throw new GameError('pause_disabled');
      if (g.pausedRemaining !== null) throw new GameError('already_paused');
      if (m.pauseRequests >= cfg.pauseVote.maxPerPlayer) throw new GameError('pause_limit');
      m.pauseRequests++;
    }
    if (kind === 'resume' && g.pausedRemaining === null) throw new GameError('not_paused');
    if ((kind === 'save' || kind === 'draw') && !['WAITING_FOR_DRAW', 'WAITING_FOR_DISCARD'].includes(g.phase)) throw new GameError('bad_state');
    if (kind === 'draw' && !cfg.drawVote) throw new GameError('draw_vote_disabled');
    if (kind === 'draw' && g.pausedRemaining !== null) throw new GameError('paused');
    const needed = this.humanSeatPids().filter((p) => this.member(p)?.connected);
    r.vote = { kind, by: m.pid, yes: [m.pid], needed, deadline: Date.now() + cfg.pauseVote.voteSeconds * 1000 };
    this.sys(`${m.name} solicită ${kind === 'pause' ? 'pauză' : kind === 'resume' ? 'reluarea jocului' : kind === 'draw' ? 'remiză' : 'salvarea partidei'}.`);
    this.resolveVote();
    return true;
  }

  answerVote(m: Member, yes: boolean): boolean {
    const r = this.room!;
    if (!r.vote || !r.vote.needed.includes(m.pid)) throw new GameError('no_vote');
    if (!yes) { this.sys(`${m.name} a refuzat.`); r.vote = null; return true; }
    if (!r.vote.yes.includes(m.pid)) r.vote.yes.push(m.pid);
    this.resolveVote();
    return true;
  }

  resolveVote() {
    const r = this.room!; const v = r.vote; const g = r.game!; const cfg = r.matchConfig!;
    if (!v) return;
    if (!v.needed.every((p) => v.yes.includes(p))) return; // bots accept automatically (not in needed)
    const now = Date.now();
    r.vote = null;
    if (v.kind === 'draw') {
      agreeDraw(g, cfg, now); r.botAt = null;
      this.sys(cfg.corner.enabled ? `Remiză acceptată. Fiecare pune ${cfg.corner.amount} puncte la colț (colț: ${g.pot}).` : 'Remiză acceptată. Runda se reface.');
      this.ctx.waitUntil(this.afterGameChange());
      return;
    }
    if (v.kind === 'pause') { pause(g, now); r.pausedUntil = now + cfg.pauseVote.maxPauseSeconds * 1000; this.sys('Joc în pauză.'); }
    else if (v.kind === 'resume') { resume(g, now); r.pausedUntil = null; this.sys('Jocul a fost reluat.'); }
    else {
      pause(g, now); r.pausedUntil = null; r.status = 'SAVED'; r.nextReady = [];
      this.sys('Partida a fost salvată. Reveniți oricând cu același cod pentru a o relua.');
      const players = r.gameSeatPids.map((p, s) => ({ name: g.seats[s].name, key: this.member(p)?.playerKey ?? null }));
      this.ctx.waitUntil((async () => {
        await this.env.DB?.prepare('INSERT INTO saved_matches (room_code, saved_at, players_json, status, round) VALUES (?,?,?,?,?) ON CONFLICT(room_code) DO UPDATE SET saved_at=excluded.saved_at, players_json=excluded.players_json, status=excluded.status, round=excluded.round')
          .bind(r.code, now, JSON.stringify(players), 'saved', g.round).run().catch((e) => console.error(String(e)));
      })());
    }
  }

  // ---------------------------------------------------------------- media signalling (players only)
  relayRtc(m: Member, to: string, data: unknown) {
    const r = this.room!;
    const target = this.member(to);
    if (!target || m.role !== 'player' || target.role !== 'player') return;
    if (!r.config.voice && !r.config.video) return;
    const s = JSON.stringify(data ?? null); if (s.length > 32000) return;
    this.sendTo(to, { t: 'rtc', from: m.pid, data });
  }

  // ---------------------------------------------------------------- timers & bots
  isBotControlled(seat: number, now: number): boolean {
    const r = this.room!; const pid = r.gameSeatPids[seat];
    if (!pid) return true;
    const m = this.member(pid);
    if (!m) return true;
    const cfg = r.matchConfig!;
    return !m.connected && cfg.botTakeover && m.disconnectedAt !== null && now - m.disconnectedAt >= cfg.reconnectGraceSeconds * 1000;
  }

  async schedule() {
    const r = this.room; if (!r) return;
    const now = Date.now();
    const times: number[] = [];
    const g = r.game; const cfg = r.matchConfig;
    if (g && cfg && r.status === 'PLAYING' && g.pausedRemaining === null) {
      if (g.phase === 'WAITING_FOR_DRAW' || g.phase === 'WAITING_FOR_DISCARD') {
        if (this.isBotControlled(g.current, now)) {
          if (r.botAt === null) r.botAt = now + thinkDelay((r.gameBotLevels[g.current] as any) ?? 'medium', secureRng);
          times.push(r.botAt);
        } else {
          if (g.turnDeadline) times.push(g.turnDeadline);
          const m = this.member(r.gameSeatPids[g.current]);
          if (m && !m.connected && m.disconnectedAt && cfg.botTakeover) times.push(m.disconnectedAt + cfg.reconnectGraceSeconds * 1000);
        }
        // bots may declare atu on others' turns too (before their first turn)
        if (cfg.atu.enabled && g.atuDeclaredBy.length === 0) {
          for (let s = 0; s < g.seats.length; s++) if (s !== g.current && this.isBotControlled(s, now) && buildView(g, cfg, s).me?.canAtu) times.push(now + 1500);
        }
      }
      if (g.phase === 'ROUND_RESULT' && g.nextRoundAt) times.push(g.nextRoundAt);
    }
    if (r.pausedUntil) times.push(r.pausedUntil);
    if (r.vote) times.push(r.vote.deadline);
    // idle cleanup: unsaved rooms 6h after last activity with no sockets; saved rooms kept 30 days
    times.push(r.lastActivity + (r.status === 'SAVED' ? 30 * 864e5 : 6 * 3600e3));
    const next = Math.max(now + 50, Math.min(...times));
    await this.ctx.storage.setAlarm(next);
  }

  async alarm() {
    const r = await this.load(); if (!r) return;
    const now = Date.now();
    let changed = false;
    if (this.ctx.getWebSockets().length === 0 && now >= r.lastActivity + (r.status === 'SAVED' ? 30 * 864e5 : 6 * 3600e3)) {
      await this.ctx.storage.deleteAll(); this.room = null; return;
    }
    if (r.vote && now >= r.vote.deadline) { this.sys('Votul a expirat.'); r.vote = null; changed = true; }
    const g = r.game; const cfg = r.matchConfig;
    if (g && cfg && r.status === 'PLAYING') {
      if (r.pausedUntil && now >= r.pausedUntil) { resume(g, now); r.pausedUntil = null; this.sys('Pauza a expirat. Jocul continuă.'); changed = true; }
      if (g.pausedRemaining === null) {
        try {
          changed = (await this.tick(now)) || changed;
        } catch (e) { console.error(JSON.stringify({ evt: 'tick_error', code: r.code, err: String((e as any)?.stack ?? e) })); }
      }
    }
    if (changed) { await this.persist(); this.broadcast(); } else await this.ctx.storage.put('room', r);
    await this.schedule();
  }

  /** One step of automatic play. Returns true if state changed. */
  async tick(now: number): Promise<boolean> {
    const r = this.room!; const g = r.game!; const cfg = r.matchConfig!;
    if (g.phase === 'ROUND_RESULT') {
      if (g.nextRoundAt && now >= g.nextRoundAt) { await this.nextRound(); return true; }
      return false;
    }
    if (g.phase !== 'WAITING_FOR_DRAW' && g.phase !== 'WAITING_FOR_DISCARD') return false;
    // bot atu declarations (any bot seat that has not yet played)
    let changed = false;
    if (cfg.atu.enabled) for (let s = 0; s < g.seats.length; s++) {
      if (this.isBotControlled(s, now) && g.seats[s].status === 'ACTIVE' && shouldDeclareAtu(buildView(g, cfg, s))) {
        declareAtu(g, cfg, s, now); changed = true;
        if ((g.phase as string) === 'MATCH_FINISHED') { await this.afterGameChange(); return true; }
      }
    }
    const s = g.current;
    const bot = this.isBotControlled(s, now);
    if (bot) {
      if (r.botAt !== null && now < r.botAt) return changed;
      r.botAt = null;
      const level = ((r.gameBotLevels[s] ?? 'medium') as any);
      await this.botStep(s, level, now);
      return true;
    }
    if (g.turnDeadline && now >= g.turnDeadline) {
      // server-enforced timeout: legal automatic action, never freezes the match
      if (g.phase === 'WAITING_FOR_DRAW') draw(g, cfg, s, 'pile', now);
      const v = buildView(g, cfg, s);
      const mv = decideDiscard(v, cfg, 'medium', secureRng);
      if (mv.type === 'close') close(g, cfg, s, mv.tile, now, mv.category);
      else discard(g, cfg, s, mv.type === 'pass' ? v.me!.hand.find((x) => x !== mv.tile)! : mv.tile, now);
      g.events.push({ n: ++g.eventSeq, type: 'timeout', seat: s });
      await this.afterGameChange();
      return true;
    }
    return changed;
  }

  async botStep(s: number, level: 'easy' | 'medium' | 'hard', now: number) {
    const r = this.room!; const g = r.game!; const cfg = r.matchConfig!;
    if (g.phase === 'WAITING_FOR_DRAW') {
      const src = decideDraw(buildView(g, cfg, s), cfg, level, secureRng);
      draw(g, cfg, s, src === 'discard' && canTakeDiscard(g, cfg, s) ? 'discard' : 'pile', now);
      r.botAt = now + 500 + secureRng(700); // discard shortly after drawing
      return;
    }
    const mv = decideDiscard(buildView(g, cfg, s), cfg, level, secureRng);
    if (mv.type === 'close') close(g, cfg, s, mv.tile, now, mv.category);
    else if (mv.type === 'pass') activatePass(g, cfg, s, mv.tile, now);
    else discard(g, cfg, s, mv.tile, now);
    await this.afterGameChange();
  }

  // ---------------------------------------------------------------- output
  sys(text: string) {
    const r = this.room!;
    r.chat.push({ id: ++r.chatSeq, pid: '', name: '', text, ts: Date.now(), kind: 'system' });
    if (r.chat.length > 60) r.chat.splice(0, r.chat.length - 60);
  }

  roomView(): RoomView {
    const r = this.room!; const now = Date.now();
    const seatOf = (pid: string) => { const i = r.seats.findIndex((s) => s.kind === 'human' && s.pid === pid); return i >= 0 ? i : null; };
    const members: PublicMember[] = r.members.map((m) => {
      const gs = r.gameSeatPids.indexOf(m.pid);
      return { pid: m.pid, name: m.name, role: m.role, ready: m.ready, connected: m.connected, isHost: m.pid === r.hostPid, seat: seatOf(m.pid),
        botControlled: gs >= 0 && !!r.game && r.status === 'PLAYING' && this.isBotControlled(gs, now), mic: m.mic, cam: m.cam, registered: m.registered };
    });
    return { code: r.code, status: r.status, hostPid: r.hostPid, config: r.status === 'LOBBY' ? r.config : r.matchConfig ?? r.config, locked: r.status !== 'LOBBY',
      seats: r.seats, members, chat: r.chat.slice(-40), vote: r.vote, pausedUntil: r.pausedUntil, nextReady: r.nextReady,
      gameSeatPids: r.gameSeatPids, matchNo: r.matchNo, maintenance: false, serverTime: now, mode: r.mode, scenario: r.scenario };
  }

  sendState(ws: WebSocket, m: Member) {
    const r = this.room!;
    const seat = r.gameSeatPids.indexOf(m.pid);
    const room = this.roomView();
    this.send(ws, { t: 'room', room, you: { pid: m.pid, role: m.role, seat: seat >= 0 ? seat : null, isHost: r.hostPid === m.pid } });
    const view = r.game && r.matchConfig ? buildView(r.game, r.matchConfig, seat >= 0 ? seat : null) : null;
    this.send(ws, { t: 'game', view, rack: r.racks[m.pid] ?? null });
  }

  broadcast(_except?: string) {
    const r = this.room; if (!r) return;
    const room = this.roomView();
    for (const ws of this.ctx.getWebSockets()) {
      const pid = this.pidOf(ws); const m = this.member(pid); if (!m) continue;
      const seat = r.gameSeatPids.indexOf(m.pid);
      this.send(ws, { t: 'room', room, you: { pid: m.pid, role: m.role, seat: seat >= 0 ? seat : null, isHost: r.hostPid === m.pid } });
      const view = r.game && r.matchConfig ? buildView(r.game, r.matchConfig, seat >= 0 ? seat : null) : null;
      this.send(ws, { t: 'game', view });
    }
  }

  sendTo(pid: string, msg: ServerMsg) { for (const ws of this.ctx.getWebSockets(pid)) this.send(ws, msg); }
  send(ws: WebSocket, msg: ServerMsg) { try { ws.send(JSON.stringify(msg)); } catch { /* socket closed */ } }
}
