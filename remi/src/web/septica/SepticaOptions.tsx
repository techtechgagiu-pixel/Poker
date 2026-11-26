import { useStore } from '../store';
import { send } from '../net';
import type { RoomView } from '../../shared/protocol';
import { defaultSepticaOpts, type SepticaOpts } from '../../engine/septica';

const L = (ro: string, en: string) => (useStore.getState().settings.lang === 'en' ? en : ro);

/** Host-editable Septică rules (players, teams, voluntary pass, turn timer, bots, spectators, voice, video). */
export function SepticaOptions({ room, host }: { room: RoomView; host: boolean }) {
  const o: SepticaOpts = room.septica ?? defaultSepticaOpts();
  const cfg = room.config;
  const push = (p: Partial<SepticaOpts>, c: Partial<typeof cfg> = {}) => send({ t: 'config', config: { ...cfg, ...c, bots: { ...cfg.bots, ...(c as any).bots } } as any, septica: { ...o, ...p } });
  const dis = !host;
  return (
    <div className="sept-options">
      <label>{L('Număr de jucători', 'Players')}
        <select disabled={dis} value={o.players} onChange={(e) => push({ players: Number(e.target.value) as 2 | 3 | 4, teams: Number(e.target.value) === 4 ? o.teams : false })}>
          <option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
        </select></label>
      {o.players === 4 && <label className="chk"><input type="checkbox" disabled={dis} checked={o.teams} onChange={(e) => push({ teams: e.target.checked })} /> {L('Pe echipe (locurile 1+3 contra 2+4)', 'Teams (seats 1+3 vs 2+4)')}</label>}
      <label className="chk"><input type="checkbox" disabled={dis} checked={o.voluntaryPass} onChange={(e) => push({ voluntaryPass: e.target.checked })} /> {L('Se poate renunța la răspuns chiar dacă ai carte bună', 'Allow passing even when holding a valid answer')}</label>
      <label>{L('Timp pe mutare (secunde, 0 = nelimitat)', 'Seconds per move (0 = unlimited)')}
        <input type="number" min={0} max={120} disabled={dis} value={cfg.turnSeconds} onChange={(e) => push({}, { turnSeconds: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })} /></label>
      <label className="chk"><input type="checkbox" disabled={dis} checked={cfg.bots.fillEmpty} onChange={(e) => push({}, { bots: { ...cfg.bots, fillEmpty: e.target.checked } } as any)} /> {L('Completează locurile libere cu roboți', 'Fill empty seats with bots')}</label>
      <label className="chk"><input type="checkbox" disabled={dis} checked={cfg.spectators} onChange={(e) => push({}, { spectators: e.target.checked })} /> {L('Permite spectatori', 'Allow spectators')}</label>
      <label className="chk"><input type="checkbox" disabled={dis} checked={cfg.voice} onChange={(e) => push({}, { voice: e.target.checked })} /> {L('Voce', 'Voice')}</label>
      <label className="chk"><input type="checkbox" disabled={dis} checked={cfg.video} onChange={(e) => push({}, { video: e.target.checked })} /> {L('Video', 'Video')}</label>
      <p className="muted">{L('Regulile sunt fixate la începutul partidei.', 'Rules are locked once the game starts.')}</p>
    </div>
  );
}
