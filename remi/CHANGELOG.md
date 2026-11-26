# Changelog

## 1.4.0 — 2026-11-26
- Linkul de invitație funcționează și după start: **înlocuiești un bot** (cu piesele și punctajul lui) sau intri ca **spectator la coadă**; locul eliberat („Părăsește locul”, revanșă) trece automat la primul din coadă.
- Jokerul nu mai e afișat pe ecran (fără casetă, fără „J”; aranjarea automată îl tratează ca piesă normală) — indicii doar în antrenament.
- Ferestrele (setări, chat, sortare, meniul mesei, istoric) se închid la atingere în afara lor.

## 1.3.0 — 2026-11-26
- **AUTO**: butonul „▶ AUTO” lasă serverul să joace turele tale (bot nivel greu) până îl apeși din nou sau muți tu o piesă; ceilalți văd eticheta AUTO.
- **Rama-scut** pentru avatar/cameră în toate temele (aurie; argintie pe Albastru de noapte); rândurile de piese cu spatele ale adversarilor înlocuite de insigna cu numărul de piese.
- **Un singur sunet de fundal**: o listă comună (ambianțe sau melodii), niciodată ambele deodată. Chitara a fost scoasă.

## 1.2.0 — 2026-11-26
- **Mărire masă** (3 niveluri: Normal / Mare / Foarte mare) din Setări sau butonul 🔍 de pe bara de sus: piese mai mari (+16% / +32%), jucători, centru, teancuri, butoane și ferestre mărite; suportul trece la 11 / 9 locuri pe rând ca să încapă.
- **Melodii generative** (originale, sintetizate, fără repetare): Pian de seară, Jazz lounge, Chitară spaniolă, Ambient calm; se pot combina cu ambianța (valuri, ploaie, foc). Pornesc din glisorul „Muzică ambientală”.
- Temă implicită: **Mahon regal**.

## 1.1.0 — 2026-11-26
- **Cumul**: punctele pierdute de adversari se adună la câștigător (configurabil).
- **Colț**: la fiecare remiză/refacere fiecare pune N puncte deoparte (N configurabil, opțional); colțul îl ia cine închide cu joker aruncat, Culoare, Duble sau după PASS (bife separate, Grand opțional).
- **Solicită remiză** prin vot; acțiunile mesei (pauză, remiză, salvare) grupate în meniul „☰ Masa”.
- **Mese live**: listă publică de mese în desfășurare, intrare ca spectator.
- **Tema Arena** (implicită, artă originală): pâslă verde cu grilă, rame-scut aurite cu camera video în interior (mărite când camera e pornită), insigne cu stea, piese cu disc colorat, suport din lemn deschis cu stâlpi, animații de aruncare cu înclinare și scânteie.
- Jokerul fals afișează doar steaua.
- Ambianță: **valuri** și **ploaie**.
- Suport: piesele se **inserează** între vecini (5 7 + 6 → 5 6 7) în loc să facă schimb; zonă mare de aruncare; mesaj clar când aruncarea nu e permisă.

## 1.0.0 — 2026-11-26 (producție: https://remi.noventra.ro)
### Adăugat
- Motor de joc: 106 piese cu ID unic, Atu/joker dinamic, jokeri falși, validator exhaustiv memoizat, toate categoriile (Culoare independentă de formații), prioritate configurabilă, multiplicator joker, PASS, Arătare atu, punctaj descrescător, eliminare, pachet epuizat.
- Server autoritar pe Cloudflare Durable Objects (WebSocket cu hibernare, alarme pentru timere/boți), D1, R2, cron backup.
- Boți ușor/mediu/greu (strategii normal, duble, Grand, Culoare; PASS și Atu), întârzieri realiste, doar informații publice.
- Interfață: masă din perspectiva fiecărui jucător, suport 2/3 rânduri, drag & drop (inclusiv **din teancul din stânga și din pachet direct pe suport**, în slotul ales), sortări, undo/redo, teancuri fixe cu contor și bară de istoric, ultima mutare, ecran complet, landscape pe mobil, 5 teme, tastatură și controller.
- Social: profiluri fără parolă, prieteni, invitații, notificări, clasament privat, turnee, trofee, partide salvate.
- Pauză prin vot, salvare/reluare exactă, revanșă, antrenament cu scenarii și asistent.
- Voce/video WebRTC opțional, Admin Center cu Cloudflare Access, staging protejat, PWA.
### Reparat în timpul testării
- Badge-ul propriu acoperea suportul (piesele nu se puteau apăsa).
- Avatarele boților se măreau pe mobil (`null === null`).
- Bara de istoric acoperea teancurile de sus.
- Planificatorul round-robin putea omite jucători.
- Piesa „sărea înapoi” la slotul vechi după drop; selecția sărea fără tranziție; textura pâslei forța recompoziție la fiecare cadru; setările FPS și „Auto” nu aveau efect.
- Butonul PASS vizibil (dezactivat) fără ambii jokeri → acum apare doar cu ambii jokeri reali.
- Voce/video: ofertele SDP > 8 KB erau respinse de server; semnalizarea era ignorată până la pornirea propriului microfon (blocaj); mesajele erau procesate în paralel (ordine greșită); pornirea rapidă mic+cameră oprea microfonul; renegocierea video ratată.
- CSP bloca beacon-ul Cloudflare Analytics; zoom blocat în viewport (accesibilitate).
