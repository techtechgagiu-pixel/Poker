/** Panels close when pressing outside them; their own toggle still toggles. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0;
const ok = (n, p) => { if (!p) fails++; console.log(`${p ? 'PASS' : 'FAIL'} ${n}`); };
(async () => {
  const b = await chromium.launch();
  for (const [tag, opts] of [['desktop', { viewport: { width: 1440, height: 810 } }], ['phone', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }]]) {
    const ctx = await b.newContext(opts); const page = await ctx.newPage();
    await page.goto(BASE + '/');
    const r = await page.evaluate(async () => { localStorage.setItem('remi.settings', JSON.stringify({ nickname: 'Out' }));
      const d = await (await fetch('/api/config/defaults')).json();
      return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'out-' + Date.now() }, body: JSON.stringify({ name: 'Out', mode: 'bots', config: { ...d.config, turnSeconds: 0 } }) })).json(); });
    await page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, r);
    await page.goto(`${BASE}/room/${r.code}`); await page.waitForSelector('.rack-tile'); await sleep(500);
    const felt = await page.locator('.felt').boundingBox();
    const outside = () => (opts.hasTouch ? page.touchscreen.tap(felt.x + felt.width * 0.5, felt.y + felt.height * 0.8) : page.mouse.click(felt.x + felt.width * 0.5, felt.y + felt.height * 0.8));
    const cases = [
      ['settings', '[data-toggle="settings"]', '.drawer'],
      ['chat', '[data-toggle="chat"]', '.chat-panel'],
      ['sort menu', '[data-toggle="sort"]', '.sort-menu'],
      ['☰ table menu', '.table-menu > button', '.table-menu-pop'],
      ['discard history', '.discard-stack >> nth=0', '.history-bar'],
    ];
    for (const [name, open, panel] of cases) {
      await page.locator(open).first().click(); await sleep(250);
      const opened = await page.locator(panel).count();
      await outside(); await sleep(300);
      const closed = (await page.locator(panel).count()) === 0;
      let toggled = true;
      if (name !== 'discard history') { await page.locator(open).first().click(); await sleep(200); await page.locator(open).first().click(); await sleep(250); toggled = (await page.locator(panel).count()) === 0; }
      ok(`[${tag}] ${name}: opens, closes on outside press${name !== 'discard history' ? ', own button still toggles' : ''}`, opened === 1 && closed && toggled);
    }
    await ctx.close();
  }
  await b.close(); process.exit(fails ? 1 : 0);
})();
