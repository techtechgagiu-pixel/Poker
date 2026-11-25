/** REST helpers. Guest identity is a random secret kept in localStorage; profiles use a bearer session. */
function ls(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } }

export function guestSecret(): string {
  let g = ls('remi.guest');
  if (!g) { const a = new Uint8Array(24); crypto.getRandomValues(a); g = [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); lsSet('remi.guest', g); }
  return g;
}
export const session = { get: () => ls('remi.session'), set: (v: string | null) => lsSet('remi.session', v) };
export const roomTokens = {
  get: (code: string): { token: string; pid: string } | null => { try { return JSON.parse(ls('remi.room.' + code) ?? 'null'); } catch { return null; } },
  set: (code: string, v: { token: string; pid: string }) => lsSet('remi.room.' + code, JSON.stringify(v)),
  clear: (code: string) => lsSet('remi.room.' + code, null),
};

export class ApiError extends Error { constructor(public code: string, public status: number) { super(code); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-guest': guestSecret() };
  const s = session.get(); if (s) headers.authorization = 'Bearer ' + s;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(path, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((data as any).error ?? 'http_' + r.status, r.status);
  return data as T;
}
