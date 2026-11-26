# Remi — Gagiu's WorkArt

Remi pe tablă (Okey cu reguli românești de tip Remy) multiplayer în browser. **Producție:** https://remi.noventra.ro · **Staging (protejat prin Cloudflare Access):** https://remi-dev.noventra.ro

- Mese private cu cod de 6 caractere și link `https://remi.noventra.ro/join/AB1234`, fără cont obligatoriu.
- 1–4 oameni, locurile goale se pot completa cu boți (ușor / mediu / greu), spectatori.
- Server autoritar (Cloudflare Durable Object pe masă): validare, amestecare securizată, timere, boți.
- Toate categoriile de închidere, PASS, Arătare atu, punctaj descrescător, eliminare, reguli 100% configurabile de gazdă.
- Suport personal pe 2 sau 3 rânduri, drag & drop, sortări, undo/redo, tastatură și controller (Gamepad API), mod landscape pe mobil, ecran complet, 5 teme.
- Chat, chat vocal și video opțional (WebRTC), pauză prin vot, salvare/reluare partidă, revanșă, ultima mutare, antrenament cu asistent, profiluri, prieteni, invitații, notificări, clasament, turnee private, trofee, Admin Center, PWA.

## Structura

```
remi/
  src/engine/      motorul de joc (TypeScript pur, partajat client/server): piese, validator, scoruri, stări, boți, asistent, scenarii
  src/shared/      protocolul WebSocket
  src/worker/      Cloudflare Worker (API, fișiere statice din R2, cron backup) + Durable Object RemiRoom
  src/web/         frontend React + Zustand (Vite)
  migrations/      schema D1 (SQLite)
  test/            Vitest (unit, property-based cu fast-check)
  e2e/             Playwright (multiplayer cu 4 browsere, mecanici, funcții de cameră, social, performanță, soak)
  scripts/         deploy.sh, upload-static.sh
```

## Dezvoltare locală

```bash
cd remi
npm install
```

```bash
npx wrangler d1 migrations apply remi-production --local
```

```bash
npm run build && npx wrangler dev --port 8787
```

Deschide http://127.0.0.1:8787. Pentru hot-reload la interfață rulează în paralel `npx vite` (proxy către 8787 pentru `/api` și `/ws`).

## Teste

```bash
npm test
```

```bash
BASE=http://127.0.0.1:8787 node e2e/multiplayer.cjs
```

Celelalte scripturi: `e2e/mechanics.cjs`, `e2e/room-features.cjs`, `e2e/social.cjs`, `e2e/perf.cjs`, `e2e/soak.cjs` (variabile `BASE`, `OUT`, `MINUTES`, `ROOMS`). Rezultatele: `TEST_REPORT.md`, `PERFORMANCE_REPORT.md`.

## Deploy

```bash
scripts/deploy.sh production
```

```bash
scripts/deploy.sh staging
```

Detalii (resurse Cloudflare, secrete, rollback): `DEPLOYMENT.md`.

## Documentație

`RULES.md` reguli și opțiuni · `ARCHITECTURE.md` stare, rețea, securitate · `SECURITY.md` · `API.md` · `DEPLOYMENT.md` · `BACKUP_AND_RECOVERY.md` · `COST_ESTIMATE.md` · `PERFORMANCE_REPORT.md` · `TEST_REPORT.md` · `ADMIN_GUIDE.md` · `USER_GUIDE.md` · `TASKS.md` · `CHANGELOG.md`

### Notă despre stack

Cerința inițială propunea Node/Fastify/Socket.IO/PostgreSQL/Redis/Docker. La cererea ulterioară de deploy Cloudflare-nativ, arhitectura a fost adaptată: **Workers + Durable Objects (WebSocket nativ cu hibernare) + D1 + R2**. Socket.IO, Redis și PostgreSQL nu sunt necesare (Durable Object-ul ține starea activă a mesei, D1 persistența). Tailwind și Framer Motion au fost înlocuite cu CSS propriu și animații CSS/WAAPI pe `transform`, pentru performanță și bundle mic (~70 KB gzip la prima încărcare). Docker Compose nu este inclus deoarece rularea locală completă se face cu `wrangler dev` (simulează Workers, DO, D1 și R2 local).
