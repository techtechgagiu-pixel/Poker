/** Regression: dragged tiles/ghosts must never stay stuck on screen. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const results = []; const ok = (n, p, i = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  try {
    for (const vp of [{ width: 1440, height: 810 }, { width: 844, height: 390, isMobile: true, hasTouch: true }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
      const page = await ctx.newPage(); const tag = vp.isMobile ? 'mobile' : 'desktop';
      await page.goto(BASE + '/');
      const r = await page.evaluate(async () => {
        localStorage.setItem('remi.settings', JSON.stringify({ nickname: 'Drag', skipAnim: true }));
        const d = await (await fetch('/api/config/defaults')).json();
        return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'drag-' + Date.now() }, body: JSON.stringify({ name: 'Drag', mode: 'training', config: { ...d.config, turnSeconds: 0 } }) })).json();
      });
      await page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, r);
      await page.goto(`${BASE}/room/${r.code}`);
      await page.waitForFunction(() => window.__remiStore.getState().game?.me, null, { timeout: 20000 });
      // make it our turn to draw: discard one tile if we are the starter
      await page.waitForFunction(() => { const g = window.__remiStore.getState().game; return g.current === g.me.seat; }, null, { timeout: 30000 });
      let g = await page.evaluate(() => window.__remiStore.getState().game);
      if (g.phase === 'WAITING_FOR_DISCARD') { await page.locator(`.rack-tile [data-tile="${g.me.hand[0]}"]`).click(); await page.locator('.controls button', { hasText: /^ARUNCĂ$/ }).click(); }
      await page.waitForFunction(() => { const g = window.__remiStore.getState().game; return g.current === g.me.seat && g.phase === 'WAITING_FOR_DRAW'; }, null, { timeout: 30000 });
      const pile = await page.locator('.draw-pile').boundingBox();
      const cx = pile.x + pile.width / 2, cy = pile.y + pile.height / 2;
      // 1) window loses focus mid-drag
      await page.mouse.move(cx, cy); await page.mouse.down(); for (let i = 1; i < 10; i++) await page.mouse.move(cx + i * 10, cy + i * 8);
      const during = await page.locator('.drag-ghost').count();
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.mouse.up(); await sleep(200);
      ok(`[${tag}] ghost removed when the window loses focus mid-drag`, during === 1 && (await page.locator('.drag-ghost').count()) === 0);
      // 2) release far outside any target
      await page.mouse.move(cx, cy); await page.mouse.down(); for (let i = 1; i < 10; i++) await page.mouse.move(cx - i * 30, cy - i * 20);
      await page.mouse.up(); await sleep(200);
      ok(`[${tag}] ghost removed after a release outside the rack (no draw)`, (await page.locator('.drag-ghost').count()) === 0 && (await page.evaluate(() => window.__remiStore.getState().game.phase)) === 'WAITING_FOR_DRAW');
      // 3) the source becomes non-interactive mid-drag (turn ends): simulated by disabling pointer events on it
      await page.mouse.move(cx, cy); await page.mouse.down(); for (let i = 1; i < 10; i++) await page.mouse.move(cx + i * 10, cy + i * 8);
      await page.evaluate(() => { document.querySelector('.draw-pile').style.pointerEvents = 'none'; });
      await page.mouse.up(); await sleep(200);
      await page.evaluate(() => { document.querySelector('.draw-pile').style.pointerEvents = ''; });
      ok(`[${tag}] ghost removed even if the source stops receiving events`, (await page.locator('.drag-ghost').count()) === 0);
      // 4) rack tile: browser drops the pointer capture mid-drag
      const tile = await page.locator('.rack-tile').first().boundingBox();
      await page.mouse.move(tile.x + 10, tile.y + 10); await page.mouse.down(); for (let i = 1; i < 8; i++) await page.mouse.move(tile.x + 10 + i * 15, tile.y + 10);
      const dragging = await page.locator('.rack-tile.dragging').count();
      await page.evaluate(() => { const el = document.querySelector('.rack-tile.dragging'); el.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 })); });
      await page.mouse.up(); await sleep(300);
      ok(`[${tag}] rack tile never stays "in hand" when the pointer is lost`, dragging === 1 && (await page.locator('.rack-tile.dragging').count()) === 0);
      // 5) normal drag from the pile still works
      const rack = await page.locator('.rack').boundingBox();
      const n0 = (await page.evaluate(() => window.__remiStore.getState().game.me.hand.length));
      await page.mouse.move(cx, cy); await page.mouse.down(); for (let i = 1; i <= 20; i++) await page.mouse.move(cx + (rack.x + rack.width - 30 - cx) * i / 20, cy + (rack.y + rack.height - 30 - cy) * i / 20);
      await page.mouse.up();
      await page.waitForFunction((n) => window.__remiStore.getState().game.me.hand.length === n + 1, n0, { timeout: 8000 }).catch(() => null);
      ok(`[${tag}] drag from the pile onto the rack draws a tile`, (await page.evaluate(() => window.__remiStore.getState().game.me.hand.length)) === n0 + 1 && (await page.locator('.drag-ghost').count()) === 0);
      await ctx.close();
    }
  } catch (e) { ok('drag cleanup run', false, String(e && e.message || e).split('\n')[0]); }
  await browser.close();
  const f = results.filter((x) => !x.p).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})();
