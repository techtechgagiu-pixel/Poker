// Motorul turneului: o masa, 9 jucatori, blinduri crescatoare in timp real.
import fs from 'node:fs';
import { shuffledDeck, bestScore, handName } from './cards.js';
import { decide, modelFor, llmEnabled, TIMEOUT_MS } from './bots.js';

const CHARS = JSON.parse(fs.readFileSync(new URL('../characters.json', import.meta.url), 'utf8'));
const START_STACK = +process.env.START_STACK || 1000;
const LEVEL_MS = (+process.env.BLIND_MINUTES || 5) * 60_000;
const SPEED = +process.env.SPEED || 1; // >1 = animatii mai rapide (pt teste)
const LEVELS = [[25, 50], [50, 100], [100, 200], [200, 400], [400, 800], [800, 1600], [1500, 3000], [3000, 6000]];
const sleep = ms => new Promise(r => setTimeout(r, ms / SPEED));
const STREETS = ['Preflop', 'Flop', 'Turn', 'River'];

export class Game {
  constructor(emit) {
    this.emit = emit; // emit(type, payload) -> broadcast SSE
    this.reset();
  }
  reset() {
    this.runId = (this.runId || 0) + 1;
    this.phase = 'idle';
    this.players = CHARS.map((c, i) => ({ id: c.id, name: c.name, seat: i, stack: START_STACK, bet: 0, total: 0,
      cards: [], folded: false, allIn: false, out: false, place: 0, last: '', source: '', model: modelFor(i), thinking: false }));
    this.board = []; this.pot = 0; this.hand = 0; this.button = -1; this.levelIdx = 0;
    this.turn = null; this.deadline = 0; this.startedAt = 0; this.champion = null; this.ticker = 'Masa e pregătită. Apasă START!';
    this.recent = []; this.log = []; this.street = ''; this.revealed = false; this.dealer = this.sb = this.bb = null;
    this.push();
  }
  get level() { return LEVELS[Math.min(this.levelIdx, LEVELS.length - 1)]; }
  snapshot() {
    return {
      phase: this.phase, hand: this.hand, sb: this.level[0], bb: this.level[1], levelIdx: this.levelIdx,
      nextLevelAt: this.phase === 'running' ? this.startedAt + (this.levelIdx + 1) * LEVEL_MS : 0, levelMs: LEVEL_MS,
      now: Date.now(), board: this.board, pot: this.pot, street: this.street, turn: this.turn, deadline: this.deadline,
      timeoutMs: TIMEOUT_MS, ticker: this.ticker, champion: this.champion, log: this.log.slice(-40), llm: llmEnabled(),
      dealer: this.dealer, sbId: this.sb, bbId: this.bb, startStack: START_STACK,
      players: this.players.map(p => ({ id: p.id, name: p.name, seat: p.seat, stack: p.stack, bet: p.bet, cards: p.cards,
        folded: p.folded, allIn: p.allIn, out: p.out, place: p.place, last: p.last, source: p.source, model: p.model, thinking: p.thinking })),
    };
  }
  push() { this.emit('state', this.snapshot()); }
  say(text) { this.ticker = text; this.log.push(text); }
  alive() { return this.players.filter(p => !p.out); }

  async start() {
    if (this.phase === 'running') return;
    this.reset();
    this.phase = 'running'; this.startedAt = Date.now();
    const run = this.runId;
    this.say('Turneul începe! 9 jucători, 1 singur câștigător.');
    this.push();
    this.emit('fx', { type: 'intro' });
    await sleep(2500);
    try {
      while (this.alive().length > 1 && run === this.runId) await this.playHand(run);
      if (run === this.runId) {
        const w = this.alive()[0];
        w.place = 1; this.champion = w.id; this.phase = 'finished'; this.turn = null;
        this.say(`🏆 ${w.name} câștigă turneul!`);
        this.push(); this.emit('fx', { type: 'champion', id: w.id });
      }
    } catch (e) { console.error('Eroare joc:', e); this.say('Eroare în joc: ' + e.message); this.phase = 'finished'; this.push(); }
  }

  nextSeat(i, pred = p => !p.out) {
    for (let k = 1; k <= 9; k++) { const p = this.players[(i + k) % 9]; if (pred(p)) return p; }
    return null;
  }

  async playHand(run) {
    // nivel blinduri dupa timpul scurs
    const lvl = Math.min(Math.floor((Date.now() - this.startedAt) / LEVEL_MS), LEVELS.length - 1);
    if (lvl > this.levelIdx) {
      this.levelIdx = lvl;
      this.say(`⬆ Blindurile cresc: ${this.level[0]}/${this.level[1]}`);
      this.emit('fx', { type: 'levelup', sb: this.level[0], bb: this.level[1] });
      this.push(); await sleep(2200);
    }
    this.hand++;
    const [sbAmt, bbAmt] = this.level;
    const live = this.alive();
    live.forEach(p => { p.cards = []; p.bet = 0; p.total = 0; p.folded = false; p.allIn = false; p.last = ''; p.source = ''; });
    this.board = []; this.pot = 0; this.recent = []; this.street = 'Preflop'; this.turn = null;
    this.button = this.nextSeat(this.button).seat;
    const heads = live.length === 2;
    const dealer = this.players[this.button];
    const sb = heads ? dealer : this.nextSeat(dealer.seat);
    const bb = this.nextSeat(sb.seat);
    this.dealer = dealer.id; this.sb = sb.id; this.bb = bb.id;
    this.say(`Mâna #${this.hand} — blinduri ${sbAmt}/${bbAmt}`);
    this.push(); this.emit('fx', { type: 'shuffle' }); await sleep(1600);

    // amestecare RNG + impartire
    const deck = shuffledDeck();
    const order = []; let p0 = this.nextSeat(dealer.seat);
    for (let i = 0; i < live.length; i++) { order.push(p0); p0 = this.nextSeat(p0.seat); }
    for (let r = 0; r < 2; r++) for (const p of order) p.cards.push(deck.pop());
    this.postBlind(sb, sbAmt); this.postBlind(bb, bbAmt);
    this.push(); this.emit('fx', { type: 'deal' }); await sleep(1800);

    this.cur = { bet: bbAmt, minRaise: bbAmt };
    let first = heads ? sb : this.nextSeat(bb.seat);
    let ok = await this.betRound(run, first, true);
    for (const [street, n] of [['Flop', 3], ['Turn', 1], ['River', 1]]) {
      if (run !== this.runId) return;
      if (!ok) break; // toti in afara de unul au dat fold
      this.collectBets();
      for (let i = 0; i < n; i++) this.board.push(deck.pop());
      this.street = street; this.say(`${street}`);
      this.push(); this.emit('fx', { type: 'board', street, count: n }); await sleep(n === 3 ? 1900 : 1500);
      this.cur = { bet: 0, minRaise: bbAmt };
      ok = await this.betRound(run, this.nextSeat(dealer.seat, p => !p.out && !p.folded && !p.allIn) || dealer, false);
    }
    if (run !== this.runId) return;
    await this.showdown(run, deck);
  }

  postBlind(p, amt) {
    const a = Math.min(amt, p.stack);
    p.stack -= a; p.bet += a; p.total += a; if (p.stack === 0) p.allIn = true;
  }
  collectBets() {
    for (const p of this.players) { this.pot += p.bet; p.bet = 0; }
    this.cur = { bet: 0, minRaise: this.level[1] };
  }

  // intoarce false daca a ramas un singur jucator nefoldat
  async betRound(run, start, pre) {
    const inHand = () => this.players.filter(p => !p.out && !p.folded);
    const canAct = () => inHand().filter(p => !p.allIn);
    const orderFrom = (startP) => {
      const out = []; let p = startP;
      for (let i = 0; i < 9; i++) { if (!p.out && !p.folded && !p.allIn && !out.includes(p)) out.push(p); p = this.players[(p.seat + 1) % 9]; }
      return out;
    };
    let queue = orderFrom(start);
    while (queue.length) {
      if (run !== this.runId) return false;
      if (inHand().length === 1) break;
      const p = queue.shift();
      if (p.folded || p.allIn) continue;
      const toCall = this.cur.bet - p.bet;
      // daca nimeni altcineva nu mai poate raspunde si p e deja egalat -> nu mai are rost
      if (canAct().length === 1 && toCall <= 0) continue;
      const act = await this.askPlayer(p, toCall, pre);
      const raised = this.apply(p, act);
      this.push();
      this.emit('fx', { type: 'action', id: p.id, action: p.last, say: act.say });
      await sleep(act.say ? 1800 : 900);
      if (raised) queue = orderFrom(this.players[(p.seat + 1) % 9]).filter(x => x !== p);
    }
    return inHand().length > 1;
  }

  view(p, toCall) {
    const minRaiseTo = Math.min(p.stack + p.bet, this.cur.bet + this.cur.minRaise);
    const idxs = this.players.filter(x => !x.out);
    const pos = this.dealer === p.id ? 'Dealer (buton)' : this.sb === p.id ? 'Small blind' : this.bb === p.id ? 'Big blind' : 'poziție normală';
    return { board: this.board, pot: this.pot + this.players.reduce((s, x) => s + x.bet, 0), toCall: Math.min(toCall, p.stack),
      currentBet: this.cur.bet, minRaiseTo, maxRaiseTo: p.stack + p.bet, sb: this.level[0], bb: this.level[1],
      street: this.street, position: pos, recent: this.recent.slice(-8),
      players: idxs.map(x => ({ id: x.id, name: x.name, stack: x.stack, bet: x.bet, folded: x.folded, allIn: x.allIn, out: x.out })) };
  }

  async askPlayer(p, toCall) {
    p.thinking = true; this.turn = p.id; this.deadline = Date.now() + TIMEOUT_MS;
    this.ticker = `${p.name} se gândește…`; this.push();
    const char = CHARS[p.seat];
    const t0 = Date.now();
    const d = await decide(p, char, this.view(p, toCall));
    const spent = Date.now() - t0;
    if (spent < 700) await sleep(700 - spent);
    p.thinking = false; this.turn = null; this.deadline = 0;
    return d;
  }

  // aplica actiunea validata; intoarce true daca a crescut pariul (redeschide actiunea)
  apply(p, d) {
    const toCall = this.cur.bet - p.bet;
    let action = d.action;
    if (action === 'check' && toCall > 0) action = 'fold';
    if (!['fold', 'check', 'call', 'raise', 'allin'].includes(action)) action = toCall > 0 ? 'fold' : 'check';
    if (action === 'fold' && toCall === 0) action = 'check';
    const maxTo = p.stack + p.bet;
    let raised = false;
    if (action === 'raise') {
      let to = Math.round(d.amount) || 0;
      const minTo = this.cur.bet + this.cur.minRaise;
      if (to < minTo) to = minTo;
      if (to >= maxTo) action = 'allin'; else this._raiseTo = to;
    }
    if (action === 'call' && toCall >= p.stack) action = 'allin';
    if (action === 'allin' && maxTo <= this.cur.bet && toCall > 0) { /* all-in che e doar call */ }
    let label;
    if (action === 'fold') { p.folded = true; label = 'FOLD'; }
    else if (action === 'check') label = 'CHECK';
    else if (action === 'call') { this.put(p, toCall); label = `CALL ${toCall}`; }
    else if (action === 'raise') {
      const to = this._raiseTo; this.cur.minRaise = to - this.cur.bet; this.cur.bet = to;
      this.put(p, to - p.bet); label = `RAISE ${to}`; raised = true;
    } else { // allin
      const to = maxTo;
      if (to > this.cur.bet) { this.cur.minRaise = Math.max(this.cur.minRaise, to - this.cur.bet); this.cur.bet = to; raised = true; }
      this.put(p, p.stack); label = `ALL-IN ${to}`;
    }
    p.last = label; p.source = d.source || '';
    const say = (d.say || '').trim();
    this.recent.push(`${p.name} ${label}`);
    this.log.push(`${p.name}: ${label}${say ? ' — „' + say + '”' : ''}`);
    this.ticker = `${p.name} — ${label}`;
    return raised;
  }
  put(p, amt) { amt = Math.min(amt, p.stack); p.stack -= amt; p.bet += amt; p.total += amt; if (p.stack === 0) p.allIn = true; }

  async showdown(run, deck) {
    this.collectBets();
    let contenders = this.players.filter(p => !p.out && !p.folded);
    // completeaza board daca toti sunt all-in
    if (contenders.length > 1) {
      const names = { 3: 'Flop', 4: 'Turn', 5: 'River' };
      if (this.board.length < 5) { this.say('All-in! Se întorc cărțile…'); this.revealed = true; this.push(); await sleep(1500); }
      while (this.board.length < 5) {
        const n = this.board.length === 0 ? 3 : 1;
        for (let i = 0; i < n; i++) this.board.push(deck.pop());
        this.street = names[this.board.length]; this.push();
        this.emit('fx', { type: 'board', street: this.street, count: n }); await sleep(2000);
      }
    }
    // side pots din contributii
    const contrib = this.players.filter(p => !p.out && p.total > 0);
    const levels = [...new Set(contrib.map(p => p.total))].sort((a, b) => a - b);
    let prev = 0; const results = [];
    const payouts = new Map();
    for (const lv of levels) {
      const layer = contrib.filter(p => p.total >= lv);
      const amt = (lv - prev) * layer.length; prev = lv;
      const elig = layer.filter(p => !p.folded);
      if (!elig.length) { // nimeni eligibil (toti au dat fold): merge la ultimul care a mai ramas
        const w = contenders[0]; payouts.set(w.id, (payouts.get(w.id) || 0) + amt); continue;
      }
      let winners;
      if (elig.length === 1) winners = [elig[0]];
      else {
        const sc = elig.map(p => [p, bestScore([...p.cards, ...this.board])]);
        const best = Math.max(...sc.map(x => x[1]));
        winners = sc.filter(x => x[1] === best).map(x => x[0]);
      }
      const share = Math.floor(amt / winners.length); let rem = amt - share * winners.length;
      winners.forEach(w => { payouts.set(w.id, (payouts.get(w.id) || 0) + share + (rem-- > 0 ? 1 : 0)); });
    }
    const showCards = contenders.length > 1;
    const summary = [];
    for (const [id, amt] of payouts) {
      const p = this.players.find(x => x.id === id); p.stack += amt;
      const hn = showCards && this.board.length === 5 ? handName(bestScore([...p.cards, ...this.board])) : '';
      summary.push({ id, amount: amt, hand: hn });
    }
    this.pot = 0;
    const msg = summary.map(s => `${this.players.find(x => x.id === s.id).name} câștigă ${s.amount}${s.hand ? ' cu ' + s.hand : ''}`).join(' · ');
    this.say('🏆 ' + msg); this.revealed = showCards;
    this.push(); this.emit('fx', { type: 'win', winners: summary, showdown: showCards });
    await sleep(showCards ? 4200 : 2600);

    // eliminari
    const busted = this.players.filter(p => !p.out && p.stack === 0).sort((a, b) => a.total - b.total);
    for (const p of busted) {
      p.out = true; p.place = this.alive().length + 1 + busted.filter(b => b !== p && !b.out).length;
    }
    // locul = (jucatori ramasi) + (cati busted au iesit mai tarziu din lista) + 1
    busted.forEach((p, i) => { p.place = this.alive().length + busted.length - i; });
    for (const p of busted) {
      this.say(`💀 ${p.name} e eliminat — locul ${p.place}`);
      this.push(); this.emit('fx', { type: 'bust', id: p.id, place: p.place }); await sleep(2400);
    }
    this.players.forEach(p => { if (!p.out) { p.cards = []; } });
    this.board = []; this.street = ''; this.revealed = false; this.push();
  }
}
