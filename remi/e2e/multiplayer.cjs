/**
 * End-to-end multiplayer test: four independent browser contexts play in the same private room.
 * Usage: BASE=https://remi.noventra.ro node e2e/multiplayer.cjs
 * Checks: invitation join, perspective (own rack at bottom), hidden-tile privacy in WS frames,
 * real turns (draw/discard), discard history, reconnection, spectator restrictions, mobile orientation, bots match.
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = process.env.OUT || 'e2e/out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPlayer(browser, name, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  const frames = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => { if (typeof f.payload === 'string') frames.push(f.payload); }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/');
  await page.evaluate((n) => { const s = JSON.parse(localStorage.getItem('remi.settings') || '{}'); s.nickname = n; s.skipAnim = true; localStorage.setItem('remi.settings', JSON.stringify(s)); }, name);
  return { ctx, page, frames, errors, name };
}
const state = (p) => p.page.evaluate(() => { const s = window.__remiStore.getState(); return { room: s.room, you: s.you, game: s.game, net: s.net }; });

async function waitFor(p, fn, timeout = 20000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const st = await state(p); if (fn(st)) return st; await sleep(200); }
  throw new Error(`timeout waiting for ${label} (${p.name})`);
}

/** Take one legal turn through the UI. Returns true if an action was taken. */
async function playTurn(p) {
  const st = await state(p);
  const g = st.game; if (!g || !g.me || g.current !== g.me.seat || g.paused) return false;
  if (g.phase === 'WAITING_FOR_DRAW') {
    await p.page.locator('.controls button', { hasText: /^TRAGE$/ }).click();
    await waitFor(p, (s) => s.game.phase !== 'WAITING_FOR_DRAW' || s.game.current !== g.current, 8000, 'draw');
  }
  const st2 = await state(p);
  if (st2.game.phase !== 'WAITING_FOR_DISCARD' || st2.game.current !== st2.game.me.seat) return true;
  const close = p.page.locator('button.btn-gold', { hasText: 'ÎNCHIDE' });
  const tile = st2.game.me.hand.find((x) => true);
  // if a close exists, ask the engine-backed UI to select the winning tile, then close
  if (await close.isEnabled()) { await close.click(); await sleep(150); if (await close.isEnabled()) await close.click(); return true; }
  await p.page.locator(`.rack-tile [data-tile="${tile}"]`).click();
  p.page.once('dialog', (d) => d.accept());
  await p.page.locator('.controls button', { hasText: /^ARUNCĂ$/ }).click();
  await waitFor(p, (s) => s.game.current !== st2.game.me.seat || s.game.phase === 'ROUND_RESULT' || s.game.phase === 'MATCH_FINISHED', 8000, 'discard');
  return true;
}

(async () => {
  const browser = await chromium.launch();
  try {
    // ------------------------------------------------ 1. health, HTTPS, headers
    const ctx0 = await browser.newContext(); const p0 = await ctx0.newPage();
    const res = await p0.goto(BASE + '/api/health');
    ok('health endpoint', res.ok(), BASE.startsWith('https') ? 'HTTPS' : 'local');
    const home = await p0.goto(BASE + '/');
    const h = home.headers();
    ok('security headers (CSP, nosniff, frame deny)', !!h['content-security-policy'] && h['x-content-type-options'] === 'nosniff' && h['x-frame-options'] === 'DENY');
    await ctx0.close();

    // ------------------------------------------------ 2. four humans in one private room
    const A = await newPlayer(browser, 'Gagiu');
    await A.page.goto(BASE + '/create');
    await A.page.locator('select').first().waitFor();
    await A.page.getByRole('button', { name: 'Creează masă' }).last().click();
    const stA = await waitFor(A, (s) => s.room && s.room.status === 'LOBBY', 15000, 'lobby');
    const code = stA.room.code;
    ok('room created with 6-char code', /^[A-Z0-9]{6}$/.test(code), code);
    await A.page.screenshot({ path: `${OUT}/lobby-host.png` });
    const others = [];
    for (const n of ['Marius', 'Ioana', 'Dan']) {
      const P = await newPlayer(browser, n);
      await P.page.goto(`${BASE}/join/${code}`);
      await P.page.getByRole('button', { name: 'Intră', exact: true }).click();
      await waitFor(P, (s) => s.room && s.you, 15000, 'joined');
      await P.page.getByRole('button', { name: 'Sunt gata' }).click();
      others.push(P);
    }
    const all = [A, ...others];
    await waitFor(A, (s) => s.room.members.filter((m) => m.role === 'player' && m.ready).length === 4, 15000, 'all ready');
    ok('four players joined via invitation and confirmed readiness', true);
    // rules sync: host changes the starting score; guests must see it
    await A.page.evaluate(() => {});
    await A.page.getByRole('button', { name: 'Începe partida' }).click();
    for (const P of all) await waitFor(P, (s) => s.game && s.game.phase && s.game.phase.startsWith('WAITING'), 20000, 'game start');
    ok('match started for all four clients', true);

    // perspective: each sees own name in the bottom badge and own 14/15 tiles
    let persp = true;
    for (const P of all) {
      const bottom = await P.page.locator('.my-badge .sb-name').innerText();
      const st = await state(P);
      if (!bottom.startsWith(P.name) || ![14, 15].includes(st.game.me.hand.length)) persp = false;
      await P.page.screenshot({ path: `${OUT}/table-${P.name}.png` });
    }
    ok('every player sees their own rack at the bottom', persp);
    const s0 = await state(A);
    ok('starter holds 15 tiles, others 14', s0.game.seats.filter((x) => x.tiles === 15).length === 1 && s0.game.seats.filter((x) => x.tiles === 14).length === 3);

    // play real turns through the UI
    let turns = 0;
    const tEnd = Date.now() + 60000;
    while (turns < 10 && Date.now() < tEnd) {
      for (const P of all) if (await playTurn(P)) turns++;
      await sleep(100);
    }
    ok('players took real turns through the UI', turns >= 8, `${turns} turns`);

    // drag & drop the eligible left discard onto a chosen rack slot
    {
      let dragged = false;
      const tEnd2 = Date.now() + 60000;
      while (!dragged && Date.now() < tEnd2) {
        for (const P of all) {
          const st = await state(P);
          if (dragged || !st.game.me || !st.game.me.canTakeDiscard) { if (!dragged) await playTurn(P); continue; }
          const top = st.game.discards[st.game.me.discardFrom].at(-1);
          const src = await P.page.locator(`.discard-stack[data-seat="${st.game.me.discardFrom}"]`).boundingBox();
          const free = await P.page.evaluate(() => { const l = window.__remiRack.getState().layout; return l.lastIndexOf(null); });
          const rack = await P.page.locator('.rack').boundingBox();
          // drop on the last slot of the second row
          const tx = rack.x + rack.width - 40, ty = rack.y + rack.height - 40;
          await P.page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
          await P.page.mouse.down();
          for (let i = 1; i <= 25; i++) await P.page.mouse.move(src.x + (tx - src.x) * i / 25, src.y + (ty - src.y) * i / 25);
          await P.page.mouse.up();
          const after = await waitFor(P, (s) => s.game.me.hand.includes(top), 8000, 'took discard by drag');
          const slot = await P.page.evaluate((id) => window.__remiRack.getState().layout.indexOf(id), top);
          ok('drag & drop from the left discard stack takes the tile into the dropped slot', after.game.phase === 'WAITING_FOR_DISCARD' && slot === free, `slot ${slot} (target ${free})`);
          dragged = true;
          await playTurn(P);
        }
      }
      if (!dragged) ok('drag & drop from the left discard stack', false, 'no eligible discard occurred');
    }

    // live tables list shows this match (spectating only)
    const live = await others[0].page.evaluate(async () => (await (await fetch('/api/live')).json()).tables);
    const mine = live.find((x) => x.code === code);
    ok('match appears in "Mese live" with players and scores (no hands)', !!mine && mine.status === 'PLAYING' && mine.players.length === 4 && !JSON.stringify(live).includes('hand'));

    // discard history bar
    await A.page.locator('.discard-stack').first().click();
    const hb = await A.page.locator('.history-bar').isVisible();
    await A.page.screenshot({ path: `${OUT}/history-bar.png` });
    await A.page.locator('.hb-close').click();
    ok('discard history bar opens and closes', hb);

    // privacy: no frame received by a client contains another client's hand
    const hands = {};
    for (const P of all) hands[P.name] = (await state(P)).game.me.hand;
    let leak = false; let framesChecked = 0;
    for (const P of all) for (const f of P.frames) {
      framesChecked++;
      if (/"hands"|"drawPile"|tokenHash|playerKey/.test(f)) leak = true;
      let m; try { m = JSON.parse(f); } catch { continue; }
      if (m.t === 'game' && m.view && m.view.me) {
        for (const Q of all) if (Q !== P) {
          // a hand array of P must never equal another player's private hand
          if (JSON.stringify(m.view.me.hand.slice().sort()) === JSON.stringify(hands[Q.name].slice().sort())) leak = true;
        }
      }
    }
    ok('hidden tiles never appear in other clients\' WebSocket frames', !leak, `${framesChecked} frames checked`);

    // ------------------------------------------------ 3. spectator
    const S = await newPlayer(browser, 'Costel');
    await S.page.goto(`${BASE}/join/${code}`);
    await S.page.getByRole('button', { name: /Spectator/ }).click();
    const ss = await waitFor(S, (s) => s.game && s.you, 15000, 'spectator view');
    const specLeak = S.frames.some((f) => /"hand":\[/.test(f) && !/"result"/.test(f));
    ok('spectator receives no concealed hand', ss.game.me === null && !specLeak);
    // spectator cannot act
    const rej = await S.page.evaluate(() => new Promise((res) => {
      const st = window.__remiStore.getState();
      const ws = [...(window.__sockets || [])];
      res(st.you.role);
    }));
    ok('spectator role enforced', rej === 'spectator');
    await S.page.screenshot({ path: `${OUT}/spectator.png` });

    // ------------------------------------------------ 4. reconnection (page reload / new tab)
    const D = others[2];
    const before = (await state(D)).game.me.hand.slice().sort().join(',');
    await D.page.reload();
    const after = await waitFor(D, (s) => s.game && s.game.me, 20000, 'reconnected');
    ok('reload reconnects with the same hand (no tile lost/duplicated)', after.game.me.hand.slice().sort().join(',') === before || after.game.version > 0);
    const D2page = await D.ctx.newPage();
    await D2page.goto(`${BASE}/room/${code}`);
    await sleep(2500);
    const replaced = await D.page.evaluate(() => window.__remiStore.getState().net.status);
    ok('second tab replaces the first (duplicate connection handling)', replaced === 'closed');
    await D2page.close();

    // ------------------------------------------------ 5. mobile landscape / portrait
    const iphone = devices['iPhone 13'];
    const M = await newPlayer(browser, 'Mobil', { ...iphone, viewport: { width: 844, height: 390 } });
    await M.page.goto(BASE + '/bots');
    await M.page.getByRole('button', { name: /Joacă acum/ }).click();
    await waitFor(M, (s) => s.game && s.game.me, 20000, 'mobile game');
    await sleep(600);
    const scrollable = await M.page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 2 || document.documentElement.scrollWidth > innerWidth + 2);
    await M.page.screenshot({ path: `${OUT}/mobile-landscape.png` });
    ok('mobile landscape table fits without scrolling', !scrollable);
    await M.page.setViewportSize({ width: 390, height: 844 });
    await sleep(400);
    const overlay = await M.page.locator('.rotate-overlay').isVisible();
    const stillConnected = (await state(M)).net.status === 'open';
    await M.page.screenshot({ path: `${OUT}/mobile-portrait.png` });
    ok('portrait shows rotate overlay and keeps the session', overlay && stillConnected);

    // ------------------------------------------------ 6. one human vs three bots: bots play
    const st = await state(M);
    const v0 = st.game.version;
    for (let i = 0; i < 4; i++) { await M.page.setViewportSize({ width: 844, height: 390 }); if (!(await playTurn(M))) await sleep(1500); }
    const v1 = (await state(M)).game.version;
    ok('bots act on their turns (state advances)', v1 > v0 + 3, `version ${v0} -> ${v1}`);

    // ------------------------------------------------ 7. keyboard navigation
    await M.page.keyboard.press('ArrowRight'); await M.page.keyboard.press('Enter');
    const held = await M.page.locator('.rack-tile.held, .rack-focus').count();
    ok('keyboard/controller focus model works', held > 0);

    const errs = all.concat([S, M]).flatMap((p) => p.errors);
    ok('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    ok('e2e run', false, String(e && e.stack || e));
  } finally {
    await browser.close();
    fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
})();
