# Joshua Game Hub — project context

Browser multiplayer games at joshuagamehub.website: **Clean Getaway** (5-player chase, Pac-Man Vs.-style) and **Math Race** (up to 40 players, speed addition) **SPLAT!** (2–6 player kids party game) **Rush Hour** (up to 40, lane racing) **Bear Attack!** (up to 40, top-down ice survival) **Hurdle Dash** (up to 40, tap-to-run + Math Race quizzes at hurdles) **Arrow Blitz** (up to 40, 1-minute arrow sequences) **Memory Tiles** (up to 40, remember-the-picture survival) **Typing Cowboys** (up to 40, carnival-derby typing race) **Star Cannons** (up to 40, co-op laser cannons vs bouncing asteroids) and **Dart Party** (up to 40, walk-to-aim dart throwing at balloons).
Priorities: visuals and gameplay feel. Security is low priority (no accounts, usernames only). Target ≤ 50 concurrent players.

## Clean Getaway rules
- Up to 5 players (bots fill empty seats), public or private lobby. A random rotation decides who's the Thief ("It"); everyone gets one turn.
- The Thief has 1 life per turn: getting caught ends the turn.
- The Thief collects every cash stack to clear a floor. A new floor is generated, then a 3-2-1 countdown.
- Guards (the other 4 players) catch the Thief by colliding with them.
- Gold bar = EMP (4.5 s): guards slowed to 60%, and the Thief can tackle them, which sends them back to their post after 3 s.
- Score: +10 per second survived, +10 per cash stack, +500 per floor cleared, +200 per tackle, +300 for catching the Thief (guard).
- Speeds: guards 3.1 tiles/s, Thief 3.45 tiles/s. Floors get +4% guard speed for each floor cleared this turn.

## Math Race rules
- Lobby up to 40. Host (first player, ★) starts; every lobby (public or private) auto-starts 30 s after a 2nd player joins. 3 rounds × 1 min, each preceded by a 3-2-1 countdown; 9 s round leaderboard.
- Addition of 1–2 digit numbers, answers always 2–3 digits. Answer is checked the moment it has as many digits as the correct answer — no Enter, no backspace. Wrong = shake + 3 s penalty (shows the right answer), then next question.
- **All questions and checking are client-side by design (no anti-cheat).** Server sends one seed per round (everyone gets the same questions) and receives one number per player per round.
- Round leaderboard shows top max(3, ceil(15%)) (6 for 40). Final shows a podium + the same count, ranked by total.
- Modes (host picks in the lobby; practice has its own picker): add · sub (20–99 minus a smaller number, answers ≥ 10) · mul (2–12 × 2–12) · div (whole answers, dividend ≤ 99) · money (add two prices up to $9.95, 5¢ steps; type the cents, shown in a $_.__ mask). Outside money, no operand is ever more than 2 digits; answers may be 3. Round msg carries `mode`.
- Teacher Mode (menu button): private room where the host sends `teacher{}` → doesn't play, isn't ranked, auto-start off, sees a class view (timer) during rounds plus the normal boards.
- Solo practice: offline, length selectable (15 s–2 min, default 1 min, remembered), personal best per length.
- Visuals: very dark grey + shades of blue only; red only for a physically held key on the on-screen keypad (keypad is tappable on touch screens).

## Layout
- `shared/sim.js`: the whole game simulation (map gen, movement, bots, rules, snapshots). UMD module: `window.CG` in the browser, `require` on the server. No DOM, no text. It emits events (`turn`, `caught`, `emp`, …) and the client turns them into UI. **Change gameplay here; client and server both use it.**
- `public/index.html`: the hub landing page (game registry `GAMES`, live bot demo, online count from game `/health`).
- `public/assets/cg-art.js`: Clean Getaway sprites + board renderer, shared by the hub demo and the game.
- `public/clean-getaway/index.html`: the game client (deep links `?play=bots|public|private`). Renders a "view": the local `CG.Game` (VS BOTS mode) or a `NetView` built from server snapshots with ~60 ms interpolation. Pixel art, HUD, menus and lobby all live here. Player names are always escaped.
- `public/math-race/index.html`: Math Race client (question generator, input/penalty logic, leaderboards). Deep links `?play=public|private|practice`.
- `server/index.js`: game server (WebSocket gateway + room hosting, also serves the client; `KINDS` maps game id → room class). `server/roombase.js`: shared room plumbing (registry, bus channels, empty-room cleanup). `server/room.js`: Clean Getaway room, authoritative sim at 30 Hz. `server/mathroom.js`: Math Race room (seeds, score collection, rankings; timings overridable via MATH_*_MS env for tests). `server/bus.js`: Redis pub/sub + keys, with an in-memory fallback when `REDIS_URL` is unset. `server/web.js`: static-only frontend service.
- Railway project `intuitive-rebirth` (services `game`, `web`, `Redis`). Settings live in the Railway service config, not in repo files. Full guide: `docs/DEPLOY.md`.
- `npm run dev` (one process, localhost:8080) · `npm test` (headless bot match, Clean Getaway end-to-end, Math Race end-to-end, room cleanup).

## SPLAT! rules (kids game: no "killed/eliminated/soaked" wording — use SPLAT!/splatted/dodged)
- 2–6 players, host start or auto-start 30 s after a 2nd player. Everyone throws once (random order).
- Turn: up to 3 throws. Hiders pick barrel Left/Up/Right behind a sheet (10 s, 5 s, 3 s; changeable; random if none). Sheet lifts; thrower picks (8 s, random after). Hit hiders sit out the rest of the turn. Turn ends early if all are hit. ≈30–40 s per turn.
- Points: +10 per throw dodged, +20 per player splatted (balanced: equal expected points throwing vs hiding at any lobby size).
- Server-authoritative; hiding spots are never sent to the thrower. `server/splatroom.js`, `public/splat/index.html`, timings overridable via SPLAT_*_MS.

## Rush Hour rules
- Up to 40 racers, 3-lane city road (window-facade buildings close to the sidewalk for a sense of speed), chase camera (Three.js r128 from cdnjs). Controls: Left/Right lane change, Down = brake (hold). Touch: on-screen ◀ ▼ ▶ + swipes. Solo mode vs 7 ghost bots.
- Players never collide with each other (others are translucent ghosts). NPCs: red cars, blue trucks, white semis. ONE fixed speed per lane (43/54/65 km/h vs players 144) so traffic can never jam; traffic is a pure function of race time, so ghosts see the same vehicles. Racer colours never use red. Rear-end = big slowdown + short stun; sideswipe = smaller slowdown + pushed back to your lane. Glowing boost strips = +12 m/s fading over 1 s.
- `shared/rush.js` holds ALL tuning + physics + traffic + bot AI (used by browser, bots and `scripts/rush-balance.js`). Traffic comes from the race seed; a vehicle you are stuck behind pulls over onto the shoulder (per racer).
- Catch-up is a smooth function of METRES BEHIND THE LEADER (never of place): more top speed/accel, softer bumps, and stuck vehicles pull over sooner. Balance (run `node scripts/rush-balance.js`): 3,100 m ≈ 80 s median; first→last spread median ~6–8 s, worst ~13 s (target ≤ ~25 s).
- Server (`server/rushroom.js`) only relays positions (~10/s) and ranks finish times (unfinished → by distance); race closes 45 s after the winner. Results: top max(3, 15 %) + your place.

## Bear Attack! rules
- Up to 40 players on a round ice sheet (top-down canvas 2D), bear sleeps in the middle. Arrows/WASD (8 directions) or touch joystick (analog). Ice physics: speed eases toward the stick (slow take-off), long glide when released. Players bump each other (soft collisions).
- Bear: wakes (5 s first round, 3 s later), then 3 straight dashes per round to a random point between a minimum length and the ice edge; red path blinks 3× for the warning time (2.0 s, −0.3 s per round, min 0.6 s), then charges and shoves anyone in front of it. Slide off the ice = FROZEN! (kid-friendly, no "eliminated" wording on screen).
- After 3 dashes: ice shrinks to 84 % (min radius 5) while players are herded inward (nobody falls during a shrink) and the bear walks back to the middle. Last player on the ice wins; ranking = time on the ice.
- Server-authoritative: `shared/bear.js` (Game + bots) runs in `server/bearroom.js` at 40 Hz physics / 20 Hz snapshots; clients send only `in{x,y}`. Solo mode runs the same Game in the browser vs 7 bots. Pacing (bots): ~70 s (4 players) to ~95 s (40).

## Hurdle Dash rules
- Up to 40, one lane each (lane = colour index + 1), straight 100 m school track, side view (canvas 2D; your lane in front, 4 nearest lanes behind). Tap Left/Right in turn to run (same key twice = stumble, held keys ignored); touch = two big buttons.
- 10 hurdles, ONE Math Race question each (same generator, checked on last digit, no Enter; same questions for everyone via race seed). Right → jump + small speed boost (land at 7 m/s). Wrong → trip, 3 s on the ground, restart from 0. (Was 5×3 questions; a deliberate first-question miss beat answering, so it was changed.)
- `shared/hurdle.js` = rules + bots (served at /hurdle.js). Server = `server/hurdleroom.js`, a subclass of the generic race room (`RushRoom` with KIND/DIST statics): relays pos{d, x=state 0 run/1 quiz/2 trip/3 jump}, finish{time, extra=clean jumps}. Races ~30–55 s.

## Arrow Blitz rules
- One 1-minute round, up to 40. Type the shown arrow sequence (arrow keys/WASD; touch d-pad). Starts at 3 arrows, +1 after every completed sequence. Wrong key = shake + restart that sequence (length unchanged). Typed arrows turn solid yellow; Math Race dark grey background.
- Score: 10 per arrow of a completed sequence; +50% bonus on each sequence once the flawless streak (completed with no slip) is ≥ 3; any slip resets the streak. Arrows only for now (a 2nd mode may come later).
- Client-side play from a shared seed; server = `server/arrowroom.js`, a 1-round subclass of the Math Race room (MathRoom KIND/ROUNDS/ROUND_MS/MAX_SCORE statics; single-round rooms skip straight to `final`).

## Memory Tiles rules
- Up to 40 on a 5×5 board of black tiles. Each round: all tiles show pictures (7 s, −0.25 s per round, min 3.5 s) → flip back (1.2 s) → target picture shown → 7 s (constant) to move with arrows (only during this phase) onto a matching tile. Not on a match = OUT; if nobody matched, nobody is out. 2 different pictures in rounds 1–3, 3 in rounds 4–7, then 4 (max). Results shown 4.5 s. Last one standing wins; ranking by rounds survived.
- Server-authoritative (`shared/memory.js` Game in `server/memoryroom.js`); each player's position is sent ONLY to them (`me{x,y}`) until the round's `result`, which reveals everyone (avatars laid out in a mini-grid per tile, never stacked). Solo mode vs 7 bots runs the same Game in the browser.

## Odds or Evens (smart-board game, no server)
- `public/odds-evens/index.html`, fully client-side. Teacher enters names (optional) or a class size (2–40) and a number range (1–20 / 1–100 / 1–999); students are shuffled into a play order, ONE at a time. After each 15 s turn the next player gets a 10 s window to come up and pick EVENS or ODDS (random pick + auto-start at 0), so 40 students ≈ 19 min. Gentle pacing: one big bubble every 1.3 s (sometimes 2 after 8 s), low gravity. Right type +10, wrong type −5 (score never below 0) with a "7 is odd!" correction. ~70% of bubbles are the chosen type. Final board names only the top max(3, 15%) players. Names are never saved or sent. `?play=teacher` opens setup, `?play=try` a practice round.

## Teacher Mode (all six 40-player games: math, arrows, rush, hurdle, bear, memory)
- A private room's host sends `teacher{}` (menu button "🍎 Teacher mode", or `?play=teacher`). Shared core is `RoomBase.makeTeacher()`: the teacher never plays, isn't ranked or counted, auto-start is off, only the teacher can start; public rooms refuse it. Lobby/start/go messages carry `teacher`.
- Teacher views: Math/Arrow = class timer then boards · Rush/Hurdle = live standings board (`classView`; only the top max(3, 15 %) are named, everyone else is a "+N more still racing" count so nobody is singled out) · Bear/Memory = watch the whole game. Tested by `scripts/teacher-test.js`.
- Home page has a "For teachers" section (3 steps + one card per whole-class game with "Start as teacher") and a "🍎 Whole class" library filter.

## Room codes
- `server/codes.js`: 4 letters from consonants only (BCDFGHJKLMNPQRSTVWXZ: no vowels, so no words) + a blocklist of rude vowel-less abbreviations + no triple letters. `scripts/codes-test.js` checks all 160,000 codes (~142k allowed).

## Shared UI / rooms
- Both games: tiny ✕ circle fixed top-right (and Esc). On the game menu → hub; anywhere else → leave match/room and return to that game's menu.
- Rooms close immediately when every player has LEFT (lobby or mid-game). A mid-game room only waits (45 s) if someone DROPPED and may reconnect (`canReconnect()`).

## Protocol (JSON over WebSocket)
- Client → server: `hello{name,token}` `quick{game}` `create{game}` `join{code}` `leave` · CG: `ready{v}` `input{d}` · Math: `start` `score{round,n}`
- Math server → client: `lobby{players,host,autoIn,…}` `round{n,of,seed,in,dur}` `results{n,rank,next,last}` `final{rank}`
- CG server → client: `welcome{token}` `joined{code,game,slot}` `lobby{slots,…}` `start{players}` `floor{grid,theme}` `s{s:snapshot,e:events}` `error`

## Next up (see docs/DEPLOY.md roadmap)
- Local prediction for the local player online (biggest feel improvement).
- Juice: shake, particles, transitions, SFX.

## Shared hub frame
- Every game and /teacher/ loads `/assets/hub-frame.js`. On a game's menu (`#exitBtn` title starts "Back to game hub") it shows the hub bar (brand, current game, All games menu, Teachers link); during play only the hub-styled `#exitBtn` shows. `data-always` keeps the bar on (teacher page); `data-pad` moves `.screen` below the bar (math-race, arrow-blitz). New games: add the script tag, an `#exitBtn` that toggles its title, and an entry in the GAMES list inside hub-frame.js.

## Typing Cowboys rules
- `public/typing-cowboys/`. Each player's cowboy rides its own lane (carnival derby). Type the word: an exact match advances automatically (no Space). Space/Enter on a wrong word = next word, no penalty, horse doesn't move. 22 correct words to finish (~1 min at 20 wpm; words avg ~4.2 letters).
- `shared/typing.js` = word list (kid-safe), seeded list (same words for everyone), bots (served at /typing.js). Server = `server/typingroom.js`, a `RushRoom` subclass: pos{d=words}, finish{time, extra=words missed}. `AFTER_FIRST` = 4 min so the race waits for slower typists (6 min hard cap); results show the top max(3, 15 %).
- Shows up to 8 lanes: you, the top 3 and the riders nearest you. Teacher mode = live standings board.

## Star Cannons rules
- `public/star-cannons/`. Server-authoritative like Bear Attack: `shared/cannons.js` (served at /cannons.js, also runs solo in the browser) + `server/cannonroom.js`. Client sends in{x:-1|0|1}; server sends s{s,e} 20×/s.
- Every cannon fires a constant beam straight up; it hits the LOWEST asteroid/power-up above it (continuous damage, `T.dps`/s, x2.2 with rapid fire). Points = damage dealt. Asteroids show HP, bounce to a fixed height per size, split into two smaller ones at 0 HP. HP scales with sqrt(players alive) and time.
- An asteroid touching a cannon knocks it out (shield absorbs one). Power-ups (rapid, shield, freeze, bomb) go to the first beam that reaches them (+25). No time limit: game ends when every cannon is out; bots last ~2.5–4 min. Results rank by points, top max(3, 15 %).
- Teacher mode: the teacher watches the whole field (no cannon).

## Dart Party rules
- `public/dart-party/`. Server-authoritative: `shared/darts.js` (served at /darts.js, also runs solo) + `server/dartroom.js`. Client sends in{x,y} (8-way, on change) and fire{}; snapshot s{s,e} 20×/s (includes trees `tr`).
- Top-down field (y down). Moving turns you to face that way (8 directions); Enter/Space throws a dart straight ahead, 2 s reload; darts only fly ``T.range`` = 18 units (the aim arrow shows the reach). Darts stop at trees, never hit players. Everyone starts clustered in the middle.
- Balloons drift in from the edges: red 1 pt, big 1 pt, blue 2 pts (fast), gold 5 pts (rare, fastest). Spawn rate and cap scale with player count. First to `T.target` = 20 points ends it; results rank by points, top max(3, 15 %).
- Touch: on-screen joystick (snapped to 8 directions) + THROW button. Solo bots get `lazy` so a human can win (~60–90 s).
