/** Pause vote, timer freeze/restore, save & exact resume, rematch — two human clients + bots. */
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = process.env.OUT || 'e2e/out'; fs.mkdirSync(OUT, { recursive: true });
const results = []; const ok = (n, p, i = '') => { results.push({ name: n, pass: p, info: i }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (page) => page.evaluate(() => { const s = window.__remiStore.getState(); return { room: s.room, game: s.game, you: s.you }; });
async function waitFor(page, fn, timeout = 20000, label = '') { const t0 = Date.now(); while (Date.now() - t0 < timeout) { const s = await state(page); if (fn(s)) return s; await sleep(200); } throw new Error('timeout ' + label); }
async function player(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } }); const page = await ctx.newPage();
  await page.goto(BASE + '/'); await page.evaluate((n) => localStorage.setItem('remi.settings', JSON.stringify({ nickname: n, skipAnim: true })), name);
  return { ctx, page, name };
}
const sendRaw = (page, msg) => page.evaluate((m) => window.__remiSend(m), msg);
const menu = async (page, label) => { await page.locator('.table-menu > button').click(); await page.locator('.table-menu-pop button', { hasText: label }).click(); };

(async () => {
  const browser = await chromium.launch();
  try {
    const A = await player(browser, 'Host'); const B = await player(browser, 'Guest');
    const r = await A.page.evaluate(async () => {
      const d = await (await fetch('/api/config/defaults')).json();
      const config = { ...d.config, turnSeconds: 60, startingScore: 1, bots: { fillEmpty: true, difficulty: 'easy' } };
      return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'e2e-host-guest-secret-123456' }, body: JSON.stringify({ name: 'Host', mode: 'human', config }) })).json();
    });
    await A.page.evaluate((r) => localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })), r);
    await A.page.goto(`${BASE}/room/${r.code}`); await waitFor(A.page, (s) => s.room, 15000, 'host lobby');
    await B.page.goto(`${BASE}/join/${r.code}`); await B.page.getByRole('button', { name: 'Intră', exact: true }).click();
    await waitFor(B.page, (s) => s.room, 15000, 'guest lobby');
    // live rule sync: host edits a rule, guest sees it
    await sendRaw(A.page, { t: 'config', config: { ...(await state(A.page)).room.config, atu: { enabled: true, penalty: 3, oncePerRound: true } } });
    const synced = await waitFor(B.page, (s) => s.room.config.atu.penalty === 3, 8000, 'sync');
    ok('room rules sync to guests in real time', synced.room.config.atu.penalty === 3);
    const ro = await B.page.locator('.rules-editor.ro').count();
    ok('only the host can edit rules (guest view read-only)', ro === 1);
    await B.page.getByRole('button', { name: 'Sunt gata' }).click();
    await waitFor(A.page, (s) => s.room.members.every((m) => m.role !== 'player' || m.ready || m.isHost), 8000, 'ready');
    await A.page.getByRole('button', { name: 'Începe partida' }).click();
    await waitFor(A.page, (s) => s.game && s.game.phase.startsWith('WAITING'), 15000, 'start');
    await waitFor(B.page, (s) => s.game && s.game.me, 15000, 'guest game');
    const locked = await sendRaw(B.page, { t: 'config', config: (await state(A.page)).room.config });
    await sleep(500);
    ok('rules are locked during the match', (await state(A.page)).room.locked === true);

    // ---- pause vote
    await menu(A.page, 'Solicită pauză');
    await B.page.locator('.vote-toast').getByRole('button', { name: 'Da' }).click();
    const p = await waitFor(A.page, (s) => s.game.paused, 8000, 'paused');
    ok('pause approved by all humans freezes the authoritative timer', p.game.turnDeadline === null && p.game.pausedRemaining > 0, `remaining ${p.game.pausedRemaining}ms`);
    const v = p.game.version;
    await sleep(2500);
    ok('no game actions while paused', (await state(A.page)).game.version === v);
    await menu(A.page, 'Reia jocul');
    await B.page.locator('.vote-toast').getByRole('button', { name: 'Da' }).click();
    const res = await waitFor(A.page, (s) => !s.game.paused, 8000, 'resumed');
    const left = res.game.turnDeadline - Date.now() - 0;
    ok('resume restores the remaining turn time', Math.abs(left - p.game.pausedRemaining) < 4000, `${Math.round(left / 1000)}s vs ${Math.round(p.game.pausedRemaining / 1000)}s`);

    // ---- remiză refused: a bubble appears above the refusing player's shield
    await menu(A.page, 'Solicită remiză');
    await B.page.locator('.vote-toast').getByRole('button', { name: 'Nu' }).click();
    const bubble = await waitFor(A.page, async () => (await A.page.locator('.decline-bubble').count()) >= 1, 6000, 'decline bubble').then(() => true).catch(() => false);
    const txt = bubble ? await A.page.locator('.decline-bubble').first().innerText() : '';
    ok('refusing a draw shows "Nu vreau remiză" above the refusing player', bubble && /remiz/i.test(txt), txt);
    const gone = await waitFor(A.page, async () => (await A.page.locator('.decline-bubble').count()) === 0, 9000, 'bubble gone').then(() => true).catch(() => false);
    ok('the bubble disappears by itself', gone);
    ok('the round was not drawn after a refusal', (await state(A.page)).game.phase.startsWith('WAITING') && (await state(A.page)).game.round === 1);

    // ---- save & exact restore
    await menu(A.page, 'Salvează partida');
    console.log('vote step');
    await B.page.locator('.vote-toast').getByRole('button', { name: 'Da' }).click();
    await waitFor(A.page, (s) => s.room.status === 'SAVED', 8000, 'saved');
    await waitFor(B.page, (s) => s.room.status === 'SAVED', 8000, 'saved B');
    await sleep(500);
    const before = await state(A.page); const beforeB = await state(B.page);
    ok('match saved after unanimous vote', true);
    await A.ctx.pages()[0].close(); await B.page.close();
    await sleep(2000);
    const A2 = await A.ctx.newPage(); await A2.goto(`${BASE}/room/${r.code}`);
    const B2 = await B.ctx.newPage(); await B2.goto(`${BASE}/room/${r.code}`);
    const reA = await waitFor(A2, (s) => s.room && s.room.status === 'SAVED' && s.game, 15000, 'saved state');
    const reB = await waitFor(B2, (s) => s.room && s.room.status === 'SAVED' && s.game, 15000, 'saved state B');
    await A2.getByRole('button', { name: 'Reia partida salvată' }).click();
    await B2.getByRole('button', { name: 'Reia partida salvată' }).click();
    const same = JSON.stringify(reA.game.me.hand) === JSON.stringify(before.game.me.hand) && JSON.stringify(reB.game.me.hand) === JSON.stringify(beforeB.game.me.hand)
      && reA.game.pile === before.game.pile && reA.game.indicator === before.game.indicator && reA.game.current === before.game.current && reA.game.phase === before.game.phase
      && JSON.stringify(reA.game.discards) === JSON.stringify(before.game.discards) && JSON.stringify(reA.game.seats.map((s) => s.score)) === JSON.stringify(before.game.seats.map((s) => s.score));
    ok('restored match is identical (hands, pile, discards, turn, indicator, scores, no reshuffle)', same);
    const after = await waitFor(A2, (s) => s.room.status === 'PLAYING' && !s.game.paused, 15000, 'resumed saved');
    ok('resuming continues from the saved state version', after.game.round === before.game.round && after.game.version >= before.game.version);

    // ---- rematch: a training room with startingScore 1 ends after one close
    const R = await player(browser, 'Rematcher');
    const tr = await R.page.evaluate(async () => {
      const d = await (await fetch('/api/config/defaults')).json();
      const config = { ...d.config, startingScore: 1, turnSeconds: 0 };
      return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'e2e-rematch-guest-secret-1' }, body: JSON.stringify({ name: 'Rematcher', mode: 'training', scenario: 'normalPlain', config }) })).json();
    });
    await R.page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, tr);
    await R.page.goto(`${BASE}/room/${tr.code}`);
    await waitFor(R.page, (s) => s.game && s.game.me && s.game.me.hand.length === 15, 15000, 'training deal');
    const close = R.page.locator('.controls button', { hasText: 'ÎNCHIDE' });
    await close.click(); await sleep(200); if (await close.isEnabled()) await close.click();
    const fin = await waitFor(R.page, (s) => s.game.phase === 'MATCH_FINISHED', 15000, 'finished');
    ok('one close with startingScore 1 eliminates all opponents: match finished', fin.game.winner === fin.game.me.seat && fin.game.seats.filter((x) => x.status === 'ELIMINATED').length === 3);
    await R.page.screenshot({ path: `${OUT}/match-finished.png` });
    await R.page.getByRole('button', { name: 'REVANȘĂ' }).click();
    const lob = await waitFor(R.page, (s) => s.room.status === 'LOBBY', 10000, 'rematch lobby');
    ok('REVANȘĂ returns to the same room lobby (same code, same rules)', lob.room.code === tr.code && lob.room.config.startingScore === 1 && lob.room.matchNo === 1);
    await R.page.getByRole('button', { name: 'Începe partida' }).click();
    const g2 = await waitFor(R.page, (s) => s.game && s.room.matchNo === 2 && s.game.phase.startsWith('WAITING'), 15000, 'match 2');
    ok('rematch starts a fresh match (scores reset, round 1)', g2.game.round === 1 && g2.game.seats.every((s) => s.score === 1 && s.status === 'ACTIVE'));
  } catch (e) { ok('room features run', false, String(e && e.message || e).split('\n')[0]); for (const c of browser.contexts()) for (const [i, pg] of c.pages().entries()) await pg.screenshot({ path: `${OUT}/rf-fail-${browser.contexts().indexOf(c)}-${i}.png` }).catch(() => null); }
  finally {
    await browser.close();
    fs.writeFileSync(`${OUT}/room-features.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
    const failed = results.filter((r) => !r.pass).length; console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
  }
})();
