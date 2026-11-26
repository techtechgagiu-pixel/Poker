# Raport de performanță — https://remi.noventra.ro

Toate valorile sunt **măsurate pe producție** (26.11.2026), nu estimate. Datele brute: `e2e/out/prod/perf.json`, `soak.json`, `lighthouse-*.json` (generate de `e2e/perf.cjs`, `e2e/soak.cjs`, Lighthouse 12.2.1).

## Mediu de test
- Container Linux în cloud, Chromium 158 headless (Playwright), randare software, **vsync fix la 60 Hz**, fără GPU.
- Rețea: datacenter → Cloudflare (RTT WebSocket median 19 ms).
- Lighthouse: profilele implicite mobil (throttling simulat 4G lent, CPU 4×) și desktop.
- **120 FPS nu a putut fi măsurat**: nu există un ecran de 120 Hz în acest mediu. Codul nu limitează rata de cadre (animații pe `requestAnimationFrame` nativ, setarea „Până la 120 FPS”/„Nativ”); setarea „60 FPS” limitează scrierile de drag la ~16 ms. Pe un iPhone ProMotion / Android 120 Hz, drag-ul va rula la rata ecranului dacă dispozitivul o permite, dar acest lucru **nu este verificat**.

## Lighthouse (final)
| Profil | Performance | Accessibility | Best practices | SEO | LCP | FCP | TBT | CLS | Transfer |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Mobil | **100** | **100** | 96 | 91 | 1,4 s | 1,4 s | 40 ms | 0 | 73 KiB |
| Desktop | **100** | **100** | 96 | 91 | 0,3 s | 0,3 s | 0 ms | 0 | 73 KiB |

Înainte de optimizări: mobil 99 / acc. 92 (LCP 1,9 s), desktop 100 / acc. 92. Ce a rămas sub 100 nu ține de aplicație: beacon-ul Cloudflare Analytics e blocat de proxy-ul mediului de test (consolă), iar `robots.txt` e înlocuit de robots.txt-ul gestionat de Cloudflare la nivel de zonă (directivă `Content-Signal` necunoscută pentru Lighthouse).

## Încărcare (Performance API, fără throttling)
| | TTFB | FCP | LCP | CLS | DOMContentLoaded | Octeți transferați |
|---|---:|---:|---:|---:|---:|---:|
| Rece | 81 ms | 156 ms | 332 ms | 0 | 355 ms | 72,7 KB |
| Cald (service worker + cache) | 86 ms | 160 ms | 160 ms | 0 | 361 ms | 2,9 KB |
| Creare masă → masa afișată | | | | | | 1,26 s |

## Fluiditate (cadre măsurate cu rAF)
| Scenariu | Cadre | Medie | p95 | Max | FPS | Cadre pierdute |
|---|---:|---:|---:|---:|---:|---:|
| 12 drag-uri continue de piese (480 mișcări) | 498 | 16,67 ms | 16,7 | 16,8 | 60 | 0 |
| 12 sortări rapide | 62 | 16,66 | 16,8 | 16,8 | 60 | 0 |
| Deschidere/închidere istoric ×10 | 21 | 16,67 | 16,8 | 16,8 | 60 | 0 |
| Ecran complet ×6 | 65 | 16,67 | 16,8 | 16,8 | 60 | 0 |

Ecranul complet nu întrerupe conexiunea (WebSocket rămâne deschis), nu resetează piesele și nu oprește timerul.

## Rețea
- RTT WebSocket (ping): median 19 ms, p95 21 ms.
- Confirmare acțiune (tragere/aruncare, inclusiv validarea pe server): median 20 ms, max 22 ms (țintă < 150 ms).
- Payload: ~2–4 KB/vedere; rearanjarea suportului nu generează trafic (doar o salvare debounced la 800 ms).

## Sesiune lungă (soak 60 min, 2 mese concurente cu boți)
- 8 partide complete, 66 runde, 1.327 acțiuni prin interfață (drag, sortare, istoric, trageri, aruncări, închideri, revanșe), **0 erori**.
- Heap JS: 9,5 MB la minutul 0 și la minutul 59 în ambele mese (fără scurgeri de memorie).
- FPS minim (eșantion la minut): 58,7 / 59,6; p95 maxim 16,8 ms. DOM stabil (117–337 noduri).
- 5–6 reconectări per masă, cauzate de **deploy-urile în producție făcute în timpul testului**; jocul a continuat de fiecare dată fără pierderi de piese.

## Blocaje găsite și optimizări aplicate
| Problemă | Optimizare |
|---|---|
| Piesa revenea la slotul vechi înainte de a aluneca la cel nou | „Glide” direct din punctul de eliberare (transform înghețat + tranziție) |
| Ridicarea piesei selectate fără tranziție | Tranziție pe `transform`/`box-shadow` (140 ms) |
| Textura pâslei cu `mix-blend-mode` (recompoziție la fiecare cadru) | Strat simplu cu opacitate |
| Umbră `filter: drop-shadow` pe piesa trasă | `box-shadow` pe piesa interioară |
| Setările FPS și „Auto” fără efect | Limită reală 60 FPS; „Auto” măsoară p90 al cadrelor și coboară la Echilibrat/Performanță pe dispozitive lente |
| Fără animații la tragere/aruncare | Animații CSS scurte pe `transform`/`opacity` (arrive/land) |
| Zoom blocat, beacon blocat de CSP | Viewport accesibil, zoom blocat doar pe masă; CSP ajustat |

## Limitări
- 120 Hz, Safari/iPhone, Firefox, Edge, Android real și PWA instalată nu au fost testate pe hardware real (doar Chromium headless, plus emulare iPhone 13 pentru layout/orientare).
- INP real nu poate fi măsurat fără interacțiuni reale; proxy Lighthouse (max potential FID): 100 ms mobil, 20 ms desktop.
- Voce/video: lățimea de bandă și calitatea nu au fost măsurate pe rețele reale.
