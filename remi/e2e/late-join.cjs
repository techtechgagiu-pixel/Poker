/** Invitation link during a match: replace bots, queue when full, queue promoted when a seat frees. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787'; const OUT = process.env.OUT || 'e2e/out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0;
const ok = (n, p, i = '') => { if (!p) fails++; console.log(`${p ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
const st = (p) => p.evaluate(() => { const s = window.__remiStore.getState(); return { room: s.room, game: s.game, you: s.you }; });
async function until(p, fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const s = await st(p); if (fn(s)) return s; await sleep(250); } throw new Error('timeout'); }
(async () => {
  const b = await chromium.launch();
  const mk = async (name) => { const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p = await ctx.newPage(); await p.goto(BASE + '/'); await p.evaluate((n) => localStorage.setItem('remi.settings', JSON.stringify({ nickname: n, confirmJoker: false })), name); return p; };
  try {
    const host = await mk('Gazda');
    const r = await host.evaluate(async () => { const d = await (await fetch('/api/config/defaults')).json();
      return (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest': 'late-' + Date.now() }, body: JSON.stringify({ name: 'Gazda', mode: 'human', config: { ...d.config, turnSeconds: 0 } }) })).json(); });
    await host.evaluate((r) => localStorage.setItem('remi.room.' + r.code, JSON.stringify({ token: r.token, pid: r.pid })), r);
    await host.goto(`${BASE}/room/${r.code}`); await until(host, (s) => s.room);
    await host.getByRole('button', { name: 'Începe partida' }).click();
    const s0 = await until(host, (s) => s.game && s.game.phase.startsWith('WAITING'));
    ok('match started with 1 human + 3 bots', s0.game.seats.filter((x) => x.isBot).length === 3);
    const joiners = [];
    for (const n of ['Marius', 'Ioana', 'Dan', 'Costel', 'Elena']) {
      const p = await mk(n); joiners.push(p);
      await p.goto(`${BASE}/join/${r.code}`);
      await p.getByRole('button', { name: 'Intră', exact: true }).click();
      await until(p, (s) => s.room && s.you);
      await sleep(400);
    }
    const [m1, m2, m3, q1, q2] = joiners;
    for (const [p, n] of [[m1, 'Marius'], [m2, 'Ioana'], [m3, 'Dan']]) {
      const s = await until(p, (s) => s.game && s.game.me, 10000).catch(() => null);
      ok(`${n} joined mid-match and took over a bot seat (own hand)`, !!s && [14, 15].includes(s.game.me.hand.length) && s.game.seats[s.game.me.seat].name === n);
    }
    const hs = await st(host);
    ok('no bots left at the table after three late joins', hs.game.seats.every((x) => !x.isBot));
    const sq1 = await st(q1), sq2 = await st(q2);
    const mq1 = sq1.room.members.find((m) => m.pid === sq1.you.pid), mq2 = sq2.room.members.find((m) => m.pid === sq2.you.pid);
    ok('table full: 5th and 6th wait in the queue as spectators (#1, #2), without hands', sq1.game.me === null && mq1.queued && mq1.queuePos === 1 && mq2.queuePos === 2);
    await q1.screenshot({ path: `${OUT}/queue-spectator.png` });
    // Dan leaves his seat -> a bot takes it -> first in queue gets it immediately
    await m3.locator('.table-menu > button').click();
    m3.once('dialog', (d) => d.accept());
    await m3.locator('.table-menu-pop button', { hasText: 'Părăsește locul' }).click();
    const promoted = await until(q1, (s) => s.game && s.game.me, 10000).catch(() => null);
    ok('a freed seat goes automatically to #1 in the queue (Costel)', !!promoted && promoted.game.seats[promoted.game.me.seat].name === 'Costel');
    const sq2b = await until(q2, (s) => s.room.members.find((m) => m.pid === s.you.pid).queuePos === 1, 8000).catch(() => null);
    ok('the next spectator moves up to #1', !!sq2b);
    const sd = await st(m3);
    ok('the player who left becomes a spectator', sd.you.role === 'spectator' && sd.game.me === null);
    // conservation from public info: hand counts + pile + discards + pass = 105 minus indicator… check counts consistent
    const hg = (await st(host)).game;
    const total = hg.seats.reduce((a, x) => a + x.tiles, 0) + hg.pile + hg.discards.flat().length + hg.pass.tiles.length + 1;
    ok('tile count is still 106 after the seat changes', total === 106, String(total));
  } catch (e) { ok('late-join run', false, String(e && e.message || e).split('\n')[0]); }
  await b.close(); process.exit(fails ? 1 : 0);
})();
