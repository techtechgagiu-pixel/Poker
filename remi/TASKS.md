# Implementare — checklist cu criterii verificabile

Legendă: ✅ făcut și verificat automat (vezi TEST_REPORT.md) · 🟡 făcut, verificat parțial · ⛔ nefăcut / blocat

## Fazele 1–7 (cerința inițială)
- ✅ Motor de joc, piese, jokeri, validator, scoruri (52 teste unitare + property-based)
- ✅ Configurare masă, PASS, Atu, eliminare, ciclul partidei
- ✅ Server autoritar multiplayer (Durable Objects în loc de Fastify/Socket.IO — vezi README), persistență D1
- ✅ Boți (3 niveluri) + teste de integrare (meci complet doar boți; meci complet în producție)
- ✅ Masa, suportul, interacțiuni, mobil landscape, controller (Gamepad simulat + tastatură)
- ✅ Reconectare, spectatori, chat, statistici, sunet (sintetizat, original)
- 🟡 Deploy: Cloudflare (în loc de Docker Compose/Nginx — documentat); fără Docker Compose

## Extindere platformă
- ✅ Pauză prin vot, revanșă, teme, 2/3 rânduri, ultima mutare
- ✅ Admin Center + Cloudflare Access + verificare JWT server, staging protejat, feature flags, mentenanță, audit cu lanț de hash
- ✅ Backup zilnic D1→R2 (cron) · ✅ restaurare testată (export/import într-o bază izolată) · 🟡 primul backup cron rulează 27.11 03:17 UTC
- ✅ Profiluri, prieteni, invitații directe, notificări in-app, clasament privat, partide salvate
- ⛔ Web Push (notificări cu aplicația închisă) — necesită chei VAPID și criptare payload; neimplementat
- ✅ Antrenament, scenarii, asistent (blocat de server în mesele competitive), trofee, vitrină
- 🟡 Voce/video WebRTC: conectare, video, mute, permisiuni, curățare testate cu dispozitive simulate; detecția vorbitorului neverificabilă în headless; ⛔ TURN neactivat (cost, necesită aprobare)
- ✅ Turnee private (ligă, fiecare-cu-fiecare, eliminatoriu, grupe), ✅ PWA, ✅ ambianță audio
- 🟡 Monitorizare: log-uri structurate, error_log, metrici live în Admin; fără alertare externă
- 🟡 Rate limiting în Worker (best-effort); ⛔ WAF/Turnstile neactivate

## Performanță
- ✅ Lighthouse 100/100 (mobil și desktop), LCP 1,4 s mobil / 0,3 s desktop, CLS 0
- ✅ 60 FPS fără cadre pierdute la drag/sortare/istoric/ecran complet (headless, 60 Hz)
- ⛔ 120 FPS nemăsurat (necesită ecran 120 Hz real; codul folosește rAF nativ fără limitare)
- ✅ Sesiune lungă: soak 60 min, 2 mese concurente, heap constant
