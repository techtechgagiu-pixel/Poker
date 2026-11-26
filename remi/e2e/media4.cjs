/** Four players switch camera + microphone on at (almost) the same time: everyone must see and hear the other three. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787'; const OUT = process.env.OUT || 'e2e/out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0;
const ok = (n, p, i = '') => { if (!p) fails++; console.log(`${p ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
(async () => {
  const b = await chromium.launch({ ignoreDefaultArgs: ['--mute-audio'], args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const mk = async (name) => { const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera', 'microphone'] }); const p = await ctx.newPage(); await p.goto(BASE + '/'); await p.evaluate((n) => localStorage.setItem('remi.settings', JSON.stringify({ nickname: n, skipAnim: true })), name); return p; };
  const st = (p) => p.evaluate(() => { const s = window.__remiStore.getState(); return { room: s.room, game: s.game }; });
  const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(300); } return false; };
  const P = [await mk('Ana'), await mk('Bob'), await mk('Cip'), await mk('Dan')];
  const r = await P[0].evaluate(async () => { const d = await (await fetch('/api/config/defaults')).json();
    return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'm4-' + Date.now() }, body: JSON.stringify({ name: 'Ana', mode: 'human', config: { ...d.config, turnSeconds: 0 } }) })).json(); });
  await P[0].evaluate((r) => localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })), r);
  await P[0].goto(`${BASE}/room/${r.code}`);
  for (const p of P.slice(1)) { await p.goto(`${BASE}/join/${r.code}`); await p.getByRole('button', { name: 'Intră', exact: true }).click(); await p.getByRole('button', { name: 'Sunt gata' }).click(); }
  await until(async () => (await st(P[0])).room.members.filter((m) => m.role === 'player' && (m.ready || m.isHost)).length === 4);
  await P[0].getByRole('button', { name: 'Începe partida' }).click();
  for (const p of P) await until(async () => !!(await st(p)).game);
  ok('4 humans at the table', true);
  // everybody turns camera AND microphone on at nearly the same moment
  await Promise.all(P.map(async (p, i) => { await sleep(i * 120); await p.locator('.tb-btn', { hasText: '📷' }).click(); await sleep(60); await p.locator('.tb-btn', { hasText: '🎤' }).click(); }));
  const remoteState = (p) => p.evaluate(() => {
    const m = window.__remiMedia.getState(); const me = window.__remiStore.getState().you.pid;
    return Object.entries(m.peers).filter(([k]) => k !== me).map(([k, x]) => ({ state: x.state, video: !!x.stream?.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted), audio: !!x.stream?.getAudioTracks().some((t) => t.readyState === 'live') }));
  });
  for (const [i, p] of P.entries()) {
    const good = await until(async () => { const rs = await remoteState(p); return rs.length === 3 && rs.every((x) => x.state === 'connected' && x.video && x.audio); }, 40000);
    const rs = await remoteState(p);
    ok(`player ${i + 1} sees and hears the other 3`, good, JSON.stringify(rs.map((x) => x.state[0] + (x.video ? 'V' : '-') + (x.audio ? 'A' : '-'))));
  }
  for (const [i, p] of P.entries()) {
    const playing = await until(async () => (await p.evaluate(() => [...document.querySelectorAll('.seat-badge video')].filter((v) => v.videoWidth > 0 && !v.paused).length)) === 3, 15000);
    ok(`player ${i + 1}: three video frames are actually rendering in the shields`, playing);
  }
  const allSee = async (label, who) => { for (const i of who) { const good = await until(async () => { const rs = await remoteState(P[i]); return rs.length === 3 && rs.every((x) => x.state === 'connected' && x.video && x.audio); }, 40000); ok(`${label}: player ${i + 1} sees and hears the other 3`, good, JSON.stringify((await remoteState(P[i])).map((x) => x.state[0] + (x.video ? 'V' : '-') + (x.audio ? 'A' : '-')))); } };
  // a player switches the camera off and on again
  await P[2].locator('.tb-btn', { hasText: '📷' }).click(); await sleep(1200);
  await P[2].locator('.tb-btn', { hasText: '📷' }).click();
  await allSee('camera off/on', [0, 1, 3]);
  // a player reloads the page in the middle of the call and turns media on again
  await P[1].reload(); await until(async () => !!(await st(P[1])).game);
  await P[1].locator('.tb-btn', { hasText: '📷' }).click(); await sleep(80); await P[1].locator('.tb-btn', { hasText: '🎤' }).click();
  await allSee('after a reload', [0, 1, 2, 3]);
  // the host also reloads
  await P[0].reload(); await until(async () => !!(await st(P[0])).game);
  await P[0].locator('.tb-btn', { hasText: '📷' }).click(); await sleep(80); await P[0].locator('.tb-btn', { hasText: '🎤' }).click();
  await allSee('after the host reloads', [0, 1, 2, 3]);
  if (fails) for (const [i, p] of P.entries()) console.log(`P${i + 1} pcs:`, JSON.stringify(await p.evaluate(() => [...window.__remiPcs.entries()].map(([k, e]) => ({ peer: k.slice(0, 4), sig: e.pc.signalingState, conn: e.pc.connectionState, mk: e.makingOffer, tx: e.pc.getTransceivers().map((t) => `${t.mid}:${t.receiver.track.kind[0]}:${t.direction}/${t.currentDirection}:snd=${t.sender.track ? t.sender.track.readyState[0] : '-'}:rcv${t.receiver.track.muted ? 'M' : 'U'}`) })))));
  await P[0].screenshot({ path: `${OUT}/media4.png` });
  await b.close(); process.exit(fails ? 1 : 0);
})();
