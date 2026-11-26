# Septică — rules as implemented

Separate game next to Remi (tab "Remi | Septică" in the top corner of the home screen). Same rooms, invitation
codes/links, spectators + queue, chat, voice and video as Remi. Server-authoritative: the Durable Object holds
every hand; a client only ever receives its own cards (`septicaView`).

* Deck: 32 cards (7 8 9 10 J Q K A × ♥ ♦ ♣ ♠). 2, 3 or 4 players (optionally 2 v 2 teams: seats 1+3 vs 2+4).
* Each player gets 4 cards, a random seat leads. The leader plays any card; its rank is the rank to answer.
* The next player may answer with the **same rank** or **any 7**, or pass (a player with no legal card passes automatically;
  the host can forbid voluntary passing when an answer exists — default: allowed).
* An answer hands the turn to the next player, who may again answer (same rank or 7) or pass.
* The first pass ends the trick: the **last player who played a card takes the pile** and leads next.
* After every trick all players draw back to 4 (the taker first) while the stock lasts.
* Tens and aces = 1 point each (8 in total). Highest total wins; ties are broken by cards taken; still tied = draw. Teams add partners' points.
* Turn timer (default 20 s, 0 = unlimited): on timeout the server plays a legal move (never blocks the table).
* Leaving the table / app in background / AUTO: a robot (easy/medium/hard) plays for the player at once.
* Not applicable to Septică: draw vote, Atu, corner pot. Pause and save votes work.

Implementation: `src/engine/septica.ts` (pure state machine + bot), room hooks in `src/worker/room.ts` (`kind: 'septica'`),
UI in `src/web/septica/`. Tests: `test/septica.test.ts`, `e2e/septica.cjs`.
