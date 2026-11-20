# Joshua Game Hub — project context

Browser multiplayer games at joshuagamehub.website: **Clean Getaway** (5-player chase, Pac-Man Vs.-style) and **Math Race** (up to 40 players, speed addition) **Rush Hour** (up to 40, lane racing) **Bear Attack!** (up to 40, top-down ice survival) **Hurdle Dash** (up to 40, tap-to-run + Math Race quizzes at hurdles) **Arrow Blitz** (up to 40, 1-minute arrow sequences) **Memory Tiles** (up to 40, remember-the-picture survival) **Typing Cowboys** (up to 40, carnival-derby typing race) **Star Cannons** (up to 40, co-op laser cannons vs bouncing asteroids) **Dart Party** (up to 40, walk-to-aim dart throwing at balloons) **Sky Climb** (up to 40, flap-to-fly race to the top with player bumping) **Word Rush** (up to 40, live shared word search) and **Marble Munch** (up to 40, chomp marbles + math questions).
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
- Modes (host picks in the lobby; practice has its own picker): add · sub (20–99 minus a smaller number, answers ≥ 10) · mul (2–12 × 2–12) · div (whole answers, dividend ≤ 99) · money (add two prices up to $9.95, 5¢ steps; type the cents, shown in a $_.__ mask). Outside money, no operand is ever more than 2 digits; answers may be 3. Round msg carries `mode`. Layout: the BIGGER number is always on top in every mode (for ÷ that's the dividend). Hurdle Dash sums also put the bigger number on top.
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
- Shows up to 8 lanes: you, the top 3 and the riders nearest you. Teacher mode = THE WHOLE RACE on the big screen: every student's horse in its own lane with lane number + nickname (2 columns above 16 riders), small header with timer and "N of M finished"; late joiners get a lane.

## Star Cannons rules
- `public/star-cannons/`. Server-authoritative like Bear Attack: `shared/cannons.js` (served at /cannons.js, also runs solo in the browser) + `server/cannonroom.js`. Client sends in{x:-1|0|1}; server sends s{s,e} 20×/s.
- Every cannon fires a constant beam straight up; it hits the LOWEST asteroid/power-up above it (continuous damage, `T.dps`/s, x2.2 with rapid fire). Points = damage dealt. Asteroids show HP, bounce to a fixed height per size, split into two smaller ones at 0 HP. HP scales with sqrt(players alive) and time.
- An asteroid touching a cannon knocks it out (shield absorbs one). Final blow on an asteroid = bonus ``T.lastHit`` × size (5–25). Power-ups (rapid, shield, freeze, bomb, and +1 laser: permanent, stacks to 5, each laser = one more full beam of damage; twice as likely as the others) go to the first beam that reaches them (+25). No time limit: game ends when every cannon is out; bots last ~2.5–4 min. Results rank by points, top max(3, 15 %).
- Teacher mode: the teacher watches the whole field (no cannon).

## Dart Party rules
- `public/dart-party/`. Server-authoritative: `shared/darts.js` (served at /darts.js, also runs solo) + `server/dartroom.js`. Client sends in{x,y} (8-way, on change) and fire{}; snapshot s{s,e} 20×/s (includes trees `tr`).
- Top-down field (y down). Moving turns you to face that way (8 directions); Enter/Space throws a dart straight ahead, 2 s reload; darts only fly ``T.range`` = 18 units (the aim arrow shows the reach). Darts stop at trees, never hit players. Everyone starts clustered in the middle.
- Balloons drift in from the edges: red 1 pt, big 1 pt, blue 2 pts (fast), gold 5 pts (rare, fastest). Spawn rate and cap scale with player count. First to `T.target` = 20 points ends it; results rank by points, top max(3, 15 %).
- Touch: on-screen joystick (snapped to 8 directions) + THROW button. Solo bots get `lazy` so a human can win (~60–90 s).

## Sky Climb rules
- `public/sky-climb/`. Server-authoritative: `shared/sky.js` (served at /sky.js; also solo + own-flyer prediction) + `server/skyroom.js`. Client sends in{x:-1|0|1} (steer) and fire{} (flap). start{} carries `seed`; the level (ledges, stone blocks, buzzers) is a pure function of (seed, time) so clients draw it locally; snapshots carry only players.
- Flap = Space/↑/W, steer ←→. World wraps left↔right. Each row (every 11 units) is a SOLID stone floor with 2–3 gaps to fly through; difficulty (gap width, extra blocks, buzzers) stays at the bottom-row level all the way up (it used to ramp up and got too hard at the top); extra floating stone chunks are never placed above/below a gap so every gap stays flyable. Only ~1 row in 10 has a one-way ledge (fly up through, land on top). 1–3 buzzers per row. Buzzers stun 0.9 s and knock you down. Nobody is ever out.
- Player bumps: hit someone from below → they're pushed UP; land on someone from above → they're pushed DOWN; side hits bounce. Everyone starts spread along the floor.
- Finish at `T.goal` = 640. Game ends when every connected player is up (or 7 min). Perfect bots ~2.5–3 min; aimed at ~4 min for real classes. Results by finish time, unfinished by best height; top max(3, 15 %).

## Word Rush rules
- `public/word-rush/`. One giant 30×18 word search (`shared/wordsearch.js`, served at /wordsearch.js; also solo vs bots) + `server/wordroom.js`. 28 words from one kid-safe theme (Animals, Space, Food, Sports, Nature, School), any of 8 directions. Filler letters are re-rolled until no blocklisted word appears in any direction.
- Drag across a word (snaps to 8 directions). The client checks locally, then sends claim{a:[r0,c0,r1,c1]}; the server awards the FIRST valid claim and broadcasts f{i,pid,a,pts} so it lights up on every screen in the finder's colour; late claimers get miss{}. Points = word length. Ends when every word is found or after 6 min. Results top max(3, 15 %).
- Player colours: `WORDS.color(i)` "star pattern": hue order 0°,180°,90°,270°,45°… (van der Corput), new lightness every 12 players; `WORDS.ink(i)` picks readable text. The teacher never takes a colour.
- Teacher word lists: in the teacher lobby the teacher can paste their own words (title + words split by newline, comma or ;). `WORDS.cleanList` keeps letters only, 3–15 long, unique, max 40 (needs ≥3, else random theme); sent as words{text,title} (teacher only, lobby only), confirmed by wordsOk{n,title,skipped}, and sent again on Start. Remembered in localStorage. Words that can't fit are dropped.
- Teacher mode: the teacher's screen shows NO board, only a full-screen word bank (4 columns, big type, finder colour + name on found words), theme, timer and top finders (`body.big`); students' screens drop the bank (`body.slim`) so the board fills the screen and they read the words off the big screen.

## Hub live previews (?demo=1)
- The rotating featured showcase is gone. Each library card's picture becomes a LIVE BOT MATCH when focused (mouse hover / keyboard focus; on touch screens, the card nearest the middle while scrolling): an iframe of the game page at `?demo=1` (960×676, scaled to fit). One feed at a time, removed on leave, reloaded every 75 s. Games opt in with `demo:true` in GAMES.
- `?demo=1` makes `hub-frame.js` hide the bar, menus, buttons and touch controls and block input; each game's own `DEMO` hook starts a bots-only solo/practice match (your seat played by a bot or autoplayer) and restarts it after results. No WebSocket, no server load beyond cached static files.
- No demo: Odds or Evens (smart-board turns); it keeps its picture.

## Classroom flow rules
- Landing page asks "Who's playing?": Student · Teacher · (small) Play as Guest. The choice is saved as `jgh_mode`; every game's Back button returns to `/#<mode>`.
- Student view: name first (first name, last initial, nickname → `jgh_student`), then one big focused code box. In teacher rooms ClassKit sends this profile automatically, so students never see the name popup.
- Student mode replaces each game's menu with: name · how to play · Join friends + code · Make a game · Quick join (ClassKit `studentMenu`).
- Teacher view: compact list of whole-class games, each with "Open a Lobby" (`?play=teacher`).
- Teacher rooms: students without a name show as "⏳ Joining…"; Start runs a 10 s countdown on every screen (press again to start now); a live leaderboard + join code shows on the teacher's screen (top 3 or 15% only), each student sees their own score.
- Late joiners (EVERY online game, tested by `scripts/latejoin-test.js`): Math Race/Arrow Blitz jump into the current round; races (incl. Mathsketball) start from 0; Word Rush/Darts/Sky/Cannons add a new player; Bear Attack drops a new skater onto the ice away from the bear and its path (`Game.addPlayer`); Memory Tiles adds them on a random tile and the round they join in never counts against them (`safeRound`); Clean Getaway lets them take over a bot seat mid-match.
- Math Race + Hurdle Dash: teacher picks 1 digit (default), 1 & 2 digits, or 2 digits. Backspace works. Hurdle Dash: no falling; a wrong answer shows the right one and gives a new sum.
- Any screen that appears ignores taps for 1 s (hub-frame tap guard).

## Site analytics (/admin/)
- `server/stats.js`: own-server daily counts only (no cookies, no third parties, nothing per person), flushed to `daily_stats` once a minute. Metrics: `view:<page>[?play]` (pages POST `/api/hit` from hub-frame.js / the hub, since pages may come from the web service), `mode:<student|teacher|guest>` (hub button presses), `room:<game>:<public|private>`, `teach:<game>`, `play:<game>` (games started, detected in `RoomBase.register`), `join:<game>`, `peak` (most connections at once). Only whitelisted pages/modes are stored.
- `/admin/` page reads `GET /api/admin/stats?days=N`: signed-in teacher whose email is in `ADMIN_EMAILS` (game service env, comma list). Tested by `scripts/stats-test.js`.
- Admin is split into pages sharing `public/admin/admin.css` + `admin.js` (nav, sign-in gate, `api()`): `/admin/` analytics · `/admin/teachers/` · `/admin/schools/` (schools + tournaments). The old `/admin/#teachers` link redirects.
- `/admin/teachers/` page: every teacher account (`GET /api/admin/teachers`: school, classes, students, saved games, last sign-in) with **View as**: `POST /api/admin/teachers/:id/view` makes a 2 h READ-ONLY session (`auth_sessions.viewed_by` = admin id). It opens `/teacher/?viewas=<token>` in a new tab; the token lives only in that tab's sessionStorage (your own sign-in is untouched), a banner shows who you're viewing, the server refuses every non-GET call, the token is never an admin token, and the WebSocket ignores it (nothing auto-saves).
- `EMAIL_VERIFY=off` (game service env, temporary): typing an email on /teacher/ signs straight in, no link. Remove it once RESEND_API_KEY + MAIL_FROM are set.

## Castles, schools & tournaments
- Every SAVED Teacher Mode game adds bricks to the castle of the teacher who ran it (`teachers.bricks`, `castle_games`; only ever goes up). `CD.saveSession` → `{ id, bricks, won }`; `classresults` carries `bricks` (+ `won` = tournament name).
- Bricks = each game's raw score made "higher is better" (`CD.rawValues`: races = 100 + 100×fastest/your time if finished, else % of course), divided by that game's running average over ALL saved students (`game_scale` table, starts from a `PRIOR` guess with weight 30) → an average result ≈ 100 bricks in ANY game, capped at 400 per student. Stored on `game_sessions.bricks` / `session_results.bricks`.
- Castle art: `public/assets/castle.js` (`Castle.level(bricks)`, `Castle.svg`, `Castle.card`). Level n starts at 500·n·(n−1) bricks; 12 named stages (Campsite → Royal Castle), then "Legendary ★k" with fireworks. Each level adds one piece; the next piece shows as a grey blueprint. Big gold LEVEL badge on every card.
- Schools live in the `schools` table (seeded once from `server/schools.json`), cached 30 s in `CD.loadSchools()`; admins add/rename/remove on `/admin/schools/` (remove refused while a teacher uses it). Students MUST pick a school (hub profile + ClassKit "who are you?", pre-selected to the teacher's school via `whoareyou.school`); stored in `jgh_student.school` and `students.school_id`.
- `/school/?id=<school>` (public, `GET /api/school/:id`): every castle at the school (display names only, no emails), the live tournament race and past winners. Students reach it from the hub button "See your school's castles"; teachers from their dashboard castle card.
- Tournaments (`tournaments` table, admin-only, one live per school): castles race from 0 to `goal`; only bricks from games saved after the start count (`game_sessions.saved_at`). The first teacher to reach the goal wins (atomic update in `CD.checkTournament`); admins can end one early (no winner). Tested by `scripts/castle-test.js`.

## Mathsketball rules
- `public/mathsketball/` (kind `hoops`). Up to 40, teacher mode. Cycle: answer 3 questions right (Math Race generator, modes add/sub/mul/div/money + teacher digits; checked on last digit, wrong = red flash + quick shake (<0.5 s), input clears, SAME question until right (no answer shown, no skipping)) → 3 shots → repeat until the basket goal (host/teacher picks 6–50 in the lobby, default 10; sent as `goal{goal}`, carried as lobby `goal` and go `dist`).
- Shot: needle sweeps left→right→left (ping-pong) over a smooth red→yellow→GREEN (middle)→yellow→red gradient; Space/SHOOT/tap stops it. Zones by distance from the middle: green ≤ .05 (93 %), yellow ≤ .2 (75→30 %), red beyond (22→2 %). Meter gets slightly faster per basket.
- `shared/hoops.js` (rules + bots, served at /hoops.js) + `server/hoopsroom.js` (a `RushRoom` subclass with MODES + END_FRAC). pos{d=baskets, x=0 quiz/1 shooting}, finish{time, extra=shots}. Round ends for everyone when 60 % of the class reaches the goal (solo: 5 of 8). Results/teacher board: top max(3, 15 %). Tested by `scripts/hoops-test.js`.

## Bots & the online count
- `STATS.isBot(ua)` (server/stats.js): crawler / link-preview / headless / script user agents. Their WebSockets are refused (close 1008) and their `/api/hit` page views are ignored. Real browsers (incl. Chromebooks, iPads) pass.
- "Online" (hub count via `/health` `connections`, and the admin "Peak online") counts only sockets that are IN A ROOM, never bare open sockets. Tested by `scripts/bots-test.js`.

## Admin "Live now" + spectators
- `/admin/live/` (admins only, `GET /api/admin/live`, polled every 3 s): every room open on THIS game-server instance (`RoomBase.adminInfo()`): game, code, state, public/private, open time, teacher account (name, email, school, class), settings (mode/digits/goal), each player (nickname, student first name + last initial, school, connected, live progress from `liveRows`), watcher count.
- Spectate: a game page opened with `?spectate=CODE&pid=N&who=Name` — `hub-frame.js` wraps `WebSocket` so the page's `hello` becomes `spectate{code,pid,auth}` and every other outgoing message is dropped; it then presses the page's own Join button. The server checks the admin token, marks the socket `spectator`, mirrors that player's directed messages (`c.spy` = their cid) and replays the relay's recent-message log (latest message per type per recipient, plus every `f`/`fin`/`addp`; countdowns adjusted) so a mid-game watcher catches up.
- Watchers are invisible and read-only: the room never hears about them (no join, no drop), they never count as online, and the server ignores everything they send except ping/leave. Own-device games (math, arrows, rush, hurdle, typing, hoops) can only be watched through the teacher's screen. Tested by `scripts/spectate-test.js`.

## Marble Munch rules
- `public/marble-munch/` (kind `munch`). Up to 40, teacher mode. Every player is a hippo on the rim of a round bowl (your hippo is always drawn at the bottom; the teacher sees the bowl unrotated). Marbles are let in a few at a time (3 per player, min 12; gap 0.75–1.6 s, at most max(6, 60 % of players) in the bowl) and roll on ellipses: pull toward the middle (stronger near the rim, so the ellipses slowly turn), steady energy per marble, a cap on sideways spin so every ellipse stays long and reaches the rim, bounce off the rim.
- Space / CHOMP / tap = ONE chomp per press (held key doesn't repeat): the head lunges up to `T.reach` into the bowl for 0.26 s. Hippos face the middle. Only a marble INSIDE the drawn open mouth is caught (`MUNCH.mouthAt` is used by both the rules and the drawing; jaws must be ≥ 30 % open) → a question (Math Race generator; modes add/sub/mul/div/money + teacher digits). Answer before the timer (host/teacher picks 2–10 s, default 4; `qtime{s}`) → you keep it; wrong or too slow → you spit it back into the bowl. Ends when every marble is kept (or 6 min). Results: by marbles, top max(3, 15 %).
- Server-authoritative: `shared/munch.js` (served at /munch.js; also solo vs 7 bots + hub demo) in `server/munchroom.js` at 40 Hz / 20 Hz snapshots. Client sends fire{} and ans{v}; the question goes ONLY to the catcher as q{q,sec} (never with the answer), the reply is res{ok}. Bot pacing: ~20 s (4 players), ~40 s (8), ~100 s (40). Tested by `scripts/munch-test.js`.

## Teacher passwords, recovery question, admin protection
- `server/auth.js`: passwords hashed with scrypt (N=2^15, r=8, p=1, 16-byte random salt, 64-byte key; stored as `s1$N$r$p$salt$key`), checked with `timingSafeEqual`. One recovery question from a fixed list (`A.QUESTIONS`); the answer is normalised (case/spaces/punctuation) and hashed the same way. Nothing secret is stored in plain text; all SQL is parameterised.
- Routes: `POST /api/auth/password` (sign in) · `/api/auth/register` (email + password + question + answer) · `/api/auth/recover/question` (unknown emails get a made-up but stable question, so it can't reveal accounts) · `/api/auth/recover` (answer → new password, signs out every other session, no email needed) · `POST /api/me/password` (set/change; changing needs the current password; signs out other sessions).
- Rules: ≥ 8 chars, not common, not containing the email name. Lockout: 8 wrong passwords/answers → 15 min. Rate limits per IP and per email. Unknown emails and wrong passwords get the same error.
- Older accounts (no password) can still sign in the old way ONCE (email link, or email-only while `EMAIL_VERIFY=off`), then the teacher page forces "Protect your account" (password + question). Once an account has a password, the email-only sign-in is refused for it, and email-only can no longer create accounts (use Create account). Google accounts don't need a password.
- `auth_sessions.method` = password · google · link · email · recover · view. Admin pages (and spectating) need `A.adminProblem(t)` to pass: admin email, a password/google/link/recover session (never email-only or view-as), opened in the last 12 h, no pending temporary password.
- Admin `/admin/teachers/` → Manage: edit name/email/school, unlock, temporary password (shown once; teacher must change it before doing anything else, `must_change`), sign out everywhere, delete (type the email; not yourself; cascades classes/students/games). Tested by `scripts/password-test.js`.

## Hub: Educational / Just for fun
- Student and Teacher views show a two-tab switch (📚 Educational by default every visit, 🎉 Just for fun; remembered for the tab in sessionStorage `jgh_kind`). `EDU` in `public/index.html` lists the learning games (math race, mathsketball, marble munch, hurdle dash, arrow blitz, typing cowboys, word rush, memory tiles, odds or evens); everything else is "Just for fun". Guest view shows the whole library.

## Ghost players (rooms that never close) — fixed
- Cause: `joinRoom` awaits several Redis round trips before publishing `join`. If the browser closed in that window, its `drop` reached the room BEFORE the join and was ignored, then the join added a player marked connected with no socket. Rooms only close when nobody is connected, so they stayed open forever (prod showed 3 sockets but 13 "connected" players in 9 rooms).
- Fix (`server/index.js`): sockets get `c.closed` on close; `joinRoom` skips if already closed and, if the socket closed while the join was in flight, publishes the drop again after the join. Safety net: every `GHOST_SWEEP_MS` (30 s) any room player still "connected" whose socket closed on THIS server (`closedCids`, kept 1 h) gets a drop.
- Also fixed `RedisBus.subscribe`: the handler is added before awaiting Redis (an unsubscribe during the await deleted the set → "reading 'add'" crash → failed join and a silent relay).
- `scripts/ghost-test.js` slows the in-memory bus to Redis speed (`BUS_TEST_DELAY_MS`) and slams sockets shut mid-join.
