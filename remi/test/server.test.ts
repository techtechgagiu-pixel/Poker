import { describe, it, expect, vi, beforeAll } from 'vitest';
import { verifyAccess } from '../src/worker/admin';
import { schedule, tables } from '../src/worker/social';
import { sanitizeConfig, defaultConfig } from '../src/engine/config';

const b64u = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
let keys: CryptoKeyPair; let jwk: any;
const TEAM = 'team.cloudflareaccess.com', AUD = 'aud123';
async function sign(payload: any, kid = 'k1', key = keys.privateKey) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid })), p = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
const env: any = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: 'admin@example.com' };
const req = (tok?: string) => new Request('https://x/api/admin/whoami', { headers: tok ? { 'cf-access-jwt-assertion': tok } : {} });
const good = () => ({ email: 'admin@example.com', aud: [AUD], iss: `https://${TEAM}`, exp: Math.floor(Date.now() / 1000) + 600 });

beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', alg: 'RS256' };
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [jwk] })));
});

describe('admin authorization (server side)', () => {
  it('accepts a valid Access JWT for an allow-listed email', async () => {
    expect(await verifyAccess(req(await sign(good())), env)).toBe('admin@example.com');
  });
  it('rejects missing, forged, wrong audience, expired, wrong issuer and non-allow-listed tokens', async () => {
    expect(await verifyAccess(req(), env)).toBeNull();
    const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    expect(await verifyAccess(req(await sign(good(), 'k1', other.privateKey)), env)).toBeNull();
    expect(await verifyAccess(req(await sign({ ...good(), aud: ['nope'] })), env)).toBeNull();
    expect(await verifyAccess(req(await sign({ ...good(), exp: 1 })), env)).toBeNull();
    expect(await verifyAccess(req(await sign({ ...good(), iss: 'https://evil' })), env)).toBeNull();
    expect(await verifyAccess(req(await sign({ ...good(), email: 'someone@else.com' })), env)).toBeNull();
    expect(await verifyAccess(req(await sign(good())), { ...env, ADMIN_EMAILS: '' })).toBeNull();
  });
});

describe('tournaments', () => {
  it('splits players into tables of 2-4', () => {
    expect(tables(['a', 'b', 'c'])).toEqual([['a', 'b', 'c']]);
    const t = tables('abcdefghij'.split(''));
    expect(t.every((x) => x.length >= 2 && x.length <= 4)).toBe(true);
    expect(t.flat().sort().join('')).toBe('abcdefghij');
  });
  it('round robin covers every pair', () => {
    for (const n of [3, 4, 5, 6, 7, 8, 9, 12]) { const ps = 'abcdefghijkl'.slice(0, n).split('');
    const rounds = schedule('roundrobin', ps, 3);
    const met = new Set<string>();
    for (const r of rounds) for (const t of r) for (const x of t) for (const y of t) if (x < y) met.add(x + y);
    expect(met.size).toBe((n * (n - 1)) / 2);
    for (const r of rounds) expect(r.flat().sort().join('')).toBe(ps.join('')); }
  });
  it('league has the configured number of rounds', () => { expect(schedule('league', 'abcdef'.split(''), 4)).toHaveLength(4); });
});

describe('config sanitisation (untrusted client input)', () => {
  it('clamps values and drops junk', () => {
    const c = sanitizeConfig({ startingScore: -5, turnSeconds: 2, categories: { grand: { enabled: 'yes', penalty: 1e9 } }, priority: ['grand', 'evil', 'grand'], __proto__: { x: 1 }, extra: 1 } as any);
    expect(c.startingScore).toBe(1);
    expect(c.turnSeconds).toBe(5);
    expect(c.categories.grand.enabled).toBe(true); // non-boolean ignored -> default
    expect(c.categories.grand.penalty).toBe(10000);
    expect(c.priority).toEqual(['grand']);
    expect((c as any).extra).toBeUndefined();
  });
  it('defaults are the Remy Pro Custom preset', () => { expect(sanitizeConfig({})).toEqual(defaultConfig()); });
});
