import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useT, errText, TKey } from '../i18n';
import { api, roomTokens, ApiError } from '../api';
import { RoomConfig, defaultConfig, anyCategoryEnabled } from '../../engine/config';
import { RulesEditor } from './RulesEditor';
import { SCENARIOS } from '../../engine/scenarios';

export function CreateRoom({ mode }: { mode: 'human' | 'bots' | 'training' }) {
  const t = useT();
  const s = useStore((x) => x.settings); const navigate = useStore((x) => x.navigate); const toast = useStore((x) => x.toast); const profile = useStore((x) => x.profile);
  const [cfg, setCfg] = useState<RoomConfig>(() => { try { const c = JSON.parse(localStorage.getItem('remi.lastConfig') ?? 'null'); return c ? { ...defaultConfig(), ...c } : defaultConfig(); } catch { return defaultConfig(); } });
  const [scenario, setScenario] = useState<string>('');
  const [announce, setAnnounce] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (mode === 'training') setCfg((c) => ({ ...c, turnSeconds: 0 })); }, [mode]);
  const name = s.nickname || profile?.nickname || '';
  const create = async (quick = false) => {
    if (!name.trim()) { toast(t('nickname') + '?', 'error'); navigate('/'); return; }
    if (!anyCategoryEnabled(cfg)) { toast(t('need_category'), 'error'); return; }
    setBusy(true);
    try {
      localStorage.setItem('remi.lastConfig', JSON.stringify(cfg));
      const r = await api('/api/rooms', { body: { name, config: cfg, mode, scenario: scenario || null, announce } });
      roomTokens.set(r.code, { token: r.token, pid: r.pid });
      if (quick || mode !== 'human') sessionStorage.setItem('remi.autostart', r.code);
      navigate('/room/' + r.code);
    } catch (e) { toast(errText(e instanceof ApiError ? e.code : 'error', s.lang), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="page">
      <header className="page-head"><button className="btn-wood" onClick={() => navigate('/')}>← {t('back')}</button><h1>{mode === 'training' ? t('training_title') : mode === 'bots' ? t('menu_bots') : t('create_title')}</h1></header>
      {mode === 'training' && (
        <div className="card">
          <p>{t('training_desc')}</p>
          <label>{t('scenario')} <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            <option value="">— liber —</option>
            {SCENARIOS.map((x) => <option key={x} value={x}>{x === 'pass' ? 'PASS' : x === 'atu' ? 'Arătare atu' : x === 'closeJoker' ? t('opt_closeByJoker') : t(('cat_' + x) as TKey)}</option>)}
          </select></label>
        </div>
      )}
      <div className="card"><RulesEditor cfg={cfg} onChange={setCfg} /></div>
      {mode === 'human' && profile && <label className="chk card"><input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> {t('opt_announce')}</label>}
      <div className="sticky-actions">
        <button className="btn-gold big" disabled={busy || !anyCategoryEnabled(cfg)} onClick={() => create()}>{mode === 'human' ? t('create_btn') : t('play')}</button>
      </div>
    </div>
  );
}
