# API

Bază: `https://remi.noventra.ro`. JSON; erori `{ "error": "<cod>" }`. Identitate: header `x-guest: <secret local>` (invitat) și/sau `Authorization: Bearer <token de sesiune>` (profil). Metodele non-GET cer `Origin` identic.

## Mese
| Metodă | Cale | Descriere |
|---|---|---|
| GET | `/api/health` | stare |
| GET | `/api/config/defaults` | reguli implicite, mentenanță, flag-uri publice |
| POST | `/api/rooms` | `{name, config?, mode: human\|bots\|training, scenario?, announce?}` → `{code, token, pid}` |
| GET | `/api/rooms/:code` | info publică (gazdă, jucători, status) |
| POST | `/api/rooms/:code/join` | `{name, spectator?}` → `{token, pid, role}` |
| POST | `/api/rooms/:code/ice` | `{token}` → ICE servers (doar jucători verificați) |
| WS | `/ws/:code?token=` | canalul de joc |

### Mesaje WebSocket (client → server)
`act {aid, v, a: draw{source} | discard{tile} | close{tile, category?} | pass{tile} | atu}` · `config` (gazdă, lobby) · `ready` · `seat {seat, kind: bot|empty|take|leave, level?}` · `kick` · `start` · `chat` · `react` · `rack {layout}` · `nextReady` · `vote {kind: pause|resume|save}` · `voteAnswer` · `resumeSaved` · `rematch` · `hint` (doar antrenament) · `restartTraining` · `rtc {to, data}` · `media {mic, cam}` · `ping`.

### Server → client
`room {room, you}` · `game {view, rack?}` (vedere filtrată per loc) · `ack {aid}` · `err {code, aid?}` · `rtc` · `hints` · `pong` · `kicked` · `replaced`.

## Profil și social (necesită `Authorization`)
`POST /api/auth/register {username, nickname}` → `{token, recoveryKey}` · `POST /api/auth/login {username, recoveryKey}` · `POST /api/auth/logout` · `POST /api/auth/rotate` · `GET|PUT|DELETE /api/me` · `GET /api/me/export` · `POST /api/presence {status}` · `GET /api/users/search?q=` · `GET /api/friends` · `POST /api/friends/request {username}` · `POST /api/friends/respond {userId, accept}` · `POST /api/friends/remove {userId}` · `POST /api/friends/block {userId, unblock?}` · `POST /api/invite {userId, code}` · `GET /api/notifications` · `POST /api/notifications/read` · `GET /api/leaderboard?period=all|month|week|custom&from&to&mode=human|bots|tournament&min=` · `GET /api/stats` (și invitați) · `GET /api/saved`.

## Turnee
`GET /api/tournaments` · `POST /api/tournaments {name, format, maxPlayers, rounds, points[4], tieBreak, advance, config}` · `POST /api/tournaments/join {code}` · `GET /api/tournaments/:id` · `POST /api/tournaments/:id/start` (organizator) · `POST /api/tournaments/:id/room/:matchId` (participanți).

## Admin (Cloudflare Access + allow-list)
`GET /api/admin/whoami|metrics|users|flags|achievements|matches|tournaments|logs|audit|backups|version` · `POST /api/admin/users/suspend` · `POST /api/admin/rooms/close` · `PUT /api/admin/flags` · `PUT /api/admin/achievements` · `POST /api/admin/backups`.
