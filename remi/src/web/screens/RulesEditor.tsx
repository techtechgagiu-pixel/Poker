import { useState } from 'react';
import { CATEGORY_KEYS, RoomConfig, CategoryKey, defaultConfig, preset, PresetKey } from '../../engine/config';
import { useT, TKey } from '../i18n';

const PRESETS_KEY = 'remi.presets';
function loadPresets(): Record<string, RoomConfig> { try { return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}'); } catch { return {}; } }

/** Compact rule configuration. Read-only for non-hosts (shows the active rules). */
export function RulesEditor({ cfg, onChange, readOnly }: { cfg: RoomConfig; onChange: (c: RoomConfig) => void; readOnly?: boolean }) {
  const t = useT();
  const [adv, setAdv] = useState(false);
  const [presets, setPresets] = useState(loadPresets);
  const up = (f: (c: RoomConfig) => void) => { if (readOnly) return; const c = structuredClone(cfg); f(c); onChange(c); };
  const num = (v: number, set: (n: number) => void, min = 0, max = 1000, disabled = false) => (
    <input type="number" className="num-in" value={v} min={min} max={max} disabled={readOnly || disabled} onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
  );
  const chk = (v: boolean, set: (b: boolean) => void, label: TKey | string, extra?: React.ReactNode) => (
    <label className="chk"><input type="checkbox" checked={v} disabled={readOnly} onChange={(e) => set(e.target.checked)} /> {t(label as TKey) ?? label}{extra}</label>
  );
  const turnOpts = [15, 30, 45, 60, 90, 0];
  const any = CATEGORY_KEYS.some((k) => cfg.categories[k].enabled);
  return (
    <div className={`rules-editor ${readOnly ? 'ro' : ''}`}>
      {!readOnly && (
        <div className="preset-row">
          <select onChange={(e) => { const v = e.target.value; if (!v) return; if (v.startsWith('u:')) onChange(sanitizeLocal(presets[v.slice(2)])); else onChange(preset(v as PresetKey)); e.target.value = ''; }} defaultValue="">
            <option value="">{t('load_preset')}…</option>
            {(['remyPro', 'classic', 'fast', 'normalOnly'] as PresetKey[]).map((p) => <option key={p} value={p}>{t(('preset_' + p) as TKey)}</option>)}
            {Object.keys(presets).map((p) => <option key={p} value={'u:' + p}>★ {p}</option>)}
          </select>
          <button className="btn-wood" onClick={() => { const n = prompt(t('save_preset'), t('preset_custom')); if (!n) return; const p = { ...presets, [n.slice(0, 30)]: cfg }; setPresets(p); localStorage.setItem(PRESETS_KEY, JSON.stringify(p)); }}>{t('save_preset')}</button>
          <button className="btn-wood" onClick={() => onChange(defaultConfig())}>{t('reset_defaults')}</button>
        </div>
      )}
      <h3>{t('rules_section')}</h3>
      <table className="cat-table">
        <thead><tr><th /><th>{t('standard_penalty')}</th><th>{t('joker_penalty')}</th></tr></thead>
        <tbody>
          {CATEGORY_KEYS.map((k: CategoryKey) => {
            const c = cfg.categories[k];
            return (
              <tr key={k} className={c.enabled ? '' : 'off'}>
                <td>{chk(c.enabled, (b) => up((x) => { x.categories[k].enabled = b; }), 'cat_' + k)}</td>
                <td>{num(c.penalty, (n) => up((x) => { x.categories[k].penalty = n; }), 0, 1000, !c.enabled)}</td>
                <td>{num(c.jokerPenalty, (n) => up((x) => { x.categories[k].jokerPenalty = n; }), 0, 1000, !c.enabled || !cfg.closeByJokerDiscard)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!readOnly && <div className="row-btns">
        <button className="btn-wood" onClick={() => up((x) => CATEGORY_KEYS.forEach((k) => (x.categories[k].enabled = true)))}>{t('enable_all')}</button>
        <button className="btn-wood" onClick={() => up((x) => CATEGORY_KEYS.forEach((k) => (x.categories[k].enabled = false)))}>{t('disable_all')}</button>
      </div>}
      {!any && <div className="warn">{t('need_category')}</div>}
      <h3>{t('extra_rules')}</h3>
      <div className="opts">
        {chk(cfg.closeByJokerDiscard, (b) => up((x) => { x.closeByJokerDiscard = b; }), 'opt_closeByJoker')}
        {chk(cfg.pass.enabled, (b) => up((x) => { x.pass.enabled = b; }), 'opt_pass')}
        {chk(cfg.atu.enabled, (b) => up((x) => { x.atu.enabled = b; }), 'opt_atu', <span className="inline"> · {t('opt_atu_points')} {num(cfg.atu.penalty, (n) => up((x) => { x.atu.penalty = n; }), 0, 100, !cfg.atu.enabled)}</span>)}
        {chk(['doubles', 'color', 'grand', 'sequences', 'triples'].every((k) => cfg.categories[k as CategoryKey].allowJokers), (b) => up((x) => { (['doubles', 'color', 'grand', 'sequences', 'triples'] as CategoryKey[]).forEach((k) => (x.categories[k].allowJokers = b)); }), 'opt_jokersSpecial')}
        {chk(cfg.spectators, (b) => up((x) => { x.spectators = b; }), 'opt_spectators')}
        {chk(cfg.chat, (b) => up((x) => { x.chat = b; }), 'opt_chat')}
        {chk(cfg.voice, (b) => up((x) => { x.voice = b; }), 'opt_voice')}
        {chk(cfg.video, (b) => up((x) => { x.video = b; }), 'opt_video')}
        {chk(cfg.pauseVote.enabled, (b) => up((x) => { x.pauseVote.enabled = b; }), 'opt_pause')}
      </div>
      <div className="opts grid2">
        <label>{t('opt_startScore')} {num(cfg.startingScore, (n) => up((x) => { x.startingScore = n; }), 1, 10000)}</label>
        <label>{t('opt_turn')}
          <select value={turnOpts.includes(cfg.turnSeconds) ? cfg.turnSeconds : -1} disabled={readOnly} onChange={(e) => up((x) => { const v = Number(e.target.value); x.turnSeconds = v === -1 ? 40 : v; })}>
            {turnOpts.map((s) => <option key={s} value={s}>{s === 0 ? t('opt_unlimited') : `${s}s`}</option>)}
            <option value={-1}>{t('opt_custom')}</option>
          </select>
          {!turnOpts.includes(cfg.turnSeconds) && num(cfg.turnSeconds, (n) => up((x) => { x.turnSeconds = n; }), 5, 600)}
        </label>
        <label>{t('opt_bots')}
          <select value={cfg.bots.difficulty} disabled={readOnly} onChange={(e) => up((x) => { x.bots.difficulty = e.target.value as any; })}>
            <option value="easy">{t('easy')}</option><option value="medium">{t('medium')}</option><option value="hard">{t('hard')}</option>
          </select>
        </label>
        {chk(cfg.bots.fillEmpty, (b) => up((x) => { x.bots.fillEmpty = b; }), 'opt_fillBots')}
      </div>
      <button className="adv-toggle" onClick={() => setAdv(!adv)}>{adv ? '▾' : '▸'} {t('advanced')}</button>
      {adv && (
        <div className="opts grid2 adv">
          <label>{t('opt_passDuration')}
            <select value={cfg.pass.duration.kind} disabled={readOnly || !cfg.pass.enabled} onChange={(e) => up((x) => { const k = e.target.value; x.pass.duration = k === 'turns' ? { kind: 'turns', turns: 4 } : { kind: k as any }; })}>
              <option value="round">{t('opt_passRound')}</option><option value="rotation">{t('opt_passRotation')}</option><option value="turns">{t('opt_passTurns')}</option>
            </select>
            {cfg.pass.duration.kind === 'turns' && num(cfg.pass.duration.turns, (n) => up((x) => { x.pass.duration = { kind: 'turns', turns: n }; }), 1, 200)}
          </label>
          <label>{t('opt_passMax')} {num(cfg.pass.maxPerRound, (n) => up((x) => { x.pass.maxPerRound = n; }), 1, 10, !cfg.pass.enabled)}</label>
          <label>{t('opt_passDelta')} {num(cfg.pass.activatorScoreDelta, (n) => up((x) => { x.pass.activatorScoreDelta = n; }), -1000, 1000, !cfg.pass.enabled)}</label>
          {chk(cfg.pass.affectsActivator, (b) => up((x) => { x.pass.affectsActivator = b; }), 'opt_passSelf')}
          {chk(cfg.highAce, (b) => up((x) => { x.highAce = b; }), 'opt_highAce')}
          {chk(cfg.doubleJokerPair, (b) => up((x) => { x.doubleJokerPair = b; }), 'opt_jokerPair')}
          {chk(cfg.jokerMultiplier.enabled, (b) => up((x) => { x.jokerMultiplier.enabled = b; }), 'opt_jokerMult', cfg.jokerMultiplier.enabled ? <span> ×{num(cfg.jokerMultiplier.factorPerJoker, (n) => up((x) => { x.jokerMultiplier.factorPerJoker = n; }), 1, 10)}</span> : null)}
          <label>{t('opt_reconnect')} {num(cfg.reconnectGraceSeconds, (n) => up((x) => { x.reconnectGraceSeconds = n; }), 5, 600)}</label>
          {chk(cfg.botTakeover, (b) => up((x) => { x.botTakeover = b; }), 'opt_botTakeover')}
          <label>{t('opt_nextRound')} {num(cfg.nextRoundSeconds, (n) => up((x) => { x.nextRoundSeconds = n; }), 3, 120)}</label>
          <label>{t('opt_pauseMax')} {num(cfg.pauseVote.maxPauseSeconds, (n) => up((x) => { x.pauseVote.maxPauseSeconds = n; }), 30, 3600)}</label>
          <label>{t('opt_pausePer')} {num(cfg.pauseVote.maxPerPlayer, (n) => up((x) => { x.pauseVote.maxPerPlayer = n; }), 0, 20)}</label>
          <label>{t('opt_priority')}
            <select value={cfg.priority.length ? 'custom' : 'auto'} disabled={readOnly} onChange={(e) => up((x) => { x.priority = e.target.value === 'auto' ? [] : ['grand', 'color', 'doubles', 'sequences', 'triples', 'normalPlain', 'normalJoker']; })}>
              <option value="auto">{t('opt_priority_auto')}</option><option value="custom">{t('opt_custom')}</option>
            </select>
          </label>
          {cfg.priority.length > 0 && <ol className="prio">{cfg.priority.map((k, i) => (
            <li key={k}>{t(('cat_' + k) as TKey)} {!readOnly && i > 0 && <button onClick={() => up((x) => { [x.priority[i - 1], x.priority[i]] = [x.priority[i], x.priority[i - 1]]; })}>▲</button>}</li>
          ))}</ol>}
        </div>
      )}
    </div>
  );
}
function sanitizeLocal(c: RoomConfig): RoomConfig { return { ...defaultConfig(), ...c, categories: { ...defaultConfig().categories, ...c.categories } }; }
