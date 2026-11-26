# Deploy

## Resurse Cloudflare create (cont `098f56d0…`, zona `noventra.ro`)
| Resursă | Producție | Staging |
|---|---|---|
| Worker | `remi-noventra` → custom domain `remi.noventra.ro` | `remi-noventra-staging` → `remi-dev.noventra.ro` |
| Durable Object | `RemiRoom` (SQLite storage, WebSocket hibernation) | namespace separat (worker separat) |
| D1 | `remi-production` (`abdcfbd7-…`) | `remi-staging` (`2269e252-…`) |
| R2 | `remi-static` (frontend), `remi-backups` (backup D1, prefix `d1/production/`) | `remi-static-staging`, `remi-backups` (prefix `d1/staging/`) |
| Cron | `17 3 * * *` (backup zilnic, curățenie) | — |
| Cloudflare Access | app „Remi Admin Center” (`/admin`, `/api/admin`) | app „Remi Staging” (tot domeniul) |
| Access IdP | „One-time PIN” (cod pe email) | |
| Secrete Worker | `ADMIN_EMAILS` (allow-list admin) | `ADMIN_EMAILS` |
| DNS | doar înregistrarea `remi` (creată de custom domain, proxied) | `remi-dev` |

Nicio altă înregistrare DNS sau serviciu din `noventra.ro` nu a fost modificat. HTTPS/WSS prin certificatul gestionat de Cloudflare.

## De ce fișierele statice sunt în R2
Upload-ul Workers Static Assets folosește un JWT de sesiune care nu poate trece prin proxy-ul mediului de build folosit; frontend-ul e servit de Worker din R2 (`src/worker/static.ts`) cu headere de securitate, fallback SPA și cache la margine pentru `/assets/*` (fișiere versionate, `immutable`). Fișierele vechi rămân în R2, astfel încât clienții deschiși nu primesc 404 după un deploy.

## Pași
Necesită `CLOUDFLARE_API_TOKEN` (Workers Scripts, D1, R2, Access edit) și `CLOUDFLARE_ACCOUNT_ID`.

```bash
cd remi && scripts/deploy.sh staging
```

```bash
BASE=https://remi-dev.noventra.ro node e2e/multiplayer.cjs
```

(staging e în spatele Access; pentru teste automate creează un Service Token Access sau rulează local)

```bash
scripts/deploy.sh production
```

`deploy.sh` rulează testele unitare, build-ul, încarcă `dist/` în R2, aplică migrațiile D1 și publică Worker-ul.

## Rollback
```bash
npx wrangler deployments list
```

```bash
npx wrangler rollback <version-id>
```

Fișierele frontend vechi sunt încă în R2; `index.html` se reîncarcă la următorul deploy. Migrațiile D1 sunt doar aditive (fără coloane șterse), deci un rollback de cod nu necesită rollback de schemă.

## Partide în curs la deploy
Un deploy restartează Durable Object-urile; starea fiecărei mese e salvată după fiecare acțiune, clienții se reconectează automat (backoff), timerele sunt reprogramate din starea salvată. Service worker-ul activează o versiune nouă a interfeței doar când utilizatorul nu e într-o partidă.

## Secrete și variabile
```bash
npx wrangler secret put ADMIN_EMAILS
```

Opțional TURN (voce/video prin NAT restrictiv, serviciu Cloudflare Realtime TURN — **cu cost**, neactivat):
```bash
npx wrangler secret put TURN_KEY_ID
```

```bash
npx wrangler secret put TURN_KEY_TOKEN
```
