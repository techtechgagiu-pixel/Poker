/** Touch-drag (CDP touch events, iPhone landscape) a rack tile onto the edge of the own discard stack. */
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); let fails = 0;
  for (const where of ['border-top-left', 'border-bottom-right', 'center', 'near-outside']) {
    const ctx = await b.newContext({ ...devices['iPhone 13 landscape'] });
    const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
    await page.goto(BASE + '/');
    const r = await page.evaluate(async () => { localStorage.setItem('remi.settings', JSON.stringify({ nickname: 'Touch', skipAnim: true, confirmJoker: false }));
      const d = await (await fetch('/api/config/defaults')).json();
      return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'touch-' + Date.now() }, body: JSON.stringify({ name: 'Touch', mode: 'training', scenario: 'normalPlain', config: { ...d.config, turnSeconds: 0 } }) })).json(); });
    await page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, r);
    await page.goto(`${BASE}/room/${r.code}`);
    await page.waitForFunction(() => { const g = window.__remiStore.getState().game; return g?.me && g.phase === 'WAITING_FOR_DISCARD' && g.current === g.me.seat; }, null, { timeout: 20000 });
    await sleep(600);
    const st = await page.locator('.discard-stack[data-drop="discard"]').boundingBox();
    const pt = { 'border-top-left': [st.x + 1, st.y + 1], 'border-bottom-right': [st.x + st.width - 1, st.y + st.height - 1], center: [st.x + st.width / 2, st.y + st.height / 2], 'near-outside': [st.x - 40, st.y - 30] }[where];
    const tileEl = page.locator('.rack-tile').nth(14); const t = await tileEl.boundingBox();
    const id = await tileEl.locator('[data-tile]').getAttribute('data-tile');
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', t.x + t.width / 2, t.y + t.height / 2);
    for (let i = 1; i <= 16; i++) { await touch('touchMove', t.x + t.width / 2 + (pt[0] - t.x - t.width / 2) * i / 16, t.y + t.height / 2 + (pt[1] - t.y - t.height / 2) * i / 16); await sleep(16); }
    await touch('touchEnd', 0, 0);
    const okd = await page.waitForFunction((id) => { const g = window.__remiStore.getState().game; return g.discards[g.me.seat].includes(Number(id)); }, id, { timeout: 6000 }).then(() => true).catch(() => false);
    console.log(`${okd ? 'PASS' : 'FAIL'} touch drop on ${where}`); if (!okd) { fails++; await page.screenshot({ path: `e2e/out/touch-${where}.png` }); }
    await ctx.close();
  }
  await b.close(); process.exit(fails ? 1 : 0);
})();
