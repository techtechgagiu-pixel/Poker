# Backup și recuperare

## Ce se salvează
- **D1** (profiluri, statistici, partide, trofee, prieteni, turnee, flag-uri, audit): backup JSON zilnic (cron 03:17 UTC) în R2 `remi-backups/d1/<env>/<timestamp>.json`, retenție 30 zile (flag `backupRetentionDays`), plus backup manual din Admin Center → Backups. Fiecare backup e înregistrat în tabela `backups`.
- **Mesele active / partidele salvate** stau în storage-ul durabil al fiecărui Durable Object (replicat de Cloudflare). Camerele nesalvate sunt șterse după 6 h de inactivitate fără conexiuni; partidele salvate după 30 de zile.
- Cloudflare D1 oferă și **Time Travel** (restaurare point-in-time, 30 zile pe planul plătit / 7 pe cel gratuit):
```bash
npx wrangler d1 time-travel restore remi-production --timestamp=<ISO>
```

## Test de restaurare efectuat (26.11.2026)
1. Export complet al bazei de producție:
```bash
npx wrangler d1 export remi-production --remote --output prod-backup.sql
```
2. Bază izolată nouă `remi-restore-test`, import:
```bash
npx wrangler d1 execute remi-restore-test --remote --file prod-backup.sql
```
Rezultat: 287 interogări executate în 3 s.
3. Comparare număr de rânduri: `achievements 32=32, feature_flags 5=5, d1_migrations 2=2`; `matches 22` vs `23`, `match_players 88/92`, `player_stats 23/24`, `user_achievements 34/35` — diferența de exact o partidă provine dintr-o partidă de test terminată *după* export (testele rulau în paralel pe producție). Restaurarea e consistentă.
4. Baza de test a fost ștearsă.

## Restaurare dintr-un backup JSON din R2
```bash
npx wrangler r2 object get remi-backups/d1/production/<id>.json --file backup.json --remote
```
Conținutul are forma `{ tables: { <tabel>: [rânduri] } }`; se importă în ordinea: `users, guests, player_stats, matches, match_players, achievements, user_achievements, friendships, blocks, saved_matches, tournaments, tournament_participants, tournament_matches, feature_flags, admin_audit, rooms_index` (de preferat într-o bază nouă, apoi schimbat `database_id` în `wrangler.jsonc`).

## Limitări
- Backup-ul cron în R2 nu a rulat încă la momentul scrierii (primul run: 27.11 03:17 UTC); exportul/restaurarea D1 de mai sus a fost testată manual.
- Sesiunile nu sunt incluse în backup (utilizatorii se reconectează cu cheia de recuperare).
- Starea Durable Object-urilor nu poate fi exportată prin backup-ul D1; partidele salvate sunt durabile în DO, dar nu sunt copiate în R2.
