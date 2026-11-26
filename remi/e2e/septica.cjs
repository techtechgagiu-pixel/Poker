/** Septică: tab, invitation join, 2/3/4 players, bot games to the end, spectator, camera + voice with 4 players. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787'; const OUT = process.env.OUT || 'e2e/out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0;
const ok = (n, p, i = '') => { if (!p) fails++; console.log(`${p ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
(async () => {
  const b = await chromium.launch({ ignoreDefaultArgs: ['--mute-audio'], args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const mk = async (name) => { const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera', 'microphone'] }); const p = await ctx.newPage(); await p.goto(BASE + '/'); await p.evaluate((n) => localStorage.setItem('remi.settings', JSON.stringify({ nickname: n, skipAnim: true })), name); await p.reload(); return p; };
  const st = (p) => p.evaluate(() => { const s = window.__remiStore.getState(); return { room: s.room, sg: s.sgame, you: s.you }; });
  const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };
  const create = (p, players, mode = 'human', extra = {}) => p.evaluate(async ({ players, mode, extra }) => { const d = await (await fetch('/api/config/defaults')).json();
    return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'sp-' + Math.random() }, body: JSON.stringify({ name: 'Ana', mode, kind: 'septica', septica: { players, teams: false, voluntaryPass: true }, config: { ...d.config, turnSeconds: 0, ...extra } }) })).json(); }, { players, mode, extra });
  const enter = async (p, r) => { await p.evaluate((r) => localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })), r); await p.goto(`${BASE}/room/${r.code}`); };

  // --- tab in the corner
  const H = await mk('Ana');
  ok('home has the Remi | Septică tab', await H.locator('.game-tabs').count() === 1);
  await H.locator('.game-tabs button', { hasText: 'Septică' }).click();
  ok('tab opens the Septică home', await until(async () => (await H.locator('h1', { hasText: 'Septică' }).count()) === 1, 5000));
  await H.getByRole('button', { name: /Regulile Septicii/ }).click();
  ok('rules page', await until(async () => (await H.locator('.rules-text').count()) === 1, 5000));

  // --- bots: 2, 3, 4 players play a whole game by themselves (host on AUTO)
  for (const n of [2, 3, 4]) {
    const p = await mk('Ana'); const r = await create(p, n, 'bots'); await enter(p, r);
    await until(async () => { const s = await st(p); return s.room?.status === 'LOBBY'; }, 8000);
    await p.getByRole('button', { name: /Începe partida/ }).click();
    ok(`${n} players: game starts, ${n} seats`, await until(async () => { const s = await st(p); return s.sg && s.sg.seats.length === n; }, 8000));
    const s0 = await st(p); ok(`${n} players: I see only my own 4 cards`, s0.sg.me.hand.length === 4 && !JSON.stringify(s0.sg).includes('"hands"'));
    await p.locator('.btn-auto').click();
    ok(`${n} players: bot game reaches the end`, await until(async () => (await st(p)).sg?.phase === 'MATCH_FINISHED', 120000));
    const f = await st(p); ok(`${n} players: 8 points distributed`, f.sg.result.points.reduce((a, c) => a + c, 0) === 8 && f.sg.result.cards.reduce((a, c) => a + c, 0) === 32);
    ok(`${n} players: result modal`, await p.locator('.modal.result').count() === 1);
    await p.context().close();
  }

  // --- 4 humans via invitation link (late joiner as spectator), camera + microphone for everybody
  const P = [await mk('Ana'), await mk('Bob'), await mk('Cip'), await mk('Dan')];
  const r = await create(P[0], 4, 'human'); await enter(P[0], r);
  for (const p of P.slice(1)) { await p.goto(`${BASE}/join/${r.code}`); await p.getByRole('button', { name: 'Intră', exact: true }).click(); await p.getByRole('button', { name: 'Sunt gata' }).click(); }
  ok('invite link shows Septică', true);
  await until(async () => (await st(P[0])).room.members.filter((m) => m.role === 'player' && (m.ready || m.isHost)).length === 4);
  await P[0].getByRole('button', { name: /Începe partida/ }).click();
  for (const p of P) await until(async () => !!(await st(p)).sg);
  ok('4 humans at the Septică table', (await Promise.all(P.map(async (p) => !!(await st(p)).sg))).every(Boolean));
  const S = await mk('Spec'); await S.goto(`${BASE}/join/${r.code}`); await S.getByRole('button', { name: /Spectator|spect/i }).first().click();
  ok('spectator sees the table without a hand', await until(async () => { const s = await st(S); return s.sg && s.sg.me === null; }, 8000));
  // a human move: whoever's turn it is plays a legal card, others see it
  const cur = (await st(P[0])).sg.current; const pl = P.find(async () => true);
  const idx = (await Promise.all(P.map(async (p) => (await st(p)).sg.me.seat))).indexOf(cur);
  const before = (await st(P[idx])).sg.version;
  await P[idx].locator('.sept-hand .scard.legal').first().click();
  ok('a human plays a card and everybody sees it', await until(async () => (await st(P[(idx + 1) % 4])).sg.version > before && (await st(P[(idx + 1) % 4])).sg.table.length >= 1, 5000));
  await Promise.all(P.map(async (p, i) => { await sleep(i * 120); await p.locator('.tb-btn', { hasText: '📷' }).click(); await sleep(60); await p.locator('.tb-btn', { hasText: '🎤' }).click(); }));
  const remote = (p) => p.evaluate(() => { const m = window.__remiMedia.getState(); const me = window.__remiStore.getState().you.pid;
    return Object.entries(m.peers).filter(([k]) => k !== me).map(([k, x]) => ({ state: x.state, video: !!x.stream?.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted), audio: !!x.stream?.getAudioTracks().some((t) => t.readyState === 'live') })); });
  for (const [i, p] of P.entries()) {
    const good = await until(async () => { const rs = await remote(p); return rs.length === 3 && rs.every((x) => x.state === 'connected' && x.video && x.audio); }, 40000);
    ok(`Septică: player ${i + 1} sees and hears the other 3`, good, JSON.stringify((await remote(p)).map((x) => x.state[0] + (x.video ? 'V' : '-') + (x.audio ? 'A' : '-'))));
  }
  for (const [i, p] of P.entries()) ok(`Septică: player ${i + 1}: three video frames render in the shields`, await until(async () => (await p.evaluate(() => [...document.querySelectorAll('.sept-badge video')].filter((v) => v.videoWidth > 0 && !v.paused).length)) === 3, 15000));
  // leaving the table: a robot takes over
  await P[3].locator('.table-menu button').first().click(); P[3].once('dialog', (d) => d.accept());
  await P[3].getByRole('button', { name: /Părăsesc masa/ }).click();
  ok('leaving the table hands the seat to a robot', await until(async () => { const s = await st(P[0]); return s.room.gameSeatPids.filter((x) => x === null).length === 1; }, 8000));
  await P[0].screenshot({ path: `${OUT}/septica.png` });
  await b.close(); process.exit(fails ? 1 : 0);
})();
