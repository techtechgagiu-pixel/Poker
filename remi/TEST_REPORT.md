# Raport de teste — 26.11.2026

Toate suitele e2e au rulat **pe producție** (https://remi.noventra.ro), cu browsere independente (Playwright/Chromium). Rezultate brute în `e2e/out/prod/`.

| Suită | Rezultat | Ce acoperă |
|---|---|---|
| Unit + property (`npm test`, Vitest + fast-check) | **52/52** | 106 piese unice, distribuție, Atu, joker (13→1), jokeri falși, suite (12-13-1 configurabil, 13-1-2 respins), seturi fără culori duplicate, careuri, 7 perechi, perechi/suite/Grand cu joker, partiții ambigue (non-greedy), normal ±joker, doar suite, duble, Culoare (neordonat, duplicate, jokeri, culori amestecate, piesa aruncată de altă culoare), Grand vs Doar terțe, prioritate, scoruri custom, închidere cu joker (și dezactivată), PASS (activare, joker fals respins, blocarea piesei din stânga, expirare, resetare), conservarea pieselor (property), pachet epuizat, eliminare, partide cu 3/2 jucători, câștigător final, pauză/timer, Arătare atu, confidențialitatea vederilor, meci complet doar cu boți, scenarii de antrenament, verificare JWT admin (falsificat/expirat/audiență/emitent/email), planificare turnee (3–12 jucători), sanitizare config |
| `e2e/multiplayer.cjs` | **20/20** | HTTPS, headere, cameră cu 4 browsere prin cod, gata/start, perspectivă (fiecare jos), 15/14 piese, ture reale prin UI, **drag & drop din teancul din stânga în slotul ales**, istoric, 247+ cadre WS fără mâini străine, spectator fără date ascunse, reîncărcare = aceeași mână, tab duplicat, mobil landscape fără scroll, portret = suprapunere + sesiune păstrată, boți, tastatură, fără erori JS |
| `e2e/mechanics.cjs` | **20/20** | PASS (buton doar cu 2 jokeri, activare, joker blocat, al doilea păstrat, IA PIESA blocat), Atu (−1 adversari, fără consum de tură, o singură dată), închideri Culoare/Grand/Duble/Suite/Normal cu scorurile corecte, închidere cu joker aruncat, categorie dezactivată nerevendicabilă, meci complet cu eliminări, timeout de server, statistici D1, trofeu |
| `e2e/room-features.cjs` | **12/12** | sincronizare reguli în timp real, reguli doar pentru gazdă, blocare la start, pauză prin vot (timer înghețat), fără acțiuni în pauză, reluare cu timpul rămas, salvare unanimă, restaurare identică după închiderea browserelor, continuare, meci terminat, REVANȘĂ în aceeași cameră, meci nou resetat |
| `e2e/social.cjs` | **17/17** | înregistrare/cheie de recuperare, username duplicat, login, API protejat, căutare, cereri de prietenie (duplicat respins), notificări, acceptare + prezență, invitație deduplicată, fără invitații către non-prieteni, blocare, clasament privat, turneu (creare, cod, start doar organizator, program), acces interzis non-participanților, cameră de turneu doar pentru participanți, export, ștergere cont |
| `e2e/media.cjs` | **8/9 tipic** | voce/video oprite implicit, conectare WebRTC + video primit, video în avatar, sincronizare stare mic/cameră, mute individual, oprirea pistelor la ieșire, refuz de permisiune fără blocarea jocului, **controller (Gamepad API simulat)**: D-pad, A, Y |
| `e2e/perf.cjs`, `e2e/soak.cjs`, Lighthouse | vezi PERFORMANCE_REPORT.md | 60 min, 2 mese, 0 erori |
| Backup/restore D1 | ✅ | export producție → bază izolată → comparație rânduri (BACKUP_AND_RECOVERY.md) |
| Cloudflare Access | ✅ | `/admin`, `/api/admin/*`, `remi-dev` → redirect la login Access; JWT falsificat respins |

## Instabil / neverificat (raportat onest)
- **Video WebRTC**: în ultimele 8 rulări s-a conectat de 7 ori; o dată renegocierea video nu s-a finalizat în cele 30 s ale testului (am adăugat recuperare automată a renegocierii).
- **Detecția vorbitorului**: neverificabilă în headless — pachetele audio sosesc, dar Chromium fără dispozitiv de ieșire raportează energie 0. Captura locală funcționează (nivel 1,0).
- Fără TURN: voce/video pot eșua în spatele unor NAT/firewall-uri restrictive.
- Neverificat pe hardware real: Safari/iPhone, Firefox, Edge, Android, PWA instalată, ecrane 120 Hz, controllere fizice.
- Rezultatele finale ale turneului (puncte, câștigător, trofeu) sunt acoperite de cod și de testele de planificare, dar un turneu întreg jucat până la capăt nu a fost rulat automat.
