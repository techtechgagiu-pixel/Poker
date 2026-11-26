/** Long session soak: concurrent rooms, continuous play, auto-rematch, per-minute memory/frame/WS sampling. */
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = process.env.OUT || 'e2e/out'; fs.mkdirSync(OUT, { recursive: true });
const MIN = Number(process.env.MINUTES || 60), ROOMS = Number(process.env.ROOMS || 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const samples = []; const errors = []; let matches = 0, rounds = 0, actions = 0;

async function room(browser, idx) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`room${idx}: ${e}`));
  await page.goto(BASE + '/');
  const r = await page.evaluate(async (i) => {
    localStorage.setItem('remi.settings', JSON.stringify({ nickname: 'Soak' + i, confirmJoker: false }));
    const d = await (await fetch('/api/config/defaults')).json();
    const config = { ...d.config, startingScore: 30, turnSeconds: 20, nextRoundSeconds: 3, bots: { fillEmpty: true, difficulty: i % 2 ? 'hard' : 'medium' } };
    return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'soak-guest-' + i + '-' + Date.now() }, body: JSON.stringify({ name: 'Soak' + i, mode: 'bots', config }) })).json();
  }, idx);
  await page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, r);
  await page.goto(`${BASE}/room/${r.code}`);
  return { page, code: r.code, lastRound: 0, lastMatch: 0 };
}

async function step(R) {
  const p = R.page;
  const s = await p.evaluate(() => { const x = window.__remiStore.getState(); return { g: x.game, room: x.room, pending: x.pendingAid }; });
  if (!s.room) return;
  if (s.room.status === 'FINISHED') { matches++; await p.getByRole('button', { name: 'REVANȘĂ' }).click().catch(() => null); await sleep(800); return; }
  if (s.room.status === 'LOBBY' && s.room.matchNo > 0) { await p.getByRole('button', { name: 'Începe partida' }).click().catch(() => null); return; }
  const g = s.g; if (!g || !g.me) return;
  if (g.round !== R.lastRound) { rounds++; R.lastRound = g.round; }
  if (g.phase === 'ROUND_RESULT') { await p.getByRole('button', { name: /^Gata/ }).click().catch(() => null); return; }
  // occasional rack rearrangement and history browsing
  if (Math.random() < 0.3) {
    const box = await p.locator('.rack-tile').nth(Math.floor(Math.random() * 10)).boundingBox().catch(() => null);
    if (box) { await p.mouse.move(box.x + 20, box.y + 20); await p.mouse.down(); for (let i = 0; i < 15; i++) await p.mouse.move(box.x + 20 + i * 12, box.y + 20); await p.mouse.up(); }
  }
  if (Math.random() < 0.1) await p.locator('.discard-stack').nth(Math.floor(Math.random() * 4)).click().catch(() => null);
  if (g.current !== g.me.seat || s.pending || !g.phase.startsWith('WAITING')) return;
  const ctl = (t) => p.locator('.controls button', { hasText: t });
  if (g.phase === 'WAITING_FOR_DRAW') { await ctl(/^TRAGE$/).click().catch(() => null); actions++; return; }
  if (await ctl('ÎNCHIDE').isEnabled().catch(() => false)) { await ctl('ÎNCHIDE').click(); await sleep(150); await ctl('ÎNCHIDE').click().catch(() => null); actions++; return; }
  await p.locator('.controls button', { hasText: 'SORTEAZĂ' }).click().catch(() => null);
  await p.locator('.sort-menu button').nth(5).click().catch(() => null);
  const last = await p.locator('.rack-tile [data-tile]').last().getAttribute('data-tile').catch(() => null);
  if (last) { await p.locator(`.rack-tile [data-tile="${last}"]`).click().catch(() => null); await ctl(/^ARUNCĂ$/).click().catch(() => null); actions++; }
}

(async () => {
  const browser = await chromium.launch();
  const rooms = [];
  for (let i = 0; i < ROOMS; i++) rooms.push(await room(browser, i));
  const t0 = Date.now(); let nextSample = t0;
  while (Date.now() - t0 < MIN * 60000) {
    for (const R of rooms) await step(R).catch((e) => errors.push(String(e).slice(0, 200)));
    if (Date.now() >= nextSample) {
      nextSample += 60000;
      for (const [i, R] of rooms.entries()) {
        const m = await R.page.evaluate(() => new Promise((res) => {
          const f = []; let last = performance.now(); const end = last + 2000;
          const loop = (t) => { f.push(t - last); last = t; if (t < end) requestAnimationFrame(loop); else { f.sort((a, b) => a - b); const st = window.__remiStore.getState();
            res({ heapMB: +((performance.memory?.usedJSHeapSize ?? 0) / 1048576).toFixed(1), fps: +(1000 / (f.reduce((a, b) => a + b, 0) / f.length)).toFixed(1), p95: +f[Math.floor(f.length * 0.95)].toFixed(1),
              dom: document.getElementsByTagName('*').length, ws: st.net.status, rtt: st.net.latency, reconnects: st.net.reconnects, version: st.game?.version, matchNo: st.room?.matchNo }); } };
          requestAnimationFrame(loop);
        })).catch((e) => ({ error: String(e) }));
        samples.push({ minute: Math.round((Date.now() - t0) / 60000), room: i, ...m });
      }
      fs.writeFileSync(`${OUT}/soak.json`, JSON.stringify({ base: BASE, minutes: MIN, rooms: ROOMS, matches, rounds, actions, errors: errors.slice(-50), samples }, null, 2));
    }
    await sleep(700);
  }
  fs.writeFileSync(`${OUT}/soak.json`, JSON.stringify({ base: BASE, minutes: MIN, rooms: ROOMS, matches, rounds, actions, errors: errors.slice(-50), samples, done: true }, null, 2));
  await browser.close();
  console.log('soak done', { matches, rounds, actions, errors: errors.length });
})();
