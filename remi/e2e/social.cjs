/** Social platform in production: profiles, friends, invitations, notifications, blocking, leaderboard, tournaments, deletion. */
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = process.env.OUT || 'e2e/out'; fs.mkdirSync(OUT, { recursive: true });
const results = []; const ok = (n, p, i = '') => { results.push({ name: n, pass: p, info: i }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
const tag = Math.random().toString(36).slice(2, 7);

async function user(browser, name) {
  const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.goto(BASE + '/');
  const call = (path, body, method) => page.evaluate(async ([path, body, method]) => {
    const h = { 'content-type': 'application/json', 'x-guest': localStorage.getItem('remi.guest') || (localStorage.setItem('remi.guest', 'g-' + crypto.randomUUID()), localStorage.getItem('remi.guest')) };
    const s = localStorage.getItem('remi.session'); if (s) h.authorization = 'Bearer ' + s;
    const r = await fetch(path, { method: method || (body ? 'POST' : 'GET'), headers: h, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  }, [path, body, method]);
  const reg = await call('/api/auth/register', { username: `e2e_${name}_${tag}`, nickname: name });
  await page.evaluate((t) => localStorage.setItem('remi.session', t), reg.data.token);
  return { ctx, page, call, reg, username: `e2e_${name}_${tag}`, id: reg.data.userId };
}

(async () => {
  const browser = await chromium.launch();
  const users = [];
  try {
    const A = await user(browser, 'ana'); const B = await user(browser, 'bob'); const C = await user(browser, 'cip');
    users.push(A, B, C);
    ok('registration returns session + one-time recovery key (no password stored)', A.reg.status === 200 && A.reg.data.recoveryKey.length >= 20);
    const dup = await B.call('/api/auth/register', { username: A.username });
    ok('duplicate username rejected', dup.status === 409);
    const bad = await A.call('/api/auth/login', { username: A.username, recoveryKey: 'wrong' });
    const good = await A.call('/api/auth/login', { username: A.username, recoveryKey: A.reg.data.recoveryKey });
    ok('login with recovery key works, wrong key rejected', bad.status === 401 && good.status === 200);
    const anon = await browser.newContext(); const ap = await anon.newPage(); await ap.goto(BASE + '/');
    const unauth = await ap.evaluate(async () => (await fetch('/api/friends')).status);
    ok('friends API requires authentication', unauth === 401);
    // search + request + accept
    const s = await A.call('/api/users/search?q=' + encodeURIComponent(B.username.slice(0, 8)));
    ok('username search finds users without exposing private fields', s.data.users.some((u) => u.username === B.username) && !JSON.stringify(s.data).includes('recovery'));
    await A.call('/api/friends/request', { username: B.username });
    const dupReq = await A.call('/api/friends/request', { username: B.username });
    ok('duplicate friend request rejected', dupReq.status === 409);
    const nb = await B.call('/api/notifications');
    ok('friend request notification delivered', nb.data.notifications.some((n) => n.kind === 'friendRequest'));
    await B.call('/api/friends/respond', { userId: A.id, accept: true });
    const fa = await A.call('/api/friends');
    ok('friend request accepted; presence visible to friends', fa.data.friends.some((f) => f.id === B.id && f.status === 'accepted' && f.presence));
    // direct invitation
    const room = await A.call('/api/rooms', { name: 'ana', mode: 'human' });
    const inv = await A.call('/api/invite', { userId: B.id, code: room.data.code });
    const inv2 = await A.call('/api/invite', { userId: B.id, code: room.data.code });
    const nb2 = await B.call('/api/notifications');
    ok('direct room invitation delivered once (deduplicated)', inv.status === 200 && inv2.status === 200 && nb2.data.notifications.filter((n) => n.kind === 'invite').length === 1);
    const invC = await A.call('/api/invite', { userId: C.id, code: room.data.code });
    ok('cannot invite a non-friend', invC.status === 403);
    // blocking
    await C.call('/api/friends/block', { userId: A.id });
    const req2 = await A.call('/api/friends/request', { username: C.username });
    const s2 = await A.call('/api/users/search?q=' + encodeURIComponent(C.username));
    ok('blocked user cannot send requests or find the blocker', req2.status === 404 && !s2.data.users.some((u) => u.id === C.id));
    // leaderboard
    const lb = await A.call('/api/leaderboard?period=month&mode=human&min=1');
    ok('private friends leaderboard includes self and friends only', lb.status === 200 && lb.data.board.some((r) => r.id === B.id) && !lb.data.board.some((r) => r.id === C.id));
    // tournament
    const t = await A.call('/api/tournaments', { name: 'Cupa e2e', format: 'roundrobin', maxPlayers: 4, points: [3, 2, 1, 0] });
    const j = await B.call('/api/tournaments/join', { code: t.data.code });
    const st = await A.call(`/api/tournaments/${t.data.id}/start`, {});
    const notOwner = await B.call(`/api/tournaments/${t.data.id}/start`, {});
    const td = await B.call(`/api/tournaments/${t.data.id}`);
    ok('tournament: create, join by code, owner-only start, schedule generated', j.status === 200 && st.status === 200 && [403, 409].includes(notOwner.status), `${td.data.matches.length} match(es)`);
    const outsider = await C.call(`/api/tournaments/${t.data.id}`);
    ok('non-participants cannot read the tournament', outsider.status === 403);
    const m = td.data.matches[0];
    const roomA = await A.call(`/api/tournaments/${t.data.id}/room/${m.id}`, {});
    const roomB = await B.call(`/api/tournaments/${t.data.id}/room/${m.id}`, {});
    const intr = await C.call(`/api/rooms/${roomA.data.code}/join`, { name: 'cip' });
    ok('tournament match room shared by participants; outsiders cannot take a seat', roomA.data.code && roomA.data.code === roomB.data.code && intr.status === 400 && intr.data.error === 'tournament_participants_only');
    // export + deletion
    const ex = await A.call('/api/me/export');
    ok('data export contains profile and stats', ex.status === 200 && ex.data.user.username === A.username);
  } catch (e) { ok('social run', false, String(e && e.stack || e)); }
  finally {
    for (const u of users) { const d = await u.call('/api/me', undefined, 'DELETE'); if (u === users[0]) ok('account deletion', d.status === 200 && (await u.call('/api/me')).status === 401); }
    await browser.close();
    fs.writeFileSync(`${OUT}/social.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
    const failed = results.filter((r) => !r.pass).length; console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
  }
})();
