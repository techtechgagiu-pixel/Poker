const $ = s => document.querySelector(s);
const stage = $('#stage');
const RANKS = '23456789TJQKA', SUITS = ['♠', '♥', '♦', '♣'];
const CX = 800, CY = 438, RX = 468, RY = 288;
const POT = { x: 800, y: 440 };
let S = null, offset = 0, scale = 1, prev = null;
const seatEls = {}, betEls = {};

function fit() {
  scale = Math.min(innerWidth / 1600, innerHeight / 900);
  stage.style.transform = `translate(${-800 * scale}px,${-450 * scale}px) scale(${scale})`;
}
addEventListener('resize', fit); fit();

const cardEl = (c, { sm = false, down = false } = {}) => {
  const r = c % 13, s = Math.floor(c / 13);
  const d = document.createElement('div');
  d.className = 'pc' + (sm ? ' sm' : '') + (s === 1 || s === 2 ? ' red' : '') + (down ? ' down' : '');
  d.dataset.c = c;
  d.innerHTML = `<div class="f"><span>${RANKS[r] === 'T' ? '10' : RANKS[r]}</span><small>${SUITS[s]}</small></div><div class="b"></div>`;
  return d;
};
const seatPos = i => { const a = Math.PI / 2 + i * 2 * Math.PI / 9; return { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) }; };
const toStage = el => { const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect(); return { x: (r.left - sr.left + r.width / 2) / scale, y: (r.top - sr.top + r.height / 2) / scale }; };
function flyIn(el, from, ms = 550, delay = 0) {
  const to = toStage(el);
  el.animate([{ transform: `translate(${from.x - to.x}px,${from.y - to.y}px) scale(.5) rotate(180deg)`, opacity: 0 },
              { opacity: 1 }, { transform: 'none', opacity: 1 }], { duration: ms, delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' });
}
function flyChips(from, to, n = 6, ms = 700) {
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i'); c.className = 'chip';
    c.style.left = from.x - 10 + 'px'; c.style.top = from.y - 10 + 'px'; $('#fly').appendChild(c);
    const a = c.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${to.x - from.x + (Math.random() * 30 - 15)}px,${to.y - from.y + (Math.random() * 30 - 15)}px) scale(.8)`, opacity: .9 }],
      { duration: ms, delay: i * 70, easing: 'ease-in-out', fill: 'both' });
    a.onfinish = () => c.remove();
  }
}

// ---- constructie asezare locuri ----
const CHAR_ID = ['baron', 'zora', 'gus', 'mary', 'odds', 'lou', 'chef', 'captain', 'zero'];
function buildSeats(players) {
  const box = $('#seats'); box.innerHTML = '';
  players.forEach(p => {
    const pos = seatPos(p.seat);
    const el = document.createElement('div'); el.className = 'seat';
    el.style.left = pos.x + 'px'; el.style.top = pos.y - 76 + 'px';
    el.innerHTML = `<div class="bubble"></div><div class="name">${p.name}</div><span class="act"></span>
      <div class="ava"><img src="img/${p.id}.png" alt=""><svg viewBox="0 0 114 114"><circle class="ring" cx="57" cy="57" r="54"/></svg></div>
      <div class="hole"></div><div class="stack"></div><span class="mdl"></span>`;
    box.appendChild(el); seatEls[p.id] = el;
    const b = document.createElement('div'); b.className = 'bet hide'; b.innerHTML = '<i class="chip"></i><span></span>';
    const k = .36; b.style.left = pos.x + (CX - pos.x) * k + 'px'; b.style.top = pos.y + (CY - pos.y) * k + 'px';
    box.appendChild(b); betEls[p.id] = b;
  });
}

// ---- randare stare ----
function render(s) {
  if (!Object.keys(seatEls).length) buildSeats(s.players);
  const lastS = prev; prev = s;
  $('#handNo').textContent = s.hand; $('#blinds').textContent = `${s.sb} / ${s.bb}`;
  $('#alive').textContent = s.players.filter(p => !p.out).length;
  $('#potAmt').textContent = s.pot.toLocaleString('ro-RO');
  $('#street').textContent = s.street || '';
  $('#tickerText').textContent = s.ticker;
  $('#mode').textContent = s.llm ? 'Agenți: LLM prin OpenRouter' : 'Agenți: boți euristici (lipsește OPENROUTER_API_KEY)';
  $('#modeInfo').textContent = s.llm ? '✔ OpenRouter activ — fiecare personaj gândește cu un LLM.' : '⚠ Fără OPENROUTER_API_KEY: jucătorii folosesc boți euristici (poți seta cheia și reporni).';
  $('#intro').classList.toggle('hidden', s.phase === 'running' || s.phase === 'finished');
  $('#champion').classList.toggle('hidden', s.phase !== 'finished' || !s.champion);
  if (s.champion && s.phase === 'finished') { const w = s.players.find(p => p.id === s.champion); $('#champImg').src = `img/${w.id}.png`; $('#champName').textContent = w.name; }

  // board
  const comm = $('#community'), have = [...comm.children].map(e => +e.dataset.c);
  if (s.board.length < have.length || s.board.some((c, i) => have[i] !== undefined && have[i] !== c)) comm.innerHTML = '';
  const deckP = toStage($('#deck'));
  s.board.forEach((c, i) => {
    if (comm.children[i]) return;
    const e = cardEl(c); comm.appendChild(e);
    flyIn(e, deckP, 600, (i - (lastS ? lastS.board.length : 0)) * 220);
  });

  s.players.forEach(p => {
    const el = seatEls[p.id];
    el.classList.toggle('folded', p.folded); el.classList.toggle('out', p.out);
    el.classList.toggle('thinking', s.turn === p.id);
    el.querySelector('.ava').dataset.place = p.out ? `#${p.place}` : '';
    el.querySelector('.stack').textContent = p.stack.toLocaleString('ro-RO');
    el.querySelector('.mdl').textContent = s.llm ? p.model.split('/').pop() : '';
    const act = el.querySelector('.act'), lab = p.last.split(' ')[0];
    act.textContent = p.last; act.className = 'act ' + lab + (p.last ? ' show' : '');
    // tag-uri D / SB / BB
    el.querySelectorAll('.tag').forEach(t => t.remove());
    [['D', s.dealer], ['SB', s.sbId], ['BB', s.bbId]].forEach(([t, id]) => {
      if (id === p.id && !p.out) { const d = document.createElement('div'); d.className = 'tag ' + t; d.textContent = t === 'D' ? 'D' : t; el.querySelector('.ava').appendChild(d); }
    });
    // carti
    const hole = el.querySelector('.hole'), had = hole.children.length;
    if (p.cards.length !== had) {
      hole.innerHTML = '';
      p.cards.forEach((c, i) => { const e = cardEl(c, { sm: true }); hole.appendChild(e); if (had === 0) flyIn(e, deckP, 650, (p.seat + i * 9) * 70); });
    }
    // pariu
    const b = betEls[p.id];
    b.classList.toggle('hide', !p.bet);
    if (p.bet) { b.querySelector('span').textContent = p.bet.toLocaleString('ro-RO'); if (!lastS || lastS.players[p.seat].bet !== p.bet) { const pos = seatPos(p.seat); flyChips(pos, { x: parseFloat(b.style.left), y: parseFloat(b.style.top) }, 3, 450); } }
    else if (lastS && lastS.players[p.seat].bet && s.pot > lastS.pot) flyChips({ x: parseFloat(b.style.left), y: parseFloat(b.style.top) }, POT, 4, 600);
  });

  // clasament
  const order = [...s.players].sort((a, b) => (a.out - b.out) || (a.out ? a.place - b.place : b.stack - a.stack));
  $('#lb').innerHTML = order.map(p => `<div class="lb-row${p.out ? ' out' : ''}${s.turn === p.id ? ' turn' : ''}"><img src="img/${p.id}.png"><span class="n">${p.name}</span><span class="s">${p.out ? '#' + p.place : p.stack.toLocaleString('ro-RO')}</span></div>`).join('');
  // feed
  const feed = $('#feed');
  const lines = s.log.slice(-14);
  if (feed.dataset.sig !== lines.join('|')) {
    feed.dataset.sig = lines.join('|');
    feed.innerHTML = lines.map(l => `<div class="${/^(Mâna|⬆|🏆|💀|Turneul|Flop|Turn|River)/.test(l) ? 'sys' : ''}">${l.replace(/</g, '&lt;')}</div>`).join('');
  }
}

// ---- efecte ----
function bubble(id, text) {
  const b = seatEls[id]?.querySelector('.bubble'); if (!b || !text) return;
  b.textContent = text; b.classList.add('show'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('show'), 3400);
}
function fx(f) {
  if (f.type === 'action') bubble(f.id, f.say);
  if (f.type === 'win') {
    f.winners.forEach(w => {
      const el = seatEls[w.id]; if (!el) return;
      el.classList.add('winner'); setTimeout(() => el.classList.remove('winner'), 3800);
      flyChips(POT, toStage(el.querySelector('.ava')), 10, 900);
      if (w.hand) bubble(w.id, w.hand + '!');
    });
    if (f.showdown) setTimeout(() => document.querySelectorAll('#community .pc').forEach(c => c.classList.add('win')), 300);
  }
  if (f.type === 'shuffle') { const d = $('#deck'); d.innerHTML = '<div class="pc down"><div class="f"></div><div class="b"></div></div>'; d.firstChild.animate([{ transform: 'translateX(-30px) rotate(-8deg)' }, { transform: 'translateX(30px) rotate(8deg)' }, { transform: 'translateX(-20px) rotate(-5deg)' }, { transform: 'none' }], { duration: 1400 }); }
  if (f.type === 'deal' ) { $('#deck').innerHTML = '<div class="pc down"><div class="f"></div><div class="b"></div></div>'; }
  if (f.type === 'bust') { const el = seatEls[f.id]; el?.animate([{ transform: 'scale(1.2) rotate(-6deg)' }, { transform: 'none' }], { duration: 700 }); bubble(f.id, 'Adio, Vegas!'); }
  if (f.type === 'champion') confetti();
}
function confetti() {
  const cv = $('#confetti'), ctx = cv.getContext('2d'); cv.width = 1600; cv.height = 900;
  const ps = Array.from({ length: 220 }, () => ({ x: Math.random() * 1600, y: -Math.random() * 600, vx: Math.random() * 4 - 2, vy: 2 + Math.random() * 5, r: 4 + Math.random() * 6, c: ['#f5c542', '#ff2bd6', '#26d9ff', '#fff', '#e5173f'][Math.floor(Math.random() * 5)], a: Math.random() * 6 }));
  const t0 = performance.now();
  (function step(t) {
    ctx.clearRect(0, 0, 1600, 900);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.a += .1; ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); });
    if (t - t0 < 9000) requestAnimationFrame(step); else ctx.clearRect(0, 0, 1600, 900);
  })(t0);
}

// ---- timer frame loop ----
(function loop() {
  if (S) {
    const now = Date.now() + offset;
    if (S.turn && S.deadline) {
      const frac = Math.max(0, Math.min(1, (S.deadline - now) / S.timeoutMs));
      const ring = seatEls[S.turn]?.querySelector('.ring'); if (ring) { ring.style.strokeDashoffset = 339.3 * (1 - frac); ring.style.stroke = frac < .3 ? '#e5173f' : '#26d9ff'; }
    }
    if (S.nextLevelAt) { const ms = Math.max(0, S.nextLevelAt - now); $('#nextLevel').textContent = String(Math.floor(ms / 60000)).padStart(2, '0') + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0'); }
    else $('#nextLevel').textContent = '--:--';
  }
  requestAnimationFrame(loop);
})();

// ---- retea ----
const es = new EventSource('/api/events');
es.addEventListener('state', e => { S = JSON.parse(e.data); offset = S.now - Date.now(); render(S); });
es.addEventListener('fx', e => fx(JSON.parse(e.data)));
$('#startBtn').onclick = () => fetch('/api/start', { method: 'POST' });
$('#againBtn').onclick = async () => { await fetch('/api/reset', { method: 'POST' }); fetch('/api/start', { method: 'POST' }); };
