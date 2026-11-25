/** Static files served from R2 (Workers Static Assets uploads are not available from this deploy environment). */
import type { Env } from './db';

const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8', woff2: 'font/woff2' };
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(self), microphone=(self), fullscreen=(self), gamepad=(self), screen-wake-lock=(self), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss://remi.noventra.ro wss://remi-dev.noventra.ro; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

export async function serveStatic(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const url = new URL(req.url);
  let key = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (key.includes('..')) return new Response('Bad path', { status: 400 });
  const immutable = key.startsWith('assets/');
  const cache = (caches as any).default as Cache;
  if (immutable) { const hit = await cache.match(req); if (hit) return hit; }
  let obj = key ? await env.STATIC.get(key) : null;
  if (!obj && !/\.[a-z0-9]+$/i.test(key)) { key = 'index.html'; obj = await env.STATIC.get(key); } // SPA routes
  if (!obj) return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
  const ext = key.split('.').pop()!.toLowerCase();
  const h = new Headers(SECURITY_HEADERS);
  h.set('content-type', TYPES[ext] ?? 'application/octet-stream');
  h.set('etag', obj.httpEtag);
  h.set('cache-control', immutable ? 'public, max-age=31536000, immutable' : key.startsWith('icons/') ? 'public, max-age=604800' : 'no-cache');
  const res = new Response(req.method === 'HEAD' ? null : obj.body, { headers: h });
  if (immutable) ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}
