# Admin Center — ghid

**URL:** https://remi.noventra.ro/admin · Autentificare: Cloudflare Access → cod pe email (One-time PIN) pentru emailul din politica „Remi admins” (emailul contului Cloudflare). Serverul verifică suplimentar JWT-ul Access și lista `ADMIN_EMAILS`.

## Tab-uri
- **metrics** — utilizatori online, mese/partide active, spectatori, boți, conexiuni voce/video și WebSocket, partide terminate (total/24 h), jucători înregistrați, erori 24 h, cost estimat/oră. Reîmprospătare la 10 s.
- **rooms** — mesele active (ultimele 6 h); „Închide” deconectează pe toți și șterge masa (motiv obligatoriu, jurnalizat).
- **users** — căutare, suspendare/reactivare (revocă sesiunile).
- **flags** — `maintenance` (`{"enabled":true,"emergency":false,"message":"…"}`: blochează partidele noi, cele în curs continuă), `voice`, `video`, `tournaments`, `limits`, `defaultRules` (reguli implicite pentru mese noi), `backupRetentionDays`.
- **achievements** — pragurile trofeelor.
- **matches** — metadate publice (fără mâini).
- **logs** — erori server; **audit** — jurnal imuabil cu verificare de integritate (lanț de hash-uri); **backups** — listă + backup manual.

Nu există (intenționat) funcții de modificare a scorurilor sau a partidelor în desfășurare, nici acces la piesele ascunse.

## Adăugarea unui alt administrator
1. Zero Trust → Access → Applications → „Remi Admin Center” → policy „Remi admins” → adaugă emailul.
2. `npx wrangler secret put ADMIN_EMAILS` cu lista separată prin virgulă.
