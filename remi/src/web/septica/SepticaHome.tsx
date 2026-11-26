import { useState } from 'react';
import { useStore } from '../store';
import { errText } from '../i18n';
import { api, roomTokens, ApiError } from '../api';
import { defaultConfig } from '../../engine/config';
import { GameTabs } from './GameTabs';

export function SepticaHome() {
  const s = useStore((x) => x.settings); const setS = useStore((x) => x.setSettings); const navigate = useStore((x) => x.navigate); const toast = useStore((x) => x.toast);
  const profile = useStore((x) => x.profile);
  const en = s.lang === 'en';
  const L = (ro: string, e: string) => (en ? e : ro);
  const [players, setPlayers] = useState<2 | 3 | 4>(4);
  const [teams, setTeams] = useState(false);
  const [secs, setSecs] = useState(20);
  const [level, setLevel] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const name = s.nickname || profile?.nickname || '';
  const create = async (mode: 'human' | 'bots') => {
    if (!name.trim()) { toast(L('Scrie un nume', 'Enter a nickname'), 'error'); return; }
    setBusy(true);
    try {
      const config = { ...defaultConfig(), turnSeconds: secs };
      config.bots = { fillEmpty: true, difficulty: level };
      const r = await api('/api/rooms', { body: { name, config, mode, kind: 'septica', septica: { players, teams: players === 4 && teams, voluntaryPass: true } } });
      roomTokens.set(r.code, { token: r.token, pid: r.pid });
      if (mode === 'bots') sessionStorage.setItem('remi.autostart', r.code);
      navigate('/room/' + r.code);
    } catch (e) { toast(errText(e instanceof ApiError ? e.code : 'error', s.lang), 'error'); } finally { setBusy(false); }
  };
  const join = (e: React.FormEvent) => { e.preventDefault(); const c = code.trim().toUpperCase(); if (/^[A-Z0-9]{6}$/.test(c)) navigate('/join/' + c); else toast(errText('room_not_found', s.lang), 'error'); };
  return (
    <div className="home septica-home">
      <div className="home-bg" />
      <header className="home-head">
        <GameTabs active="septica" />
        <div className="logo">Gagiu's <i>WorkArt</i></div>
        <div className="home-head-right"><button className="chip" onClick={() => navigate('/')}>← {L('Meniu', 'Menu')}</button></div>
      </header>
      <main className="home-main">
        <h1>Septică</h1>
        <p className="sub">{L('Jocul de cărți românesc — 2, 3 sau 4 jucători, cu cameră și voce', 'The Romanian card game — 2, 3 or 4 players, with camera and voice')}</p>
        <div className="name-row">
          <label htmlFor="nick">{L('Poreclă', 'Nickname')}</label>
          <input id="nick" value={name} maxLength={20} onChange={(e) => setS({ nickname: e.target.value })} />
        </div>
        <div className="card sept-create">
          <label>{L('Jucători', 'Players')}
            <select value={players} onChange={(e) => setPlayers(Number(e.target.value) as 2 | 3 | 4)}><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>
          {players === 4 && <label className="chk"><input type="checkbox" checked={teams} onChange={(e) => setTeams(e.target.checked)} /> {L('Pe echipe 2 contra 2', '2 vs 2 teams')}</label>}
          <label>{L('Secunde pe mutare', 'Seconds per move')}<input type="number" min={0} max={120} value={secs} onChange={(e) => setSecs(Math.max(0, Math.min(120, Number(e.target.value) || 0)))} /></label>
          <label>{L('Roboți', 'Bots')}
            <select value={level} onChange={(e) => setLevel(e.target.value as any)}><option value="easy">{L('Ușor', 'Easy')}</option><option value="medium">{L('Mediu', 'Medium')}</option><option value="hard">{L('Greu', 'Hard')}</option></select></label>
        </div>
        <div className="main-actions">
          <button className="btn-green big" disabled={busy} onClick={() => create('bots')}>▶ {L('Joacă cu roboți', 'Play vs bots')}</button>
          <button className="btn-gold big" disabled={busy} onClick={() => create('human')}>＋ {L('Creează masă / invitație', 'Create table / invite')}</button>
          <form className="join-form" onSubmit={join}>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder={L('Cod invitație', 'Invite code')} autoCapitalize="characters" />
            <button className="btn-wood">{L('Intră', 'Join')} →</button>
          </form>
        </div>
        <nav className="menu-grid">
          <button className="menu-tile" onClick={() => navigate('/septica/rules')}><span className="mi">📜</span>{L('Regulile Septicii', 'Septică rules')}</button>
          <button className="menu-tile" onClick={() => navigate('/live')}><span className="mi">📺</span>{L('Mese live', 'Live tables')}</button>
          <button className="menu-tile" onClick={() => navigate('/settings')}><span className="mi">⚙</span>{L('Setări', 'Settings')}</button>
        </nav>
      </main>
    </div>
  );
}

export function SepticaRules() {
  const navigate = useStore((x) => x.navigate); const en = useStore((x) => x.settings.lang) === 'en';
  const L = (ro: string, e: string) => (en ? e : ro);
  return (
    <div className="page">
      <header className="page-head"><button className="btn-wood" onClick={() => navigate('/septica')}>← {L('Înapoi', 'Back')}</button><h1>{L('Regulile Septicii', 'Septică rules')}</h1></header>
      <div className="card rules-text">
        <h3>{L('Pachetul', 'The deck')}</h3>
        <p>{L('32 de cărți: 7, 8, 9, 10, J, Q, K, A în patru culori. Fiecare jucător primește 4 cărți; restul rămâne în talon.', '32 cards: 7, 8, 9, 10, J, Q, K, A in four suits. Everyone gets 4 cards; the rest is the stock.')}</p>
        <h3>{L('Cum se joacă o mână', 'How a trick works')}</h3>
        <ul>
          <li>{L('Primul jucător aruncă orice carte. Valoarea ei este valoarea pe care trebuie s-o „taie” ceilalți.', 'The leader plays any card. Its rank is the rank the others must beat.')}</li>
          <li>{L('Următorul jucător poate răspunde cu o carte de aceeași valoare sau cu orice 7 (șeptarul taie orice). Dacă nu vrea sau nu poate, spune „Trec”.', 'The next player may answer with a card of the same rank or with any 7 (a 7 beats anything). If they cannot or do not want to, they pass.')}</li>
          <li>{L('Cine răspunde dă rândul mai departe, iar următorul poate răspunde la rândul lui cu aceeași valoare sau cu un 7.', 'Whoever answers passes the turn on; the next player may again answer with the same rank or a 7.')}</li>
          <li>{L('Prima dată când cineva trece, mâna se termină: ultimul jucător care a pus o carte ia toate cărțile de pe masă și deschide mâna următoare.', 'The first time somebody passes, the trick ends: the last player who put a card down takes all cards on the table and leads next.')}</li>
          <li>{L('După fiecare mână toți trag din talon până la 4 cărți (începe cel care a luat). Când talonul s-a golit, se joacă cu cărțile rămase.', 'After each trick everyone draws back up to 4 cards (the taker first). When the stock is empty, play on with what is left.')}</li>
        </ul>
        <h3>{L('Punctaj', 'Scoring')}</h3>
        <p>{L('Zecile (10) și așii (A) valorează câte 1 punct — 8 puncte în total. La final câștigă cine are cele mai multe puncte; la egalitate decide numărul de cărți luate. La 4 jucători se poate juca pe echipe (locurile 1+3 contra 2+4), punctele partenerilor se adună.', 'Tens and aces are worth 1 point each — 8 points in total. At the end the highest score wins; ties are broken by cards taken. With 4 players you may play in teams (seats 1+3 vs 2+4); partners’ points add up.')}</p>
        <h3>{L('Cameră și voce', 'Camera and voice')}</h3>
        <p>{L('La fel ca la Remi: microfon și cameră pentru toți jucătorii de la masă; spectatorii pot privi și intră la rând pentru un loc.', 'Same as Remi: microphone and camera for every player at the table; spectators can watch and queue for a seat.')}</p>
      </div>
    </div>
  );
}
