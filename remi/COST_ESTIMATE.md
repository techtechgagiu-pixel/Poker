# Estimare costuri Cloudflare

**Planul contului (verificat prin API, 26.11.2026):** Workers Paid ($5/lună), R2 Paid (pay-as-you-go cu nivel gratuit), Zero Trust Free (≤50 utilizatori Access), zona `noventra.ro` pe Free. **Nu a fost activat niciun serviciu nou cu plată** (TURN, WAF avansat, Turnstile, Web Push nu sunt pornite).

## Prețuri presupuse (de reverificat în documentația Cloudflare înainte de creștere)
| Produs | Inclus în Workers Paid | Peste |
|---|---|---|
| Worker requests | 10 M/lună | $0,30 / M |
| Worker CPU | 30 M ms/lună | $0,02 / M ms |
| Durable Objects requests | 1 M/lună (mesajele WebSocket primite se facturează 20:1) | $0,15 / M |
| Durable Objects duration | 400.000 GB-s/lună | $12,50 / M GB-s |
| D1 | 25 mld. rânduri citite, 50 M scrise, 5 GB | — |
| R2 | 10 GB, 1 M op. A, 10 M op. B | $0,015/GB-lună |
| Realtime TURN (neactivat) | 1.000 GB/lună | $0,05 / GB |

## Model de trafic (măsurat în cod)
- Per jucător-oră: ~720 ping-uri (la 5 s) + ~120 acțiuni + ~30 salvări de layout ≈ 870 mesaje → ~44 cereri DO facturabile.
- Un Durable Object pe masă (128 MB). Cu ping la 5 s masa nu ajunge să hiberneze cât e ocupată ⇒ presupunem activ 100%: 0,125 GB × 3600 s = **450 GB-s / masă-oră**.
- Utilizare presupusă: **90 de ore/lună** la concurența din tabel (≈3 h în fiecare seară).
- Video P2P (mesh): fără cost Cloudflare dacă nu se folosește TURN. Dacă TURN ar fi activat și 20% din conexiuni ar avea nevoie de releu: voce ~11 MB/jucător-oră releu, video 360p ~80 MB/jucător-oră releu.

## Scenarii (cost lunar peste abonamentul de $5)
| Jucători simultani | Mese | DO GB-s / lună | Doar joc | + voce (cu TURN) | + video 360p (cu TURN) |
|---:|---:|---:|---:|---:|---:|
| 4 | 1 | 40.500 | **$0** | $0 | $0 |
| 20 | 5 | 202.500 | **$0** | $0 | $0 (144 GB) |
| 100 | 25 | 1.012.500 | **≈ $7,7** | $7,7 (97 GB) | $7,7 (720 GB, în nivelul gratuit) |
| 1.000 | 250 | 10.125.000 | **≈ $122** (+$0,4 cereri) | ≈ $122 (972 GB) | ≈ $437 (7,2 TB → +$315) |

D1, R2 și cererile Worker rămân în cotele incluse în toate scenariile (o partidă = ~10 scrieri D1; frontend ~72 KB, servit din cache la margine).

## Optimizări disponibile
- Ping la 20–25 s în loc de 5 s ar permite hibernarea între ture (estimat −60…80% din durata DO); costul: RTT afișat mai rar.
- Limite configurabile din Admin → flags `limits` (mese, spectatori, rezoluție video, partide salvate, istoric).
- Camerele abandonate sunt închise automat (6 h), conexiunile media sunt eliberate la ieșire.
- Admin → Metrics afișează un cost/oră estimativ pe baza conexiunilor curente.
