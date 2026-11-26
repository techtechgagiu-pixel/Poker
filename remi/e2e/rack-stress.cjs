/**
 * Stress test for tile dragging with HUMAN-LIKE input: fast flicks (few move events, ~100 ms), back-to-back drags,
 * grabbing a tile that is still gliding, mouse and touch. Every drag must take effect the FIRST time.
 */
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODE = process.env.MODE || 'mouse'; const N = Number(process.env.N || 40);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext(MODE === 'touch' ? { ...devices['iPhone 13 landscape'] } : { viewport: { width: 1440, height: 810 } });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await page.goto(BASE + '/');
  const r = await page.evaluate(async () => { localStorage.setItem('remi.settings', JSON.stringify({ nickname: 'Stress', skipAnim: false, confirmJoker: false }));
    const d = await (await fetch('/api/config/defaults')).json();
    return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'stress-' + Date.now() }, body: JSON.stringify({ name: 'Stress', mode: 'training', scenario: 'normalPlain', config: { ...d.config, turnSeconds: 0 } }) })).json(); });
  await page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, r);
  await page.goto(`${BASE}/room/${r.code}`);
  await page.waitForFunction(() => window.__remiStore.getState().game?.me?.hand.length === 15, null, { timeout: 20000 }); await sleep(800);
  const geom = () => page.evaluate(() => {
    const rect = document.querySelector('.rack').getBoundingClientRect(); const s = rect.width / document.querySelector('.rack').offsetWidth;
    const tiles = [...document.querySelectorAll('.rack-tile')].map((e) => { const q = e.getBoundingClientRect(); return { id: Number(e.querySelector('[data-tile]').dataset.tile), x: q.x + q.width / 2, y: q.y + q.height / 2, w: q.width, h: q.height }; });
    return { rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, s, tiles, layout: window.__remiRack.getState().layout, cols: window.__remiRack.getState().layout.length / 2 };
  });
  const send = (type, x, y) => MODE === 'touch'
    ? cdp.send('Input.dispatchTouchEvent', { type: type === 'down' ? 'touchStart' : type === 'move' ? 'touchMove' : 'touchEnd', touchPoints: type === 'up' ? [] : [{ x, y, id: 1 }] })
    : cdp.send('Input.dispatchMouseEvent', { type: type === 'down' ? 'mousePressed' : type === 'move' ? 'mouseMoved' : 'mouseReleased', x, y, button: 'left', buttons: type === 'up' ? 0 : 1, clickCount: type === 'move' ? 0 : 1 });
  let fail = 0; const fails = [];
  for (let n = 0; n < N; n++) {
    const g = await geom();
    const tile = g.tiles[Math.floor(Math.random() * g.tiles.length)];
    // target: the centre of a random slot (row 0/1, col 0..cols-1) different from the origin
    const from = g.layout.indexOf(tile.id);
    let to; do { to = Math.floor(Math.random() * g.layout.length); } while (to === from);
    const pitch = (g.tiles[0].w + 4 * g.s);
    const tx = g.rect.x + (14 + (to % g.cols) * ((g.tiles[0].w / g.s) + 4) + (g.tiles[0].w / g.s) / 2) * g.s;
    const ty = g.rect.y + (14 + Math.floor(to / g.cols) * ((g.tiles[0].h / g.s) + 10) + (g.tiles[0].h / g.s) / 2) * g.s;
    const steps = 3 + Math.floor(Math.random() * 3); const dt = 12 + Math.random() * 10;
    await send('down', tile.x, tile.y); await sleep(30);
    for (let i = 1; i <= steps; i++) { await send('move', tile.x + (tx - tile.x) * i / steps, tile.y + (ty - tile.y) * i / steps); await sleep(dt); }
    await send('up', tx, ty);
    // immediately after release the layout must already reflect the drop (React state, not the animation)
    await sleep(60);
    const after = await page.evaluate(() => window.__remiRack.getState().layout);
    const at = after.indexOf(tile.id);
    // accepted if it is at the target slot or a neighbour of it inside the same row (insertion pushes neighbours)
    const ok = at === to || (Math.floor(at / g.cols) === Math.floor(to / g.cols) && Math.abs(at - to) <= 1) || (Math.abs(at - to) <= 2 && after[to] !== null);
    const conserved = after.filter((x) => x !== null).length === 15;
    if (!ok || !conserved) { fail++; fails.push({ n, from, to, at, conserved, steps, dt: Math.round(dt) }); }
    await sleep(Math.random() < 0.5 ? 0 : 250); // sometimes grab the next tile while the previous one is still gliding
  }
  console.log(`${MODE}: ${N - fail}/${N} drags landed first time`, fail ? JSON.stringify(fails.slice(0, 8)) : '');
  await b.close(); process.exit(fail ? 1 : 0);
})();
