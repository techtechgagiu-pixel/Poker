/** A robot replaces a player at once when they leave the table or the app goes to the background. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0;
const ok = (n, p, i = '') => { if (!p) fails++; console.log(`${p ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
const st = (p) => p.evaluate(() => { const s = window.__remiStore.getState(); return { room: s.room, game: s.game, you: s.you }; });
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };
(async () => {
  const b = await chromium.launch();
  const mk = async (n) => { const c = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p = await c.newPage(); await p.goto(BASE + '/'); await p.evaluate((n) => localStorage.setItem('remi.settings', JSON.stringify({ nickname: n })), n); return p; };
  const A = await mk('Ana'), B = await mk('Bob');
  const r = await A.evaluate(async () => { const d = await (await fetch('/api/config/defaults')).json();
    return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'away-' + Date.now() }, body: JSON.stringify({ name: 'Ana', mode: 'human', config: { ...d.config, turnSeconds: 0 } }) })).json(); });
  await A.evaluate((r) => localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })), r);
  await A.goto(`${BASE}/room/${r.code}`);
  await B.goto(`${BASE}/join/${r.code}`); await B.getByRole('button', { name: 'Intră', exact: true }).click(); await B.getByRole('button', { name: 'Sunt gata' }).click();
  await until(async () => (await st(A)).room.members.every((m) => m.role !== 'player' || m.ready || m.isHost));
  await A.getByRole('button', { name: 'Începe partida' }).click();
  await until(async () => !!(await st(B)).game?.me);
  const bobPid = (await st(B)).you.pid;
  await A.locator('.btn-auto').click(); // Ana plays automatically so the table reaches Bob's turn
  // 1) Bob's app goes to the background
  await B.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  ok('background -> Bob is marked away for everyone (robot tag shown on Ana\'s screen)', await until(async () => (await st(A)).room.members.find((m) => m.pid === bobPid)?.away === true, 8000) && await until(async () => (await A.locator('.sb-tag', { hasText: 'robot' }).count()) >= 1, 4000));
  // it must be Bob's turn at some point and the robot must play it without Bob doing anything
  const seatB = (await st(B)).game.me?.seat;
  let played = false; const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !played) {
    const g = (await st(A)).game;
    if (g.current === seatB && g.phase.startsWith('WAITING')) { const v = g.version; played = await until(async () => (await st(A)).game.version > v, 9000); }
    else await sleep(300);
  }
  ok('the robot plays Bob\'s turn within seconds, with no input from Bob', played);
  // 2) Bob comes back
  await B.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  ok('coming back clears the robot', await until(async () => (await st(A)).room.members.find((m) => m.pid === bobPid)?.away === false, 6000));
  // 3) Bob leaves the table on purpose (SPA navigation) -> a bot takes the seat for good, Bob is removed
  await B.evaluate(() => window.__remiStore.getState().navigate('/'));
  const replaced = await until(async () => { const s = await st(A); return !s.room.members.some((m) => m.pid === bobPid) && s.game.seats.filter((x) => x.isBot).length === 3; }, 8000);
  ok('leaving the table: Bob is removed and a bot has his seat', replaced);
  // 4) Bob opens the link again and takes a bot seat back
  await B.goto(`${BASE}/join/${r.code}`); await B.getByRole('button', { name: 'Intră', exact: true }).click();
  ok('the invitation link still works: Bob replaces a bot', await until(async () => !!(await st(B)).game?.me, 10000));
  await b.close(); process.exit(fails ? 1 : 0);
})();
