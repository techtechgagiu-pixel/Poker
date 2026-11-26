# Arhitectură

```
Browser (React + Zustand)  ──HTTPS──▶  Worker remi-noventra  ──▶ R2 remi-static (fișiere statice, cache edge)
        │                                   │  /api/*  ──▶ D1 remi-production (profiluri, statistici, turnee, audit)
        └──────WSS /ws/CODE?token─────────▶ │  /ws/*   ──▶ Durable Object RemiRoom (un obiect per cod de masă)
        └──WebRTC P2P (voce/video, mesh)──── semnalizare prin același WebSocket; STUN Cloudflare/Google
Cron 03:17 UTC ──▶ backup D1 → R2 remi-backups (retenție 30 zile)     Cloudflare Access ──▶ /admin, /api/admin/*, remi-dev
```

## Starea autoritară
- **Un Durable Object pe masă** (`idFromName(code)`) = un singur fir de execuție ⇒ fără curse între acțiuni, timere și boți. Toate mutările trec prin funcții pure din `src/engine/game.ts`.
- Starea (`RoomData`: membri, locuri, config, `GameState`, chat, voturi) e salvată în storage-ul DO după fiecare schimbare ⇒ supraviețuiește hibernării, redeploy-ului și restartului.
- **Mașina de stări:** `LOBBY → DEALING → WAITING_FOR_DISCARD/WAITING_FOR_DRAW → VALIDATING_CLOSE → ROUND_RESULT → (NEXT_ROUND) → MATCH_FINISHED`; PASS e stare separată la nivel de rundă; statusul camerei `LOBBY/PLAYING/SAVED/FINISHED`; jucători `ACTIVE/ELIMINATED`, conexiune și „controlat de bot” calculate din membru.
- **Timere:** o singură alarmă DO = minimul dintre termenul turei, momentul botului, următoarea rundă, expirarea pauzei/votului, preluarea după deconectare și curățarea camerei inactive. Fără polling.
- **Conservarea pieselor:** `tileLocations()` verifică că fiecare din cele 106 piese e într-un singur loc (indicator, mâini, pachet, aruncate, PASS, piese ale eliminaților) — testat property-based.
- **Snapshot imutabil al regulilor** la start (`matchConfig`); înregistrat și în D1 (`matches.config_json`).

## Rețea
- WebSocket nativ cu **Hibernation API** (DO nu e facturat cât doarme). Mesaje JSON compacte; serverul trimite fiecărui client o vedere filtrată (`buildView`) după fiecare schimbare (~2–4 KB).
- Acțiuni: `{t:'act', aid, v, a}` — `aid` unic (deduplicare), `v` = versiunea stării așteptate (respinge acțiuni vechi). Ack/err; după respingere clientul primește starea autoritară (rollback).
- Rearanjarea suportului e 100% locală; layout-ul se trimite debounced (800 ms) doar pentru restaurare la reconectare, niciodată difuzat.
- Reconectare: backoff exponențial cu jitter (0,4–10 s), reconectare imediată la `visibilitychange`/`online`; un singur socket per jucător (tab-ul vechi primește `replaced`). Ping la 5 s pentru RTT.
- Gazda care se deconectează este înlocuită de alt om conectat.

## Separarea stării în client
Store-uri separate: stare autoritară (`room`, `game`), stare vizuală locală (`useRack`, selecție, istoric), media (`useMedia`), social (fetch la cerere). Drag-ul scrie `transform` direct în DOM în `requestAnimationFrame` (zero randări React per mișcare). Ecranele secundare, media și admin sunt încărcate lazy.

## Securitate (rezumat — vezi SECURITY.md)
Server autoritar; token de sesiune per masă (doar hash SHA-256 în DO); verificare membership/rol/tură/fază/proprietate piesă/versiune; vederile nu conțin mâinile altora sau ordinea pachetului; spectatorii fără date ascunse și fără acțiuni; boții primesc exact aceeași vedere ca un om; CSP strict; rate limiting; Access + JWT verificat în Worker pentru admin.

## Date (D1)
`users, sessions, guests, player_stats(mode), matches, match_players, achievements, user_achievements, friendships, blocks, notifications, push_subscriptions, saved_matches, tournaments, tournament_participants, tournament_matches, feature_flags, admin_audit (lanț de hash-uri), rooms_index, backups, error_log`. Înregistrarea partidelor e idempotentă (`INSERT OR IGNORE` pe ID-ul partidei; statisticile se actualizează doar dacă inserția a fost nouă). Starea activă completă a unei partide salvate rămâne în storage-ul DO al mesei (protejat), iar D1 ține doar metadatele (`saved_matches`).

## Medii
Producție `remi-noventra` (D1 `remi-production`, R2 `remi-static`) și staging `remi-noventra-staging` (D1 `remi-staging`, R2 `remi-static-staging`, namespace DO separat prin worker separat), staging complet după Cloudflare Access.
