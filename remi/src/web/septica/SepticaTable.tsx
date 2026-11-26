import { memo, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { send, sact } from '../net';
import { PlayerAvatar } from '../components/Media';
import { ChatPanel, VoteDialog, SettingsDrawer } from '../components/Overlays';
import { AutoButton, ChatBadge, MediaButtons, PeoplePanel } from '../components/Table';
import { useClickOutside } from '../useOutside';
import { cardRank, cardSuit, isPointCard, type SepticaView } from '../../engine/septica';

const SUITS = ['♥', '♦', '♣', '♠']; const RANKS: Record<number, string> = { 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export const SCard = memo(function SCard({ id, legal, dim, onClick, small, fresh }: { id: number; legal?: boolean; dim?: boolean; onClick?: () => void; small?: boolean; fresh?: boolean }) {
  const suit = cardSuit(id); const r = RANKS[cardRank(id)];
  return (
    <button type="button" className={`scard s${suit} ${legal ? 'legal' : ''} ${dim ? 'dim' : ''} ${small ? 'small' : ''} ${fresh ? 'fresh' : ''} ${isPointCard(id) ? 'pt' : ''}`} onClick={onClick} disabled={!onClick} aria-label={`${r}${SUITS[suit]}`} data-card={id}>
      <span className="c-tl">{r}<i>{SUITS[suit]}</i></span><span className="c-mid">{SUITS[suit]}</span><span className="c-br">{r}<i>{SUITS[suit]}</i></span>
    </button>
  );
});
const Back = ({ n }: { n: number }) => <div className="sback-row">{Array.from({ length: Math.min(n, 8) }, (_, i) => <div key={i} className="scard back small" style={{ marginLeft: i ? -26 : 0 }} />)}</div>;

function Countdown({ v, serverOffset }: { v: SepticaView; serverOffset: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 250); return () => clearInterval(i); }, []);
  if (!v.turnDeadline || v.paused) return null;
  const left = Math.max(0, v.turnDeadline - (Date.now() + serverOffset));
  return <span className="sc-time">{Math.ceil(left / 1000)}s</span>;
}

export function SepticaTable() {
  const v = useStore((s) => s.sgame)!; const room = useStore((s) => s.room)!; const you = useStore((s) => s.you)!;
  const off = useStore((s) => s.net.serverOffset); const navigate = useStore((s) => s.navigate); const en = useStore((s) => s.settings.lang) === 'en';
  const L = (ro: string, e: string) => (en ? e : ro);
  const [chat, setChat] = useState(false); const [people, setPeople] = useState(false); const [menu, setMenu] = useState(false); const [settings, setSettings] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenu(false), undefined, menu);
  useEffect(() => { if (you.role === 'player' && (room.config.voice || room.config.video)) import('../media'); }, [you.role, room.config.voice, room.config.video]);
  const me = v.me; const n = v.seats.length;
  const persp = me?.seat ?? 0;
  const rel = (seat: number) => (seat - persp + n) % n;
  const spot = (seat: number) => { const k = rel(seat); if (k === 0) return 'bottom'; if (n === 2) return 'top'; if (n === 3) return k === 1 ? 'left' : 'right'; return k === 1 ? 'left' : k === 2 ? 'top' : 'right'; };
  const team = (seat: number) => (v.opts.teams ? (seat % 2 === 0 ? 'A' : 'B') : '');
  const member = (seat: number) => room.members.find((m) => m.pid === room.gameSeatPids[seat]);
  const play = (id: number) => { if (me?.myTurn && me.legal.includes(id)) sact({ type: 'play', card: id }); };
  const pass = () => { if (me?.canPass) sact({ type: 'pass', tile: 0 }); };
  const finished = v.phase === 'MATCH_FINISHED';
  const takerName = v.lastTrick ? v.seats[v.lastTrick.taker]?.name : null;
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => null); };
  const leave = () => { if (confirm(L('Părăsești masa? Un robot îți ia locul.', 'Leave the table? A bot takes your seat.'))) { send({ t: 'leaveSeat' }); navigate('/septica'); } };
  const hintCanPass = me?.myTurn && v.table.length > 0;
  return (
    <div className="sept-table">
      <header className="sept-top">
        <div className="table-menu" ref={menuRef}>
          <button className="small-btn" onClick={() => setMenu(!menu)} aria-expanded={menu}>☰ {room.code}</button>
          {menu && (
            <div className="table-menu-pop" role="menu">
              {you.role === 'player' && <button onClick={() => { send({ t: 'vote', kind: v.paused ? 'resume' : 'pause' }); setMenu(false); }}>{v.paused ? '▶ ' + L('Reia', 'Resume') : '⏸ ' + L('Cere pauză', 'Request pause')}</button>}
              {you.role === 'player' && <button onClick={() => { send({ t: 'vote', kind: 'save' }); setMenu(false); }}>💾 {L('Salvează partida', 'Save match')}</button>}
              {you.role === 'player' && <button onClick={leave}>🚪 {L('Părăsesc masa', 'Leave table')}</button>}
              {you.role !== 'player' && <button onClick={() => navigate('/septica')}>🚪 {L('Ies', 'Leave')}</button>}
            </div>
          )}
        </div>
        <span className="sept-info">{L('Talon', 'Stock')}: <b>{v.stock}</b>{v.rank !== null && <> · {L('Se taie cu', 'Beat with')}: <b>{RANKS[v.rank]}</b> / 7</>}</span>
        <div className="sept-tools">
          {you.role === 'player' && <AutoButton />}
          <MediaButtons />
          {room.config.chat && <button className="tb-btn" data-toggle="chat" onClick={() => setChat((x) => !x)} aria-label="Chat">💬<ChatBadge /></button>}
          <button className="tb-btn" data-toggle="people" onClick={() => setPeople((x) => !x)} aria-label="People">👥</button>
          <button className="tb-btn gold" onClick={toggleFs} aria-label="Fullscreen">⛶</button>
          <button className="tb-btn" data-toggle="settings" onClick={() => setSettings((x) => !x)} aria-label="Settings">⚙</button>
        </div>
      </header>

      <div className="sept-felt">
        {v.seats.map((s) => {
          const sp = spot(s.seat); if (sp === 'bottom') return null;
          const m = member(s.seat);
          return (
            <div key={s.seat} className={`sept-seat ${sp} ${v.current === s.seat && !finished ? 'current' : ''}`}>
              <div className="sept-badge">
                <PlayerAvatar pid={m?.pid ?? null} name={s.name} isBot={s.isBot} />
                <div><div className="sb-name">{s.name}{m?.isHost ? ' ♛' : ''}{team(s.seat) && <span className="sb-tag">{team(s.seat)}</span>}</div>
                  <div className="sb-score">{s.score} {L('p', 'pts')} · {s.taken} 🂠{m?.autoplay ? <span className="sb-tag auto">AUTO</span> : null}</div></div>
                {v.current === s.seat && !finished && <Countdown v={v} serverOffset={off} />}
              </div>
              <Back n={s.tiles} />
            </div>
          );
        })}

        <div className="sept-centre">
          <div className="sept-pile">
            {v.table.length === 0 && <div className="sept-empty">{finished ? '' : takerName && v.lastTrick ? L(`${takerName} a luat ${v.lastTrick.cards.length} cărți${v.lastTrick.points ? ` (${v.lastTrick.points}p)` : ''}`, `${takerName} took ${v.lastTrick.cards.length} cards${v.lastTrick.points ? ` (${v.lastTrick.points}p)` : ''}`) : L('Deschide mâna', 'Lead a card')}</div>}
            {v.table.map((t, i) => <div key={t.card} className="sept-played" style={{ transform: `translateX(${(i - (v.table.length - 1) / 2) * 46}px) rotate(${(i % 2 ? 1 : -1) * (3 + i)}deg)` }}><SCard id={t.card} fresh={i === v.table.length - 1} /><small>{v.seats[t.by]?.name}</small></div>)}
          </div>
          <div className="sept-stock" title={L('Talon', 'Stock')}>{v.stock > 0 ? <><div className="scard back" /><b>{v.stock}</b></> : null}</div>
        </div>

        {me && !finished && (
          <div className="sept-me">
            <div className={`sept-badge me ${me.myTurn ? 'current' : ''}`}>
              <PlayerAvatar pid={member(me.seat)?.pid ?? null} name={v.seats[me.seat].name} isBot={false} />
              <div><div className="sb-name">{v.seats[me.seat].name}{team(me.seat) && <span className="sb-tag">{team(me.seat)}</span>}</div><div className="sb-score">{v.seats[me.seat].score} {L('p', 'pts')} · {v.seats[me.seat].taken} 🂠</div></div>
              {me.myTurn && <Countdown v={v} serverOffset={off} />}
            </div>
            <div className="sept-hand">
              {me.hand.map((c) => <SCard key={c} id={c} legal={me.myTurn && me.legal.includes(c)} dim={me.myTurn && v.table.length > 0 && !me.legal.includes(c)} onClick={me.myTurn ? () => play(c) : undefined} />)}
            </div>
            <div className="sept-actions">
              {me.myTurn && <span className="sept-hint">{v.table.length === 0 ? L('Aruncă o carte', 'Play a card') : me.legal.length ? L('Taie sau trece', 'Beat it or pass') : L('Nu ai ce tăia — trece', 'Nothing to beat with — pass')}</span>}
              {hintCanPass && <button className="btn-wood big" disabled={!me.canPass} onClick={pass}>{L('Trec (iau pachetul celuilalt)', 'Pass')}</button>}
            </div>
          </div>
        )}
        {!me && <div className="sept-spec">👁 {L('Spectator', 'Spectating')}</div>}
        {v.paused && <div className="paused-banner">⏸ {L('Pauză', 'Paused')}</div>}
      </div>

      {room.vote && <VoteDialog />}
      {chat && <ChatPanel onClose={() => setChat(false)} />}
      {people && <PeoplePanel onClose={() => setPeople(false)} />}
      {settings && <SettingsDrawer onClose={() => setSettings(false)} />}
      {finished && <SepticaResult v={v} />}
    </div>
  );
}

function SepticaResult({ v }: { v: SepticaView }) {
  const you = useStore((s) => s.you)!; const navigate = useStore((s) => s.navigate); const en = useStore((s) => s.settings.lang) === 'en';
  const L = (ro: string, e: string) => (en ? e : ro);
  const r = v.result!;
  const order = v.seats.slice().sort((a, b) => r.points[b.seat] * 100 + r.cards[b.seat] - (r.points[a.seat] * 100 + r.cards[a.seat]));
  const iWon = !!v.me && r.winners.includes(v.me.seat);
  return (
    <div className="modal-backdrop result-in">
      <div className="modal result match">
        <div className="trophy">{r.draw ? '🤝' : '🏆'}</div>
        <h2>{r.draw ? L('Egalitate!', 'Draw!') : iWon ? L('Ai câștigat!', 'You won!') : L('Joc terminat', 'Game over')}</h2>
        {!r.draw && <h3>{L('Câștigă', 'Winner')}: <span className="gold">{r.winners.map((s) => v.seats[s].name).join(' + ')}</span></h3>}
        {r.teamPoints && <p>{L('Echipa 1+3', 'Team 1+3')}: <b>{r.teamPoints[0]}</b> · {L('Echipa 2+4', 'Team 2+4')}: <b>{r.teamPoints[1]}</b></p>}
        <table className="score-table"><thead><tr><th>#</th><th /><th>{L('Puncte', 'Points')}</th><th>{L('Cărți', 'Cards')}</th></tr></thead>
          <tbody>{order.map((s, i) => <tr key={s.seat}><td>{i + 1}</td><td>{s.name}</td><td>{r.points[s.seat]}</td><td>{r.cards[s.seat]}</td></tr>)}</tbody></table>
        <div className="modal-actions">
          {you.isHost && <button className="btn-gold big" onClick={() => send({ t: 'rematch' })}>{L('Revanșă', 'Rematch')}</button>}
          {!you.isHost && <span className="muted">{L('Așteaptă gazda', 'Waiting for the host')}</span>}
          <button className="btn-wood" onClick={() => navigate('/septica')}>{L('Ies', 'Leave')}</button>
        </div>
      </div>
    </div>
  );
}
