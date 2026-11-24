// Pachet + amestecare cu RNG criptografic + evaluator de maini (best 5 din 7).
import { randomInt } from 'node:crypto';

export const RANKS = '23456789TJQKA';
export const SUITS = ['s', 'h', 'd', 'c'];
export const rankOf = c => (c % 13) + 2;
export const suitOf = c => Math.floor(c / 13);
export const cardStr = c => RANKS[c % 13] + SUITS[suitOf(c)];

export function shuffledDeck() {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {          // Fisher-Yates, crypto.randomInt = fara bias
    const j = randomInt(0, i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export const HAND_NAMES = ['Carte mare', 'Pereche', 'Două perechi', 'Trei de un fel', 'Chintă',
  'Culoare', 'Full House', 'Careu', 'Chintă de culoare'];

function eval5(cs) {
  const r = cs.map(rankOf).sort((a, b) => b - a);
  const flush = cs.every(c => suitOf(c) === suitOf(cs[0]));
  const cnt = {};
  r.forEach(x => (cnt[x] = (cnt[x] || 0) + 1));
  const groups = Object.entries(cnt).map(([k, v]) => [v, +k]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let straightHigh = 0;
  const u = [...new Set(r)];
  if (u.length === 5) {
    if (u[0] - u[4] === 4) straightHigh = u[0];
    else if (u.join() === '14,5,4,3,2') straightHigh = 5;
  }
  let cat;
  if (straightHigh && flush) cat = 8;
  else if (groups[0][0] === 4) cat = 7;
  else if (groups[0][0] === 3 && groups[1][0] === 2) cat = 6;
  else if (flush) cat = 5;
  else if (straightHigh) cat = 4;
  else if (groups[0][0] === 3) cat = 3;
  else if (groups[0][0] === 2 && groups[1][0] === 2) cat = 2;
  else if (groups[0][0] === 2) cat = 1;
  else cat = 0;
  const order = straightHigh ? [straightHigh] : groups.map(g => g[1]);
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (order[i] || 0);
  return s;
}

export function bestScore(cards) {
  let best = -1;
  const n = cards.length;
  if (n < 5) {
    // pre-flop / incomplet: scor aproximativ doar pe ranguri
    return -1;
  }
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++)
    for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) {
      const s = eval5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
      if (s > best) best = s;
    }
  return best;
}
export const categoryOf = score => Math.floor(score / 15 ** 5);
export const handName = score => HAND_NAMES[categoryOf(score)];
