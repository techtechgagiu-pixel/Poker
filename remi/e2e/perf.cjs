/** Runtime performance on the real site: load metrics, frame timing during tile drags/sorting/history/fullscreen, WS latency, memory. */
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = process.env.OUT || 'e2e/out'; fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (page) => page.evaluate(() => { const s = window.__remiStore.getState(); return { game: s.game, net: s.net }; });

const FRAME_PROBE = `(() => { window.__frames = []; let last = performance.now(); const loop = (t) => { window.__frames.push(t - last); last = t; window.__raf = requestAnimationFrame(loop); }; window.__raf = requestAnimationFrame(loop); })()`;
const FRAME_STATS = `(() => { cancelAnimationFrame(window.__raf); const f = window.__frames.slice(2).sort((a,b)=>a-b); const avg = f.reduce((a,b)=>a+b,0)/f.length; const med = f[Math.floor(f.length/2)];
  return { frames: f.length, avgMs: +avg.toFixed(2), p95Ms: +f[Math.floor(f.length*0.95)].toFixed(2), maxMs: +f[f.length-1].toFixed(2), fps: +(1000/avg).toFixed(1), dropped: f.filter(x => x > med*1.5).length, refreshHz: +(1000/med).toFixed(0) }; })()`;

(async () => {
  const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
  const out = { base: BASE, at: new Date().toISOString(), browser: browser.version(), notes: 'Headless Chromium in a cloud container: software rendering, vsync locked to 60 Hz. 120 Hz cannot be measured here.' };
  try {
    // ---------- cold & warm load
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
    const page = await ctx.newPage();
    const load = async () => {
      const t0 = Date.now();
      await page.goto(BASE + '/', { waitUntil: 'load' });
      await page.waitForSelector('.home-main h1');
      const m = await page.evaluate(() => new Promise((res) => {
        const nav = performance.getEntriesByType('navigation')[0];
        let lcp = 0, cls = 0;
        new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
        const bytes = performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0) + (nav.transferSize || 0);
        setTimeout(() => res({ ttfbMs: Math.round(nav.responseStart), fcpMs: Math.round(fcp), lcpMs: Math.round(lcp), cls: +cls.toFixed(4), domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd), transferredBytes: bytes }), 1500);
      }));
      return { ...m, wallMs: Date.now() - t0 };
    };
    out.coldLoad = await load();
    out.warmLoad = await load();
    // ---------- one human vs bots: time to table
    await page.evaluate(() => localStorage.setItem('remi.settings', JSON.stringify({ nickname: 'Perf', confirmJoker: false })));
    const t0 = Date.now();
    await page.goto(BASE + '/bots');
    await page.getByRole('button', { name: /Joacă acum/ }).click();
    await page.waitForSelector('.rack-tile');
    out.createRoomToTableMs = Date.now() - t0;
    await sleep(1500);
    // ---------- continuous dragging of tiles
    const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    await page.evaluate(FRAME_PROBE);
    const tiles = page.locator('.rack-tile');
    for (let k = 0; k < 12; k++) {
      const box = await tiles.nth(k % 10).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 40; i++) await page.mouse.move(box.x + box.width / 2 + i * 9, box.y + box.height / 2 + Math.sin(i / 4) * 60);
      await page.mouse.up();
    }
    out.dragFrames = await page.evaluate(FRAME_STATS);
    // input-to-paint latency of a drag move (pointer event -> next frame)
    out.dragInputToFrameMs = await page.evaluate(async () => {
      const el = document.querySelector('.rack-tile'); const r = el.getBoundingClientRect(); const res = [];
      for (let i = 0; i < 20; i++) {
        const t = performance.now();
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5, pointerId: 9, isPrimary: true, button: 0, pointerType: 'mouse' }));
        el.parentElement.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 40 + i, clientY: r.y + 5, pointerId: 9, pointerType: 'mouse' }));
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        res.push(performance.now() - t);
        el.parentElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5, pointerId: 9, pointerType: 'mouse' }));
      }
      res.sort((a, b) => a - b); return { median: +res[10].toFixed(2), p95: +res[18].toFixed(2) };
    });
    // ---------- rapid sorting
    await page.evaluate(FRAME_PROBE);
    for (let i = 0; i < 12; i++) {
      await page.locator('.controls button', { hasText: 'SORTEAZĂ' }).click();
      await page.locator('.sort-menu button').nth(i % 6).click();
    }
    out.sortFrames = await page.evaluate(FRAME_STATS);
    // ---------- discard history open/close
    await page.evaluate(FRAME_PROBE);
    for (let i = 0; i < 10; i++) { await page.locator('.discard-stack').nth(i % 4).click(); }
    out.historyFrames = await page.evaluate(FRAME_STATS);
    // ---------- fullscreen / immersive transitions
    await page.evaluate(FRAME_PROBE);
    const fsT = [];
    for (let i = 0; i < 6; i++) { const t = Date.now(); await page.locator('.tb-btn.gold').click(); await page.waitForTimeout(150); fsT.push(Date.now() - t); }
    out.fullscreenFrames = await page.evaluate(FRAME_STATS);
    out.fullscreenStillConnected = (await state(page)).net.status === 'open';
    // ---------- network latency
    const rtts = [];
    for (let i = 0; i < 12; i++) { await sleep(5200); const s = await state(page); if (s.net.latency !== null) rtts.push(s.net.latency); }
    rtts.sort((a, b) => a - b);
    out.wsRttMs = { samples: rtts.length, median: rtts[Math.floor(rtts.length / 2)], p95: rtts[Math.floor(rtts.length * 0.95)], min: rtts[0], max: rtts[rtts.length - 1] };
    // action acknowledgement (draw/discard round trip incl. server validation)
    const acks = [];
    for (let i = 0; i < 6; i++) {
      const s = await page.waitForFunction(() => { const g = window.__remiStore.getState().game; return g && g.me && g.current === g.me.seat && g.phase.startsWith('WAITING') && !window.__remiStore.getState().pendingAid; }, null, { timeout: 60000 }).then(() => state(page));
      if (s.game.phase === 'WAITING_FOR_DRAW') { await page.locator('.controls button', { hasText: /^TRAGE$/ }).click(); await page.waitForFunction(() => window.__remiStore.getState().game.phase === 'WAITING_FOR_DISCARD'); acks.push((await state(page)).net.lastAck); }
      const g = (await state(page)).game;
      if (g.phase !== 'WAITING_FOR_DISCARD') continue;
      await page.locator(`.rack-tile [data-tile="${g.me.hand[0]}"]`).click();
      await page.locator('.controls button', { hasText: /^ARUNCĂ$/ }).click();
      await page.waitForFunction((seat) => window.__remiStore.getState().game.current !== seat || !window.__remiStore.getState().game.phase.startsWith('WAITING'), g.me.seat);
      acks.push((await state(page)).net.lastAck);
    }
    acks.sort((a, b) => a - b);
    out.actionAckMs = { samples: acks.length, median: acks[Math.floor(acks.length / 2)], max: acks[acks.length - 1] };
    const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    out.heapMB = { start: heap0 && +(heap0 / 1048576).toFixed(1), end: heap1 && +(heap1 / 1048576).toFixed(1) };
    await page.screenshot({ path: `${OUT}/perf-table.png` });
  } catch (e) { out.error = String(e && e.stack || e); }
  await browser.close();
  fs.writeFileSync(`${OUT}/perf.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})();
