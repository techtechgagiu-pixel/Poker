/** Voice/video between two players with Chromium fake devices; permission denial; gamepad mapping. */
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = process.env.OUT || 'e2e/out'; fs.mkdirSync(OUT, { recursive: true });
const results = []; const ok = (n, p, i = '') => { results.push({ name: n, pass: p, info: i }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (page) => page.evaluate(() => { const s = window.__remiStore.getState(); return { room: s.room, game: s.game }; });
async function waitFor(page, fn, timeout = 20000, label = '') { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn()) return true; await sleep(300); } throw new Error('timeout ' + label); }

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const mk = async (name, grant = true) => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, permissions: grant ? ['microphone', 'camera'] : [] });
      const page = await ctx.newPage(); await page.goto(BASE + '/');
      await page.evaluate((n) => localStorage.setItem('remi.settings', JSON.stringify({ nickname: n, skipAnim: true })), name);
      return { ctx, page };
    };
    const A = await mk('Ana'); const B = await mk('Bogdan');
    const r = await A.page.evaluate(async () => {
      const d = await (await fetch('/api/config/defaults')).json();
      return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'media-guest-' + Date.now() }, body: JSON.stringify({ name: 'Ana', mode: 'human', config: { ...d.config, turnSeconds: 0 } }) })).json();
    });
    await A.page.evaluate((r) => localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })), r);
    await A.page.goto(`${BASE}/room/${r.code}`);
    await B.page.goto(`${BASE}/join/${r.code}`); await B.page.getByRole('button', { name: 'Intră', exact: true }).click();
    await B.page.getByRole('button', { name: 'Sunt gata' }).click();
    await waitFor(A.page, async () => (await state(A.page)).room.members.every((m) => m.role !== 'player' || m.ready || m.isHost), 10000, 'ready');
    await A.page.getByRole('button', { name: 'Începe partida' }).click();
    for (const P of [A, B]) await waitFor(P.page, async () => !!(await state(P.page)).game, 15000, 'game');
    ok('voice/video off by default (no tracks before user action)', await A.page.evaluate(() => !window.__remiMedia?.getState().local));
    // A enables mic + camera, B enables mic
    await A.page.locator('.tb-btn', { hasText: '🎤' }).click(); await A.page.locator('.tb-btn', { hasText: '📷' }).click();
    await B.page.locator('.tb-btn', { hasText: '🎤' }).click();
    await waitFor(B.page, () => B.page.evaluate(() => Object.values(window.__remiMedia.getState().peers).some((p) => p.state === 'connected' && p.stream && p.stream.getVideoTracks().length)), 30000, 'B receives A video');
    ok('WebRTC peers connect; B receives A\'s audio+video', true);
    const video = await B.page.locator('.seat-badge video').count();
    ok('remote video replaces the avatar', video >= 1);
    const ring = await waitFor(B.page, () => B.page.evaluate(() => Object.values(window.__remiMedia.getState().peers).some((p) => p.speaking)), 15000, 'speaking').then(() => true).catch(() => false);
    ok('active speaker detected from the audio level (fake tone)', ring);
    const mic = await waitFor(B.page, async () => (await state(B.page)).room.members.some((m) => m.name === 'Ana' && m.mic && m.cam), 8000, 'flags').then(() => true).catch(() => false);
    ok('mic/camera status synchronised to the table', mic);
    await B.page.screenshot({ path: `${OUT}/media-video.png` });
    // individual mute
    await B.page.locator('.peer-mute').first().click();
    const muted = await B.page.evaluate(() => [...document.querySelectorAll('audio')].some((a) => a.muted));
    ok('individual mute of a remote player', muted);
    // leaving stops tracks
    await A.page.goto(BASE + '/'); await sleep(1500);
    const live = await A.page.evaluate(() => (window.__remiMedia.getState().local?.getTracks() ?? []).filter((t) => t.readyState === 'live').length);
    ok('leaving the room stops camera and microphone tracks', live === 0);
    // permission denied
    const C = await mk('Cezar', false);
    const r2 = await C.page.evaluate(async () => (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'media-c-' + Date.now() }, body: JSON.stringify({ name: 'Cezar', mode: 'bots' }) })).json());
    await C.page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, r2);
    await C.page.goto(`${BASE}/room/${r2.code}`);
    await waitFor(C.page, async () => !!(await state(C.page)).game, 15000, 'C game');
    await C.page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); });
    const v0 = (await state(C.page)).game.version;
    await C.page.locator('.tb-btn', { hasText: '🎤' }).click(); await sleep(1500);
    const toast = await C.page.locator('.toast.error').count();
    const stillPlaying = (await C.page.evaluate(() => window.__remiStore.getState().net.status)) === 'open';
    ok('microphone permission denial shows a message and the game keeps running', toast > 0 && stillPlaying && (await state(C.page)).game.version >= v0);
    // gamepad: inject a virtual standard controller and press D-pad right + A
    await C.page.evaluate(() => {
      const pad = { id: 'Virtual Xbox', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      window.__pad = pad; navigator.getGamepads = () => [pad];
      window.dispatchEvent(new Event('gamepadconnected'));
    });
    const press = async (i) => { await C.page.evaluate((i) => { window.__pad.buttons[i].pressed = true; }, i); await sleep(120); await C.page.evaluate((i) => { window.__pad.buttons[i].pressed = false; }, i); await sleep(120); };
    await press(15); await press(15); await press(0);
    const held = await C.page.locator('.rack-tile.held').count();
    await press(3);
    const sortOpen = await C.page.locator('.sort-menu').count();
    ok('controller: D-pad navigates, A picks up a tile, Y opens sorting', held === 1 && sortOpen === 1, `held=${held} sort=${sortOpen}`);
  } catch (e) { ok('media run', false, String(e && e.message || e).split('\n')[0]); }
  finally {
    await browser.close();
    fs.writeFileSync(`${OUT}/media.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
    const failed = results.filter((r) => !r.pass).length; console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
  }
})();
