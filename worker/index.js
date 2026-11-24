// Cloudflare Worker: fisiere statice (public/) + o singura masa de poker intr-un Durable Object.
import { DurableObject } from 'cloudflare:workers';
import { Game } from '../server/game.js';

export class PokerRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    for (const k of ['OPENROUTER_API_KEY', 'OPENROUTER_MODELS', 'BLIND_MINUTES', 'DECISION_MS', 'START_STACK', 'SPEED', 'AI_MODE'])
      if (env[k] !== undefined) process.env[k] = String(env[k]);
    this.clients = new Set();
    this.enc = new TextEncoder();
    this.game = new Game((type, payload) => this.broadcast(type, payload));
  }
  broadcast(type, payload) {
    const msg = this.enc.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    for (const c of [...this.clients]) c.write(msg).catch(() => this.clients.delete(c));
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/api/events') {
      const { readable, writable } = new TransformStream();
      const w = writable.getWriter();
      this.clients.add(w);
      w.write(this.enc.encode(`event: state\ndata: ${JSON.stringify(this.game.snapshot())}\n\n`));
      const ka = setInterval(() => w.write(this.enc.encode(': ka\n\n')).catch(() => { clearInterval(ka); this.clients.delete(w); }), 15000);
      return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }
    if (url.pathname === '/api/start' && req.method === 'POST') {
      if (this.game.phase !== 'running') this.ctx.waitUntil(this.game.start());
      return Response.json({ ok: true });
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') { this.game.reset(); return Response.json({ ok: true }); }
    return new Response('404', { status: 404 });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return env.ROOM.get(env.ROOM.idFromName('main')).fetch(req);
    const key = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const obj = await env.STATIC.get(key);
    if (!obj) return new Response('404', { status: 404 });
    const h = new Headers({ 'Cache-Control': 'public, max-age=300' });
    obj.writeHttpMetadata(h);
    return new Response(obj.body, { headers: h });
  },
};
