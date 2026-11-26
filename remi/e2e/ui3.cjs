/** Flaming frame for the PASS player, tile turned face-down by double tap, timer only for the player on turn. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787'; const OUT = process.env.OUT || 'e2e/out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0;
const ok = (n, p, i = '') => { if (!p) fails++; console.log(`${p ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 810 } }); const page = await ctx.newPage();
  await page.goto(BASE + '/');
  const mk = async (mode, scenario, turn) => {
    const r = await page.evaluate(async ([mode, scenario, turn]) => { localStorage.setItem('remi.settings', JSON.stringify({ nickname: 'Ui', skipAnim: false }));
      const d = await (await fetch('/api/config/defaults')).json();
      return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'ui3-' + Date.now() + Math.random() }, body: JSON.stringify({ name: 'Ui', mode, scenario, config: { ...d.config, turnSeconds: turn } }) })).json(); }, [mode, scenario, turn]);
    await page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, r);
    await page.goto(`${BASE}/room/${r.code}`); await page.waitForSelector('.rack-tile'); await sleep(900);
  };
  // ---- PASS flames
  await mk('training', 'pass', 0);
  ok('no flames before PASS', (await page.locator('.avatar-wrap.flaming').count()) === 0);
  await page.locator('.btn-pass').click(); await sleep(900);
  ok('flaming frame appears on the player who activated PASS (and only on them)', (await page.locator('.avatar-wrap.flaming').count()) === 1 && (await page.locator('.my-badge .avatar-wrap.flaming').count()) === 1 && (await page.locator('.flames i').count()) >= 10);
  await page.screenshot({ path: `${OUT}/flames.png`, clip: { x: 0, y: 560, width: 400, height: 250 } });
  // ---- double tap flips a tile; double tap again turns it back
  const t = page.locator('.rack-tile').nth(3); const id = await t.locator('[data-tile]').getAttribute('data-tile');
  await t.dblclick(); await sleep(250);
  const flipped = await page.locator(`.rack-tile [data-tile="${id}"]`).evaluate((e) => e.classList.contains('flipped'));
  const text = await page.locator(`.rack-tile [data-tile="${id}"]`).innerText();
  ok('double tap turns the tile face-down (blank white back, no number)', flipped && text.trim() === '');
  ok('flipping does not leave the tile selected', (await page.evaluate(() => window.__remiStore.getState().selected.length)) === 0);
  await page.screenshot({ path: `${OUT}/flipped.png`, clip: { x: 250, y: 780 - 230, width: 1100, height: 230 } });
  await page.locator(`.rack-tile [data-tile="${id}"]`).dblclick(); await sleep(250);
  ok('double tap again turns it back face-up', !(await page.locator(`.rack-tile [data-tile="${id}"]`).evaluate((e) => e.classList.contains('flipped'))));
  await t.click(); await sleep(150);
  ok('a single tap still just selects', (await page.evaluate(() => window.__remiStore.getState().selected.length)) === 1);
  // ---- timer
  await mk('bots', null, 30);
  const info = () => page.evaluate(() => { const g = window.__remiStore.getState().game; return { mine: g.current === g.me.seat, idle: document.querySelector('.me-left .timer').classList.contains('idle'), txt: document.querySelector('.me-left .timer').textContent, seatTimers: document.querySelectorAll('.seat-timer').length }; });
  let sawOpp = false, sawMine = false, bad = false; const t0 = Date.now();
  while (Date.now() - t0 < 40000 && !(sawOpp && sawMine)) {
    const i = await info();
    if (i.mine && i.idle) bad = true;
    if (!i.mine && !i.idle) bad = true;
    if (!i.mine && i.seatTimers === 1) sawOpp = true;
    if (i.mine) { sawMine = true; if (i.seatTimers !== 0) bad = true; }
    await sleep(250);
  }
  ok('my timer runs only on my turn; during others\' turns it is dimmed and the player on turn shows the countdown', sawMine && sawOpp && !bad, `mine=${sawMine} opp=${sawOpp} bad=${bad}`);
  await page.screenshot({ path: `${OUT}/timer-opp.png` });
  await b.close(); process.exit(fails ? 1 : 0);
})();
