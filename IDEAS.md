# Idee: Turneu de poker cu 9 agenți AI (NU se implementează încă)

## Specificații
- **Pagină web**: utilizatorul pornește turneul dintr-un buton și îl urmărește live.
- **9 agenți AI** la o singură masă, decizii prin OpenRouter (modele ieftine/rapide, personalități diferite).
- **Blinduri**: cresc la fiecare **5 minute**.
- **Timp de decizie**: maximum **10 secunde** per agent. La expirare se aplică check, dacă este posibil, altfel fold.
- **Cărți**: amestecare cu RNG real (Fisher-Yates + `crypto.getRandomValues`). Motorul de joc (pot, side pot, evaluare mâini) este cod determinist, nu LLM.
- **Replici** (table talk) în baloane de dialog, plus animații pentru împărțit cărți, jetoane și eliminări.
- **Personaje**: fiecare agent este un „om ciudat” (portret generat), cu numele deasupra capului.
- **Design**: masă de poker televizată, stil Las Vegas, cu grafică de transmisie.
- **Imagini** (masa, locația și portretele): generate prin Atlas Cloud, cu cel mai ieftin model de imagini.
  - Ales: `openai/gpt-image-2.5-sunburst/text-to-image` (~$0.003/imagine). Varianta `-flare` costă la fel.
  - Total estimat: 9 portrete + masă + locație ≈ 11 imagini ≈ $0.03.
- Turneu scurt, cu blinduri care urcă repede.

## Note tehnice
- Cheile OpenRouter și Atlas rămân pe server, nu în browser. Serverul trimite starea live în browser prin SSE sau WebSocket.
- Imaginile se generează o singură dată și se salvează ca fișiere statice.
- Cost principal: apelurile LLM (9 agenți × multe mâini). Replici scurte, `max_tokens` mic.
