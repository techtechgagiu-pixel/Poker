# Securitate

| Amenințare | Măsură |
|---|---|
| Acțiuni falsificate / în afara turei | Serverul verifică token→membru, rol de jucător, loc în partidă, tura curentă, faza, proprietatea piesei, eligibilitatea piesei din stânga, PASS, versiunea stării. Clientul doar cere. |
| Acțiuni duplicate (dublu click, latență) | `aid` unic memorat per jucător + blocare în UI până la ack. |
| Citirea pieselor ascunse | `buildView` trimite doar mâna proprie; adversari = număr de piese; pachet = număr. Testat automat: 247–281 cadre WS verificate în producție, nicio mână străină. Spectatorii: `me = null`. Log-urile nu conțin mâini. Admin nu are acces la mâini. |
| Escaladarea spectatorilor | Acțiunile cer loc în partidă; semnalizarea media doar între jucători. |
| Timere manipulate de client | Termenul turei e pe server (alarmă DO); clientul doar afișează. |
| Scoruri/realizări/turnee falsificate | Calculate exclusiv din stări de server; înregistrare idempotentă; trofee acordate din statistici D1. |
| Brute-force la coduri | 32^6 ≈ 1,07 mld. combinații; rate limit 40 cereri/min/IP pe `/api/rooms/*`, 20 camere/10 min/IP la creare; camerele inexistente răspund 404. |
| Spam chat / prietenii / notificări | 6 mesaje/10 s; 20 cereri de prietenie în așteptare (expiră în 14 zile); 30 notificări/oră/utilizator, deduplicate. |
| XSS | React escapează tot textul; nume/chat curățate de caractere de control și `<>`; CSP `script-src 'self'` (+ beacon Cloudflare Analytics), `object-src 'none'`, `frame-ancestors 'none'`. Avatare doar din listă predefinită (fără upload). |
| CSRF | API autentificat prin header `Authorization: Bearer` (nu cookie) + verificare `Origin` pe metode non-GET și pe WebSocket. |
| Furt de sesiune | Token-uri aleatoare 256 bit; în D1 doar hash; sesiuni de profil 30 zile, revocabile (logout, cheie nouă = toate sesiunile revocate). Conturile nu au parolă; cheia de recuperare e stocată doar ca hash. |
| Admin | Cloudflare Access (OTP pe email) la margine **și** verificare JWT RS256 (semnătură JWKS, `aud`, `iss`, `exp`) + listă de emailuri (secret `ADMIN_EMAILS`) în Worker. Fără endpoint de modificare a scorurilor sau a meselor live. Jurnal de audit cu lanț de hash-uri, verificat la afișare. |
| Media | Doar cu permisiune explicită; nimic înregistrat; pistele oprite la ieșire; ICE doar pentru membri verificați. |
| Cache | API-ul `no-store`; service worker-ul nu cachează `/api`, `/ws`, `/admin`. |
| Headere | HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, CSP. |

## Date personale
Invitați: un secret aleator local (doar hash pe server) + nume afișat. Profil: utilizator, nume, avatar, preferințe, prieteni, statistici. Nu colectăm email, IP-uri persistente sau date de plată. Export (`GET /api/me/export`) și ștergere (`DELETE /api/me`) disponibile din Profil. Notificări șterse după 30 zile, log-uri de erori după 14 zile, backup-uri după 30 zile.

## Limitări cunoscute
- Rate limiting-ul e în memoria isolate-ului Worker (best-effort); WAF/Turnstile nu au fost activate (pot genera costuri/configurare de cont — de aprobat).
- Fără TURN: voce/video pot eșua în rețele cu NAT simetric.
