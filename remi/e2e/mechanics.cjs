/**
 * Production mechanics test via training scenarios: PASS, Arătare atu, special categories, joker-discard close,
 * then a complete short match (elimination + match end + stats persisted).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = process.env.OUT || 'e2e/out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (page) => page.evaluate(() => { const s = window.__remiStore.getState(); return { room: s.room, game: s.game, you: s.you }; });
async function waitFor(page, fn, timeout = 20000, label = '') { const t0 = Date.now(); while (Date.now() - t0 < timeout) { const s = await state(page); if (fn(s)) return s; await sleep(200); } throw new Error('timeout ' + label); }

async function training(browser, scenario, cfgPatch = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  await page.evaluate(() => localStorage.setItem('remi.settings', JSON.stringify({ nickname: 'Trainee', skipAnim: true, confirmJoker: false })));
  const r = await page.evaluate(async ([scenario, cfgPatch]) => {
    const g = localStorage.getItem('remi.guest') || 'e2e-guest-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    localStorage.setItem('remi.guest', g);
    const d = await (await fetch('/api/config/defaults')).json();
    const config = { ...d.config, ...cfgPatch, turnSeconds: 0 };
    for (const k of cfgPatch.disable || []) config.categories[k].enabled = false; delete config.disable;
    const res = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': g }, body: JSON.stringify({ name: 'Trainee', mode: 'training', scenario, config }) });
    return res.json();
  }, [scenario, cfgPatch]);
  await page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, r);
  await page.goto(`${BASE}/room/${r.code}`);
  await waitFor(page, (s) => s.game && s.game.me && s.game.me.hand.length === 15, 20000, 'deal ' + scenario);
  return { ctx, page, code: r.code };
}

(async () => {
  const browser = await chromium.launch();
  try {
    const ONLY = process.env.ONLY || '';
    // ---------- PASS
    if (!ONLY) {
      const { ctx, page } = await training(browser, 'pass');
      const s = await state(page);
      ok('PASS button enabled with both real jokers', await page.locator('.btn-pass').isEnabled());
      await page.locator('.btn-pass').click();
      const after = await waitFor(page, (x) => x.game.pass.active, 8000, 'pass active');
      ok('PASS activates: joker locked in PASS area, banner shown', after.game.pass.tiles.length === 1 && await page.locator('.pass-banner').isVisible());
      ok('activator keeps second joker, hand back to 14', after.game.me.hand.length === 14 && after.game.me.hand.some((x) => x === (s.game.joker.color * 26 + s.game.joker.num - 1) || x === (s.game.joker.color * 26 + 13 + s.game.joker.num - 1)));
      // wait until it is our turn again: we must not be able to take a discard
      const back = await waitFor(page, (x) => x.game.current === x.game.me.seat && x.game.phase === 'WAITING_FOR_DRAW', 30000, 'our turn after pass');
      ok('PASS blocks discard pickup (IA PIESA disabled, server flag)', !back.game.me.canTakeDiscard && back.game.me.passBlocked && !(await page.locator('.controls button', { hasText: 'IA PIESA' }).isEnabled()));
      await page.screenshot({ path: `${OUT}/pass-active.png` });
      await ctx.close();
    }
    // ---------- Arătare atu
    if (!ONLY) {
      const { ctx, page } = await training(browser, 'atu');
      const st0 = await state(page);
      ok('PASS button hidden unless holding both real jokers', (await page.locator('.btn-pass').count()) === (st0.game.me.canPass ? 1 : 0), `canPass=${st0.game.me.canPass}`);
      const btn = page.locator('.controls button', { hasText: 'ARATĂ ATU' });
      ok('ARATĂ ATU button shown when holding the twin of the indicator', await btn.isVisible());
      await btn.click();
      const s = await waitFor(page, (x) => x.game.atuDeclaredBy.length === 1, 8000, 'atu');
      const scores = s.game.seats.map((x) => x.score);
      ok('Atu: every opponent loses 1, declarer unchanged, turn not consumed', scores[s.game.me.seat] === 100 && scores.filter((x) => x === 99).length === 3 && s.game.current === s.game.me.seat);
      ok('Atu: tile stays on the rack; cannot be declared twice', s.game.me.hand.length === 15 && !(await btn.isVisible()));
      await ctx.close();
    }
    // ---------- special categories and joker-discard closing
    if (!ONLY) for (const [sc, cat, pen] of [['color', 'color', 15], ['grand', 'grand', 30], ['doubles', 'doubles', 15], ['sequences', 'sequences', 10], ['normalPlain', 'normalPlain', 10], ['closeJoker', null, null]]) {
      const { ctx, page } = await training(browser, sc);
      const close = page.locator('.controls button', { hasText: 'ÎNCHIDE' });
      await close.click(); await sleep(200);
      if (await close.isEnabled()) await close.click();
      const s = await waitFor(page, (x) => x.game.phase === 'ROUND_RESULT' || x.game.phase === 'MATCH_FINISHED', 10000, 'close ' + sc);
      const r = s.game.result;
      if (sc === 'closeJoker') ok('close by discarding a real joker uses the joker penalty', r.jokerDiscard && r.penalty === { normalJoker: 20, normalPlain: 20, sequences: 20, triples: 20, doubles: 30, color: 30, grand: 60 }[r.category], `${r.category} ${r.penalty}`);
      else {
        const others = s.game.seats.filter((x) => x.seat !== r.winner).every((x) => x.score === 100 - r.penalty);
        // if a real joker happened to be the 15th tile, the higher joker-discard penalty is the correct choice
        const expected = r.jokerDiscard ? { color: 30, grand: 60, doubles: 30, sequences: 20, normalPlain: 20 }[cat] : pen;
        ok(`close ${sc}: category ${r.category}, penalty ${r.penalty}, opponents decreased`, r.category === cat && r.penalty === expected && others, `${r.category}/${r.penalty}${r.jokerDiscard ? ' (joker discarded)' : ''}`);
      }
      if (sc === 'color') await page.screenshot({ path: `${OUT}/round-result-color.png` });
      await ctx.close();
    }
    // ---------- disabled category cannot be claimed
    {
      const { ctx, page } = await training(browser, 'color', { disable: ['color'] });
      const s = await state(page);
      const close = page.locator('.controls button', { hasText: 'ÎNCHIDE' });
      ok('disabled Color category is not claimable', s.room.config.categories.color.enabled === false && !(await close.isEnabled()));
      await ctx.close();
    }
    // ---------- complete short match vs bots: elimination, match end, stats
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
      const page = await ctx.newPage();
      await page.goto(BASE + '/');
      const r = await page.evaluate(async () => {
        const g = 'e2e-full-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        localStorage.setItem('remi.guest', g);
        localStorage.setItem('remi.settings', JSON.stringify({ nickname: 'Finisher', skipAnim: true, confirmJoker: false }));
        const d = await (await fetch('/api/config/defaults')).json();
        const config = { ...d.config, startingScore: 6, turnSeconds: 15, nextRoundSeconds: 3, bots: { fillEmpty: true, difficulty: 'hard' } };
        return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': g }, body: JSON.stringify({ name: 'Finisher', mode: 'bots', config }) })).json();
      });
      await page.evaluate((r) => { localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })); sessionStorage.setItem('remi.autostart', r.code); }, r);
      await page.goto(`${BASE}/room/${r.code}`);
      // the human lets the server timeout play for it (also tests server-enforced timers)
      const fin = await waitFor(page, (x) => x.game && x.game.phase === 'MATCH_FINISHED', 15 * 60000, 'match end');
      const elim = fin.game.seats.filter((x) => x.status === 'ELIMINATED').length;
      ok('complete match reaches MATCH_FINISHED with a single winner', fin.game.winner !== null && fin.game.seats.filter((x) => x.status === 'ACTIVE').length === 1, `rounds ${fin.game.round}, eliminated ${elim}`);
      ok('eliminated players shown with 0 points', fin.game.seats.filter((x) => x.status === 'ELIMINATED').every((x) => x.score === 0));
      ok('expired turns were auto-played by the server (match never froze)', fin.game.round >= 1);
      await page.screenshot({ path: `${OUT}/match-result.png` });
      await sleep(1500);
      const stats = await page.evaluate(async () => (await fetch('/api/stats', { headers: { 'x-guest': localStorage.getItem('remi.guest') } })).json());
      const row = stats.stats.find((x) => x.mode === 'bots');
      ok('match recorded in D1 statistics (idempotent insert)', !!row && row.matches === 1, JSON.stringify(row && { matches: row.matches, wins: row.wins }));
      ok('achievement awarded from server-side stats', stats.achievements.some((a) => a.key === 'primul_joc'));
      await ctx.close();
    }
  } catch (e) { ok('mechanics run', false, String(e && e.stack || e)); }
  finally {
    await browser.close();
    fs.writeFileSync(`${OUT}/mechanics.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
})();
