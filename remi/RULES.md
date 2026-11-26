# Regulile jocului — Remi (Gagiu's WorkArt)

Toate valorile marcate *(config)* sunt setabile de gazdă la crearea mesei; sunt înghețate la startul partidei (snapshot imutabil `matchConfig`) și aplicate de server.

## 1. Piese
106 piese fizice, fiecare cu ID unic (0–105): numerele 1–13 în 4 culori (roșu ●, albastru ■, galben ▲, negru ◆), câte 2 exemplare, plus 2 jokeri falși (✦). Simbolurile de formă fac culorile distinctibile fără a depinde doar de culoare.

## 2. Atu (indicator) și jokeri
- La începutul rundei se alege aleator (CSPRNG, server) o piesă **numerotată** = **Atu**.
- **Jokerul real** = numărul următor, aceeași culoare (13 → 1). Ambele exemplare sunt jokeri reali (wildcard).
- **Jokerii falși** (piesa cu stea ★, fără număr imprimat) nu sunt wildcard: valorează exact piesa-joker (culoarea și numărul jokerului real).
- Un joker real poate fi folosit și la valoarea lui naturală (o substituție a propriei celule).

## 3. Împărțire și ture
14 piese fiecărui jucător activ, 15 celui care începe; cel care începe se rotește la fiecare rundă. Joc în sens invers acelor de ceasornic. La tură: trage din pachet **sau** ia ultima piesă aruncată de jucătorul din stânga (doar dacă a fost aruncată în tura imediat anterioară), apoi aruncă o piesă (spre dreapta) sau închide. Rearanjarea suportului nu consumă tura. Jocul se face exclusiv pe suport (fără etalare).

**Timer** *(config: 15/30/45/60/90/nelimitat/personalizat, implicit 30 s)*: impus de server. La expirare serverul execută o acțiune legală (trage din pachet, aruncă piesa cea mai puțin utilă; închide dacă mâna e câștigătoare).

**Pachet epuizat:** dacă jucătorul care trebuie să tragă găsește pachetul gol, runda se termină egal — fără penalizări, scorurile rămân, PASS se resetează, se împarte din nou. Piesele aruncate nu se reamestecă. *(Ambiguitate documentată: în acest moment nu se mai permite nici luarea piesei din stânga; runda se încheie.)*

## 4. Formații
- **Suită:** ≥3 numere consecutive, aceeași culoare. 1-2-3 mereu valid; 12-13-1 valid implicit *(config `highAce`)*; 13-1-2 niciodată.
- **Terță/careu:** 3 sau 4 piese cu același număr, culori diferite (fără culori duplicate).
- **Pereche:** două piese identice (număr și culoare).
Jokerii reali pot înlocui orice piesă lipsă.

## 5. Categorii de închidere (14 piese după aruncarea celei de-a 15-a)

| Categorie | Predicat | Standard | Joker aruncat |
|---|---|---:|---:|
| Normal cu joker | partiție în suite+terțe; mâna conține ≥1 joker real | 5 | 20 |
| Normal fără joker | partiție în suite+terțe; mâna nu conține joker real (jokerii falși nu contează) | 10 | 20 |
| Doar suite | partiție exclusiv în suite | 10 | 20 |
| Doar terțe | partiție exclusiv în terțe/careuri (3+3+4+4) *(config `triplesAllowFour`)* | 10 | 20 |
| Duble | exact 7 perechi; doi jokeri ca o pereche *(config `doubleJokerPair`, implicit da)* | 15 | 30 |
| Culoare | toate cele 14 piese au aceeași culoare efectivă, **fără nicio formație**; numere duplicate permise, ordinea irelevantă; jokerii reali înlocuiesc orice piesă de acea culoare; jokerii falși au culoarea jokerului; piesa aruncată poate avea orice culoare | 15 | 30 |
| Grand | exclusiv terțe/careuri (numere diferite între seturi permise) | 30 | 60 |

- Fiecare categorie: activare, penalizare standard, penalizare cu joker aruncat și **folosirea jokerilor în acea categorie** *(config)*, independent. Categoriile dezactivate nu sunt validate, revendicate sau urmărite de boți.
- **Grand vs Doar terțe:** au predicatul identic (doar seturi). Nu am inventat o distincție. Implicit se acordă categoria cu penalizarea cea mai mare (Grand). Doar terțe contează doar dacă Grand e dezactivat sau gazda stabilește altă prioritate; Doar terțe are propria opțiune `triplesAllowFour`.
- **Prioritate:** implicit penalizarea cea mai mare dintre categoriile potrivite; gazda poate seta o ordine fixă *(config `priority`)*.
- **Închidere cu joker aruncat** *(config `closeByJokerDiscard`)*: dacă e dezactivată, un joker real nu poate fi a 15-a piesă la închidere.
- **Multiplicator joker** *(config, implicit oprit)*: penalizare × factor^(jokeri reali în mână).
- Validatorul este exhaustiv (backtracking memoizat pe 52 de celule + număr de wildcarduri), nu greedy; returnează formațiile și substituțiile jokerilor pentru ecranul de final.

## 6. Punctaj descrescător
Start 100 *(config)*. Câștigătorul rundei nu pierde; ceilalți activi pierd penalizarea. ≤0 → eliminat (afișat 0), rămâne spectator. Locul eliminatului nu e completat cu bot. Partida continuă până rămâne un jucător; dacă toți adversarii sunt eliminați simultan, câștigătorul rundei câștigă partida.

## 6b. Cumul la câștigător *(config `winnerCollects`, implicit DA)*
Punctele pierdute de adversari la o închidere se **adună la cel care a închis**. Se adună doar ce a pierdut efectiv fiecare (un adversar cu 4 puncte, penalizat cu 10, contribuie 4 și este eliminat). Câștigătorul poate depăși punctajul inițial.

## 6c. Colț *(config `corner`, implicit activ, 5 puncte)*
- La fiecare **refacere a jocului** — remiză prin vot sau pachet epuizat — fiecare jucător activ pune **N puncte deoparte** (N setabil, 0–1000; opțiunea „Joc cu colț” poate fi dezactivată).
- Colțul se acumulează de la o refacere la alta și **se ia întreg** de cel care închide cu o specială. Implicit: închidere cu **joker aruncat**, **Culoare**, **Duble**, sau după ce **a activat PASS** în runda respectivă. Grand se poate bifa separat. Fiecare variantă e o bifă separată.
- Dacă plata la colț aduce un jucător la ≤0, acesta este eliminat (ca la orice altă pierdere de puncte).
- *Interpretare documentată:* „sau PASS” = jucătorul care a activat PASS în acea rundă și apoi închide (cu orice categorie validă).

## 6d. Remiză prin vot *(config `drawVote`, implicit activă)*
Orice jucător activ poate cere „Solicită remiză”; toți oamenii activi conectați trebuie să accepte (boții acceptă automat). Runda se încheie fără câștigător și se reface (cu plata la colț, dacă e activ).

## 7. PASS (implicit activ)
- Disponibil **doar** când ai **ambii jokeri reali** în momentul aruncării (un joker fals nu contează). Butonul PASS apare numai atunci.
- Pui unul dintre jokeri în zona PASS (blocat, nu mai poate fi folosit), tura se încheie, celălalt rămâne la tine.
- Cât e activ: nimeni nu mai poate lua piese aruncate; toți trag doar din pachet; istoricul aruncărilor rămâne vizibil.
- *(config)* durată: toată runda (implicit) / o rotație / N ture; afectează și activatorul (implicit da); activări pe rundă (implicit 1); punctaj la activare (implicit 0). Se resetează la fiecare rundă.

## 8. Arătare atu (Indicator) — implicit activ, 1 punct
Cine are a doua piesă identică cu Atu o poate arăta înainte să-și termine prima tură. Fiecare adversar activ pierde punctajul atu *(config)*; declarantul nu pierde; piesa rămâne pe suport; nu consumă tura; o declarație pe rundă *(config)*. Se aplică eliminarea. Boții declară automat. Dezactivarea nu afectează jokerul dinamic.

## 9. Alte reguli de masă *(config)*
Spectatori, chat, voce, video, pauză prin vot (aprobare unanimă a oamenilor activi conectați, vot 15 s, pauză max. 5 min, 2 cereri/jucător), timp de reconectare (15 s) și preluare de către bot, pauză între runde (8 s), confirmare la aruncarea jokerului, dificultatea boților, completare cu boți.

## 9a. Intrarea după începerea partidei
Linkul de invitație rămâne valabil și în timpul partidei:
- dacă la masă este un **bot**, noul jucător îi **preia locul** (cu piesele și punctajul botului) și continuă de la tura curentă;
- dacă nu mai e niciun loc, intră ca **spectator la coadă**; primul din coadă primește automat locul eliberat când un jucător apasă „Părăsește locul” (un bot îl ține până atunci) sau la revanșă;
- spectatorii pot intra/ieși oricând din coadă („Vreau să joc”); locurile jucătorilor deconectați **nu** se dau altcuiva (ei au dreptul să revină).

## 9c. Robot în locul celui care iese
- Jucătorul care **iese din masă** (butonul înapoi / „Părăsește masa” / „Părăsește locul”) pierde locul: un robot îl preia imediat, cu piesele și punctajul lui. Poate reveni oricând cu linkul de invitație (ia locul unui robot).
- Când **aplicația ajunge în fundal** (ecran stins, altă aplicație, alt tab) mai mult de ~2,5 secunde, un robot joacă în locul lui, imediat; la întoarcere își reia locul (eticheta „🤖 robot” se vede la toți).
- La **deconectare** (internet căzut, pagină închisă) robotul preia după timpul de reconectare (implicit 8 s, setabil).
- O reîncărcare a paginii nu îți ia locul.

## 9b. Mese live *(config `listed`, implicit DA)*
Mesele în desfășurare apar în lista „Mese live”; oricine poate intra ca spectator (doar informații publice: scoruri, piese aruncate, Atu, PASS — niciodată piesele ascunse). Gazda poate scoate masa din listă.

## 10. Presetări
Remy Pro Custom (implicit, tot ce e mai sus) · Okey clasic (fără PASS, doar normal + duble) · Rapid (15 s, start 50) · Doar normal · presetări proprii salvate local.

## 11. Antrenament
Timp nelimitat, scenarii (fiecare categorie, închidere cu joker, PASS, Atu) cu mâna demonstrativă împărțită de server, asistent de formații (doar piesele proprii + informații publice), statistici separate. Asistentul este refuzat de server în mesele competitive.
