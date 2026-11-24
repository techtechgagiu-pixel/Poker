# AI Poker Night

Turneu Texas Hold'em No-Limit cu 9 agenți AI (personaje ciudate), într-un platou TV din Las Vegas.

```bash
export OPENROUTER_API_KEY=sk-or-...   # fără cheie, jucătorii sunt boți euristici
npm start                             # http://localhost:3000 -> apasă START TURNEU
```

- Blindurile cresc la fiecare 5 minute (`BLIND_MINUTES`), decizie max 10 s (`DECISION_MS`); la timeout: check sau fold.
- Cărțile se amestecă cu `crypto.randomInt` (Fisher-Yates). Motorul (pot, side pot, evaluare) e cod determinist; LLM-ul alege doar acțiunea și replica.
- Modele: `OPENROUTER_MODELS` (listă separată prin virgulă, implicit 4 modele ieftine, alocate round-robin).
- `npm run demo` rulează accelerat; `npm run images` regenerează imaginile prin Atlas Cloud (`ATLAS_API_KEY`, model gpt-image-2.5-sunburst).

## Deploy pe Cloudflare (poker.noventra.ro)
Worker + Durable Object (jocul) + R2 (fișierele din `public/`). `npx wrangler r2 object put poker-static/<fișier> --file public/<fișier> --remote` pentru fișiere statice, `npx wrangler deploy` pentru Worker, `npx wrangler secret put OPENROUTER_API_KEY` pentru cheie.
