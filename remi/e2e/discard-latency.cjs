/**
 * Draw then discard IMMEDIATELY (drag the tile onto the stack ~60 ms after pressing TRAGE), with a slow network
 * (WebSocket delayed 120 ms each way). The discard must go through the first time, without waiting.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787'; const DELAY = Number(process.env.DELAY || 120); const N = Number(process.env.N || 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { devices } = require('playwright'); const TOUCH = !!process.env.TOUCH;
  const b = await chromium.launch(); const ctx = await b.newContext(TOUCH ? { ...devices['iPhone 13 landscape'] } : { viewport: { width: 1440, height: 810 } });
  await ctx.addInitScript((D) => {
    const proto = WebSocket.prototype; const d = Object.getOwnPropertyDescriptor(proto, 'onmessage'); const os = proto.send;
    Object.defineProperty(proto, 'onmessage', { configurable: true, get() { return d.get.call(this); }, set(fn) { d.set.call(this, fn ? (e) => setTimeout(() => fn(e), D) : fn); } });
    proto.send = function (x) { setTimeout(() => os.call(this, x), D); };
  }, DELAY);
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await page.goto(BASE + '/');
  const r = await page.evaluate(async () => { localStorage.setItem('remi.settings', JSON.stringify({ nickname: 'Lat', confirmJoker: false }));
    const d = await (await fetch('/api/config/defaults')).json();
    return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'lat-' + Date.now() }, body: JSON.stringify({ name: 'Lat', mode: 'bots', config: { ...d.config, turnSeconds: 0, bots: { fillEmpty: true, difficulty: 'easy' } } }) })).json(); });
  await page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, r);
  await page.goto(`${BASE}/room/${r.code}`); await page.waitForSelector('.rack-tile'); await sleep(1500);
  const send = (type, x, y) => TOUCH
    ? cdp.send('Input.dispatchTouchEvent', { type: type === 'mousePressed' ? 'touchStart' : type === 'mouseMoved' ? 'touchMove' : 'touchEnd', touchPoints: type === 'mouseReleased' ? [] : [{ x, y, id: 1 }] })
    : cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const st = () => page.evaluate(() => { const g = window.__remiStore.getState().game; return { phase: g.phase, cur: g.current, me: g.me, round: g.round, mine: g.discards[g.me.seat].length }; });
  let okN = 0, tries = 0; const t0 = Date.now();
  while (tries < N && Date.now() - t0 < 150000) {
    let s = await st();
    if (s.phase === 'ROUND_RESULT' || s.phase === 'MATCH_FINISHED') break;
    if (!(s.cur === s.me.seat && s.phase === 'WAITING_FOR_DRAW')) { await sleep(150); continue; }
    tries++;
    const before = s.mine;
    if (process.env.TAKE && s.me.canTakeDiscard) {
      // take the left player's discard by dragging it onto the rack, then discard right away
      const src = await page.locator(`.discard-stack[data-seat="${s.me.discardFrom}"]`).boundingBox(); const rk = await page.locator('.rack').boundingBox();
      await send('mousePressed', src.x + src.width / 2, src.y + src.height / 2);
      for (let i = 1; i <= 4; i++) { await send('mouseMoved', src.x + src.width / 2 + (rk.x + rk.width - 60 - src.x - src.width / 2) * i / 4, src.y + src.height / 2 + (rk.y + rk.height - 40 - src.y - src.height / 2) * i / 4); await sleep(14); }
      await send('mouseReleased', rk.x + rk.width - 60, rk.y + rk.height - 40);
    } else await (TOUCH ? page.locator('.controls button', { hasText: /^TRAGE$/ }).tap() : page.locator('.controls button', { hasText: /^TRAGE$/ }).click());
    await sleep(60); // a fast player does not wait for the new tile to arrive
    const tile = await page.locator('.rack-tile').nth(2).boundingBox(); const stack = await page.locator('.discard-stack[data-drop="discard"]').boundingBox();
    const sx = stack.x + stack.width / 2, sy = stack.y + stack.height / 2;
    await send('mousePressed', tile.x + 20, tile.y + 20);
    for (let i = 1; i <= 4; i++) { await send('mouseMoved', tile.x + 20 + (sx - tile.x - 20) * i / 4, tile.y + 20 + (sy - tile.y - 20) * i / 4); await sleep(14); }
    await send('mouseReleased', sx, sy);
    // allow the network round trips (draw + discard), nothing else
    const done = await page.waitForFunction((b) => { const g = window.__remiStore.getState().game; return g.discards[g.me.seat].length > b || g.current !== g.me.seat; }, before, { timeout: 2500 }).then(() => true).catch(() => false);
    const s2 = await st();
    if (done && s2.mine > before) okN++; else console.log('  miss: turn', tries, JSON.stringify({ phase: s2.phase, mine: s2.mine, before }));
    await sleep(300);
  }
  console.log(`delay ${DELAY}ms each way: ${okN}/${tries} immediate draw+discard worked first time`);
  await b.close(); process.exit(okN === tries && tries > 0 ? 0 : 1);
})();
