// Agentii: apel LLM prin OpenRouter (max 10s) + bot euristic de rezerva.
import { rankOf, suitOf, bestScore, categoryOf, cardStr } from './cards.js';

export const TIMEOUT_MS = +process.env.DECISION_MS || 10000;
const MODELS = (process.env.OPENROUTER_MODELS ||
  'google/gemini-2.5-flash-lite,openai/gpt-4.1-nano,mistralai/mistral-small-3.2-24b-instruct,qwen/qwen3-30b-a3b-instruct-2507')
  .split(',').map(s => s.trim()).filter(Boolean);
export const modelFor = i => MODELS[i % MODELS.length];
export const llmEnabled = () => process.env.AI_MODE !== 'bots' && !!process.env.OPENROUTER_API_KEY;

const STYLE = { // loose = cat de larg apara, aggr = agresivitate, bluff = sansa de bluff
  bluffer: { loose: .12, aggr: .6, bluff: .3 }, superstitious: { loose: .08, aggr: .4, bluff: .12 },
  'loose-passive': { loose: .22, aggr: .15, bluff: .04 }, aggressive: { loose: .1, aggr: .85, bluff: .25 },
  'tight-mathematical': { loose: -.08, aggr: .45, bluff: .05 }, 'calling-station': { loose: .3, aggr: .1, bluff: .02 },
  dramatic: { loose: .08, aggr: .55, bluff: .15 }, maniac: { loose: .18, aggr: 1, bluff: .4 },
  'tight-aggressive': { loose: -.04, aggr: .7, bluff: .08 },
};
const LINES = {
  fold: ['Ies din mână.', 'Nu e ziua mea.', 'Dau pas, ce să fac.', 'Prea scump pentru mine.'],
  check: ['Pas.', 'Las-o așa.', 'Verific.', 'Mă uit și tac.'],
  call: ['Văd pariul.', 'Te plătesc.', 'Hai, mă bag.', 'Văd, să vedem.'],
  raise: ['Să urcăm miza!', 'Asta e cadou?', 'Mai pune și tu!', 'Cine are curaj?'],
  allin: ['TOT CE AM!', 'All-in, fără milă!', 'Totul pe o carte!', 'Mă duc până la capăt!'],
};
const CATCH = { baron: 'Cu onoare și blef!', zora: 'Stelele spun că da.', gus: 'Stai... ce făceam?', mary: 'Amin și ridic!',
  odds: 'Calculat: 63,7%.', lou: 'Nu te cred deloc.', chef: 'Mamma mia, ce sos!', captain: 'Tunurile pregătite!', zero: '...' };
const pick = a => a[Math.floor(Math.random() * a.length)];

function preflopStrength(h) {
  const [a, b] = h.map(rankOf).sort((x, y) => y - x);
  let s = a >= 14 ? 10 : a === 13 ? 8 : a === 12 ? 7 : a === 11 ? 6 : a / 2;
  if (a === b) s = Math.max(5, s * 2);
  if (suitOf(h[0]) === suitOf(h[1])) s += 2;
  const gap = a - b - 1;
  if (a !== b) s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && a < 12 && a !== b) s += 1;
  return Math.max(0, Math.min(1, s / 20));
}
function strength(hole, board) {
  if (board.length < 3) return preflopStrength(hole);
  const sc = bestScore([...hole, ...board]);
  const cat = categoryOf(sc);
  const top = Math.max(...hole.map(rankOf));
  const base = [0.12 + top / 100, 0.45, 0.72, 0.8, 0.88, 0.9, 0.96, 0.99, 1][cat];
  return Math.min(1, base);
}

export function botDecision(p, v, char) {
  const st = STYLE[char.style] || STYLE.bluffer;
  const s = strength(p.cards, v.board);
  const potOdds = v.toCall / (v.pot + v.toCall || 1);
  let action, amount;
  const raiseSize = f => Math.min(v.maxRaiseTo, Math.max(v.minRaiseTo, Math.round(v.currentBet + (v.pot + v.toCall) * f)));
  if (v.toCall === 0) {
    if (s + st.loose > 0.62 && Math.random() < 0.4 + st.aggr * 0.5) { action = 'raise'; amount = raiseSize(0.5 + Math.random() * 0.5); }
    else if (Math.random() < st.bluff * 0.5) { action = 'raise'; amount = raiseSize(0.5); }
    else action = 'check';
  } else {
    const need = potOdds + 0.12 - st.loose;
    if (s > 0.8 - st.aggr * 0.15 && Math.random() < 0.5 + st.aggr * 0.4) { action = 'raise'; amount = raiseSize(0.7 + Math.random() * 0.6); }
    else if (s >= need || Math.random() < st.bluff * 0.3) action = 'call';
    else action = 'fold';
    if (action === 'call' && v.toCall >= p.stack * 0.5 && s < 0.35 && st.loose < 0.25) action = 'fold';
  }
  if (action === 'raise' && (amount >= v.maxRaiseTo * 0.6 && (s > .85 || (char.style === 'maniac' && Math.random() < .5)))) { action = 'allin'; }
  const key = action === 'raise' && amount >= v.maxRaiseTo ? 'allin' : action;
  const say = Math.random() < 0.3 && (action === 'raise' || action === 'allin') ? CATCH[char.id] : pick(LINES[key] || LINES.check);
  return { action, amount, say };
}

export function describeState(p, v) {
  const others = v.players.filter(o => o.id !== p.id).map(o =>
    `${o.name}${o.out ? ' (eliminat)' : ''}: stack ${o.stack}${o.folded ? ', fold' : ''}${o.bet ? ', pariat ' + o.bet : ''}${o.allIn ? ', ALL-IN' : ''}`).join('\n');
  return `Street: ${v.street}
Cărțile tale: ${p.cards.map(cardStr).join(' ')}
Masa: ${v.board.length ? v.board.map(cardStr).join(' ') : '(nimic încă)'}
Pot: ${v.pot} | Blinduri: ${v.sb}/${v.bb} | Stack-ul tău: ${p.stack} | Pariat de tine: ${p.bet}
De plătit pentru call: ${v.toCall} | Raise minim (total): ${v.minRaiseTo} | Maxim: ${v.maxRaiseTo}
Poziție: ${v.position}
Ceilalți:\n${others}
Acțiuni recente: ${v.recent.join('; ') || '-'}`;
}

async function callLLM(p, char, model, v, signal) {
  const sys = `Ești ${char.name}, ${char.bio}. Joci Texas Hold'em No-Limit într-un turneu TV în Las Vegas, la o masă cu 9 jucători ciudați. Stil de joc: ${char.style}. Joacă smart și în caracter.
Răspunde STRICT cu un singur obiect JSON, fără text în plus:
{"action":"fold|check|call|raise|allin","amount":<numărul TOTAL la care ridici, doar la raise>,"say":"replică scurtă în română, maxim 12 cuvinte, amuzantă, în caracter"}
check se poate doar dacă "De plătit" este 0. Nu folosi fold când poți da check.`;
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY,
      'X-Title': 'AI Poker Night' },
    body: JSON.stringify({ model, temperature: 0.9, max_tokens: 160,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: describeState(p, v) }] }),
  });
  if (!r.ok) throw new Error('OpenRouter ' + r.status + ' ' + (await r.text()).slice(0, 120));
  const j = await r.json();
  const txt = j.choices?.[0]?.message?.content || '';
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('fara JSON: ' + txt.slice(0, 80));
  const o = JSON.parse(m[0]);
  return { action: String(o.action || '').toLowerCase(), amount: Math.round(+o.amount) || 0, say: String(o.say || '').slice(0, 110) };
}

// Intoarce {action, amount, say, source}. Timeout 10s => check/fold automat.
export async function decide(p, char, v) {
  if (!llmEnabled()) {
    await new Promise(r => setTimeout(r, 500 + Math.random() * 900)); // "gandeste" putin
    return { ...botDecision(p, v, char), source: 'bot' };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const d = await callLLM(p, char, p.model, v, ac.signal);
    return { ...d, source: 'ai' };
  } catch (e) {
    if (ac.signal.aborted) return { action: v.toCall === 0 ? 'check' : 'fold', amount: 0, say: 'Hopa, am rămas fără timp!', source: 'timeout' };
    console.error(`[${char.name}] LLM eroare:`, e.message);
    return { ...botDecision(p, v, char), source: 'bot' };
  } finally { clearTimeout(timer); }
}
