import { useStore } from '../store';

/** Top-corner switch between the card games of Gagiu's WorkArt. */
export function GameTabs({ active }: { active: 'remi' | 'septica' }) {
  const navigate = useStore((s) => s.navigate);
  return (
    <nav className="game-tabs" aria-label="Jocuri">
      <button className={active === 'remi' ? 'on' : ''} onClick={() => navigate('/')} aria-current={active === 'remi'}>🀄 Remi</button>
      <button className={active === 'septica' ? 'on' : ''} onClick={() => navigate('/septica')} aria-current={active === 'septica'}>🂡 Septică</button>
    </nav>
  );
}
