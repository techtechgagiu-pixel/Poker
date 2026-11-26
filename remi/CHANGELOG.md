# Changelog

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
