import { useStore } from '../store';
import { useT } from '../i18n';
import { SettingsForm } from '../components/Overlays';
import { Tile } from '../components/Tile';
import { defaultConfig, CATEGORY_KEYS } from '../../engine/config';

export function SettingsPage() {
  const t = useT(); const navigate = useStore((s) => s.navigate);
  return <div className="page"><header className="page-head"><button className="btn-wood" onClick={() => navigate('/')}>← {t('back')}</button><h1>{t('menu_settings')}</h1></header>
    <div className="card"><ThemePreview /></div><div className="card"><SettingsForm /></div></div>;
}

/** Live theme previews: each card renders the real felt/wood layers of a theme. */
function ThemePreview() {
  const t = useT(); const s = useStore((x) => x.settings); const setS = useStore((x) => x.setSettings);
  const themes = ['walnut', 'mahogany', 'black', 'oak', 'midnight'] as const;
  return (
    <div><h3>{t('themes')}</h3>
      <div className="theme-grid">{themes.map((th) => (
        <button key={th} className={`theme-card theme-${th} ${s.theme === th ? 'active' : ''}`} onClick={() => setS({ theme: th })}>
          <div className="tp-wood"><div className="tp-felt"><Tile id={6} w={26} h={36} /><Tile id={33} w={26} h={36} /><Tile id={104} w={26} h={36} /></div></div>
          <span>{t(('theme_' + th) as any)}</span>
        </button>
      ))}</div>
    </div>
  );
}

export function Info({ page }: { page: 'rules' | 'howto' | 'install' }) {
  const t = useT(); const navigate = useStore((s) => s.navigate); const lang = useStore((s) => s.settings.lang);
  const d = defaultConfig();
  return (
    <div className="page info">
      <header className="page-head"><button className="btn-wood" onClick={() => navigate('/')}>← {t('back')}</button><h1>{page === 'rules' ? t('menu_rules') : page === 'howto' ? t('menu_howto') : t('install_title')}</h1></header>
      {page === 'rules' && (
        <div className="card prose">
          <h2>Piesele</h2>
          <p>106 piese: numere 1–13 în patru culori (roșu ●, albastru ■, galben ▲, negru ◆), câte două exemplare din fiecare, plus 2 jokeri falși (✦).</p>
          <h2>Atu și jokerul</h2>
          <p>La începutul fiecărei runde se întoarce o piesă numerotată — <b>Atu</b> (indicatorul). Jokerul real este <b>numărul următor de aceeași culoare</b> (13 → 1). Ambele exemplare devin jokeri reali și pot înlocui orice piesă lipsă. Jokerii falși ✦ <b>nu</b> sunt jokeri: valorează exact piesa-joker (culoarea și numărul jokerului).</p>
          <div className="row-tiles"><Tile id={6} w={40} h={56} /> → <Tile id={7} joker={{ color: 0, num: 8 }} w={40} h={56} /> <Tile id={104} joker={{ color: 0, num: 8 }} w={40} h={56} /></div>
          <h2>Desfășurare</h2>
          <p>Fiecare jucător primește 14 piese, cel care începe 15. Joci <b>doar pe suportul tău</b> — nu se pun formații pe masă. La tura ta: tragi din pachet sau iei ultima piesă aruncată de jucătorul din stânga, îți aranjezi piesele, apoi arunci o piesă spre dreapta sau închizi.</p>
          <h2>Formații</h2>
          <ul><li><b>Suită</b>: minim 3 numere consecutive de aceeași culoare (12-13-1 permis implicit, 13-1-2 niciodată).</li>
            <li><b>Terță / careu</b>: 3 sau 4 piese cu același număr în culori diferite.</li>
            <li><b>Pereche</b>: două piese identice (pentru Duble: exact 7 perechi).</li></ul>
          <h2>Închideri și punctaj implicit</h2>
          <table className="score-table"><thead><tr><th /><th>{t('standard_penalty')}</th><th>{t('joker_penalty')}</th></tr></thead>
            <tbody>{CATEGORY_KEYS.map((k) => <tr key={k}><td>{t(('cat_' + k) as any)}</td><td>{d.categories[k].penalty}</td><td>{d.categories[k].jokerPenalty}</td></tr>)}</tbody></table>
          <p><b>Culoare</b>: toate cele 14 piese rămase au aceeași culoare efectivă, în orice ordine, fără formații. Piesa aruncată poate avea orice culoare. <b>Grand</b> și <b>Doar terțe</b> se suprapun (doar terțe/careuri); implicit se acordă Grand (penalizarea cea mai mare). Dacă mâna se potrivește mai multor categorii, se alege cea cu penalizarea cea mai mare (sau ordinea stabilită de gazdă).</p>
          <h2>Punctaj descrescător</h2>
          <p>Toți încep cu {d.startingScore} puncte. Câștigătorul rundei nu pierde nimic; ceilalți pierd penalizarea categoriei. La 0 puncte ești eliminat (poți privi ca spectator). Partida continuă până rămâne un singur jucător.</p>
          <h2>PASS</h2>
          <p>Dacă ai <b>ambii jokeri reali</b>, la aruncare poți pune unul dintre ei în zona PASS. Din acel moment nimeni nu mai poate lua piese aruncate — toți trag doar din pachet (implicit până la sfârșitul rundei). Jokerul pus la PASS nu mai poate fi folosit. Jokerii falși nu contează pentru PASS.</p>
          <h2>Arătare atu (Indicator)</h2>
          <p>Cine are a doua piesă identică cu Atu o poate arăta înainte de prima sa mutare: fiecare adversar activ pierde {d.atu.penalty} punct (configurabil). Piesa rămâne pe suport și tura nu se consumă. O singură declarație pe rundă.</p>
          <h2>Pachet terminat</h2>
          <p>Dacă pachetul se termină fără închidere, runda e egală: nimeni nu pierde puncte, se împarte din nou. Piesele aruncate nu se reamestecă.</p>
          <p className="muted">{lang === 'en' ? 'Full rules: RULES.md in the repository.' : 'Regulile complete și opțiunile configurabile sunt documentate în RULES.md.'}</p>
        </div>
      )}
      {page === 'howto' && (
        <div className="card prose">
          <ol>
            <li>Scrie-ți numele pe pagina principală (fără cont).</li>
            <li><b>Creează masă</b> → alege regulile și punctajele → primești un cod de 6 caractere și un link (ex. <code>remi.noventra.ro/join/AB1234</code>).</li>
            <li>Trimite linkul prietenilor. Ei intră, apasă <b>Sunt gata</b>, iar tu pornești partida. Locurile libere se pot completa cu boți.</li>
            <li>Pe masă suportul tău e mereu jos. <b>Trage piesele</b> cu degetul sau mouse-ul ca să le aranjezi (nu consumă tura). Butonul <b>SORTEAZĂ</b> are aranjări automate.</li>
            <li>La tura ta: <b>TRAGE</b> (pachet) sau <b>IA PIESA</b> (de la stânga), apoi selectează o piesă și <b>ARUNCĂ</b> — sau trage piesa pe teancul tău din dreapta-jos.</li>
            <li>Butonul <b>ÎNCHIDE</b> se aprinde când ai o mână câștigătoare; selectează piesa a 15-a și apasă-l.</li>
            <li>Apasă pe orice teanc de piese aruncate pentru a vedea istoricul.</li>
          </ol>
          <h3>Tastatură / controller</h3>
          <p>Săgeți / D-pad: navigare · Enter / A: selectează-mută · Esc / B: anulare · D / X: aruncă · S / Y: sortare · Q / LB: ia piesa din stânga · W / RB: trage din pachet · C / RT: închide · O / Start: setări. Controllerele depind de suportul Gamepad API al browserului.</p>
        </div>
      )}
      {page === 'install' && (
        <div className="card prose">
          <h3>Android (Chrome)</h3><p>Meniu ⋮ → <b>Instalează aplicația</b> / <b>Adaugă pe ecranul de pornire</b>.</p>
          <h3>iPhone / iPad (Safari)</h3><p>Butonul Partajare ⬆ → <b>Adaugă pe ecranul principal</b>. Deschide „Remi” din iconiță pentru ecran complet.</p>
          <h3>Desktop (Chrome / Edge)</h3><p>Iconița ⊕ din bara de adrese → <b>Instalează</b>.</p>
          <p className="muted">Aplicația instalată folosește aceleași mese online; multiplayerul nu funcționează offline.</p>
          <InstallButton />
        </div>
      )}
    </div>
  );
}

let deferred: any = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
function InstallButton() {
  const t = useT();
  if (!deferred) return null;
  return <button className="btn-gold" onClick={() => { deferred.prompt(); deferred = null; }}>{t('menu_install')}</button>;
}
