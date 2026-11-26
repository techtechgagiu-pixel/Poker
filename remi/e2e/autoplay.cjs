/** AUTO: the server plays my turns; stops when toggled off. Also: shields in every theme, one background sound at a time. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787'; const OUT = process.env.OUT || 'e2e/out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0;
const ok = (n, p, i = '') => { if (!p) fails++; console.log(`${p ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
(async () => {
  const b = await chromium.launch({ ignoreDefaultArgs: ['--mute-audio'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 810 } }); const page = await ctx.newPage();
  await page.goto(BASE + '/');
  const r = await page.evaluate(async () => { localStorage.setItem('remi.settings', JSON.stringify({ nickname: 'Auto', confirmJoker: false }));
    const d = await (await fetch('/api/config/defaults')).json();
    return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'auto-' + Date.now() }, body: JSON.stringify({ name: 'Auto', mode: 'bots', config: { ...d.config, turnSeconds: 0 } }) })).json(); });
  await page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, r);
  await page.goto(`${BASE}/room/${r.code}`);
  await page.waitForSelector('.rack-tile'); await sleep(800);
  const st = () => page.evaluate(() => { const s = window.__remiStore.getState(); return { g: s.game, me: s.room.members.find((m) => m.pid === s.you.pid) }; });
  // shields
  for (const th of ['mahogany', 'walnut', 'black', 'oak', 'midnight', 'arena']) {
    await page.evaluate((th) => window.__remiStore.getState().setSettings({ theme: th }), th);
    await sleep(250);
    const clip = await page.evaluate(() => getComputedStyle(document.querySelector('.seat-badge .avatar')).clipPath);
    if (th === 'mahogany') await page.screenshot({ path: `${OUT}/shield-mahogany.png` });
    ok(`shield frame in theme ${th}`, clip.startsWith('polygon'));
  }
  // single background sound
  await page.mouse.click(5, 300);
  await page.evaluate(() => window.__remiStore.getState().setSettings({ music: 0.6, ambient: 'none', musicTrack: 'piano' })); await sleep(1500);
  const m1 = await page.evaluate(() => window.__remiMusic());
  await page.evaluate(() => window.__remiStore.getState().setSettings({ ambient: 'waves', musicTrack: 'none' })); await sleep(1500);
  const m2 = await page.evaluate(() => window.__remiMusic());
  ok('melody and ambience are exclusive (one background sound)', m1.playing === 'piano' && m2.playing === null);
  await page.evaluate(() => window.__remiStore.getState().setSettings({ music: 0 }));
  // autoplay
  await page.locator('.btn-auto').click();
  const t0 = await st();
  ok('AUTO turns on for me and is visible to the table', await page.waitForFunction(() => { const s = window.__remiStore.getState(); return s.room.members.find((m) => m.pid === s.you.pid).autoplay; }, null, { timeout: 5000 }).then(() => true).catch(() => false));
  let myTurns = 0; let lastCurrent = -1; const seat = t0.g.me.seat; const t1 = Date.now();
  while (Date.now() - t1 < 45000 && myTurns < 2) {
    const s = await st();
    if (s.g.phase === 'ROUND_RESULT' || s.g.phase === 'MATCH_FINISHED') break;
    if (lastCurrent === seat && s.g.current !== seat) myTurns++;
    lastCurrent = s.g.current; await sleep(200);
  }
  ok('the server played my turns while AUTO was on (no clicks from me)', myTurns >= 2, `${myTurns} turns`);
  await page.locator('.btn-auto').click();
  const off = await page.waitForFunction(() => { const s = window.__remiStore.getState(); return !s.room.members.find((m) => m.pid === s.you.pid).autoplay; }, null, { timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForFunction((seat) => { const g = window.__remiStore.getState().game; return (g.current === seat && g.phase.startsWith('WAITING')) || !g.phase.startsWith('WAITING'); }, seat, { timeout: 30000 }).catch(() => null);
  const v = (await st()).g.version; await sleep(4000); const v2 = (await st()).g;
  ok('AUTO off: my turn waits for me again', off && (v2.version === v || !v2.phase.startsWith('WAITING')));
  await b.close(); process.exit(fails ? 1 : 0);
})();
