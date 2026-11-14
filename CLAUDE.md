# Joshua Game Hub — project context

Browser multiplayer games at joshuagamehub.website: **Clean Getaway** (4-player chase, Pac-Man Vs.-style) and **Math Race** (up to 40 players, speed addition) **SPLAT!** (2–6 player kids party game) and **Rush Hour** (up to 40, lane racing).
Priorities: visuals and gameplay feel. Security is low priority (no accounts, usernames only). Target ≤ 50 concurrent players.

## Clean Getaway rules
- 4 players, public or private lobby. A random rotation decides who's the Thief ("It"); everyone gets one turn.
- The Thief has 3 lives per turn. Getting caught resets everyone's positions, but cash already collected on that floor stays collected. Losing the last life ends the turn.
- The Thief collects every cash stack to clear a floor. A new floor is generated, then a 3-2-1 countdown.
- Guards (the other 3 players) catch the Thief by colliding with them.
- Gold bar = EMP (4.5 s): guards slowed to 60%, and the Thief can tackle them, which sends them back to their post after 3 s.
- Score: +10 per second survived, +10 per cash stack, +500 per floor cleared, +200 per tackle, +300 for catching the Thief (guard).
- Speeds: guards 3.1 tiles/s, Thief 3.45 tiles/s. Floors get +4% guard speed for each floor cleared this turn.

## Math Race rules
- Lobby up to 40. Host (first player, ★) starts; every lobby (public or private) auto-starts 30 s after a 2nd player joins. 3 rounds × 1 min, each preceded by a 3-2-1 countdown; 9 s round leaderboard.
- Addition of 1–2 digit numbers, answers always 2–3 digits. Answer is checked the moment it has as many digits as the correct answer — no Enter, no backspace. Wrong = shake + 3 s penalty (shows the right answer), then next question.
- **All questions and checking are client-side by design (no anti-cheat).** Server sends one seed per round (everyone gets the same questions) and receives one number per player per round.
- Round leaderboard shows top max(3, ceil(15%)) (6 for 40). Final shows a podium + the same count, ranked by total.
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
- Turn: up to 3 throws. Hiders pick barrel Left/Up/Right behind a sheet (10 s, 5 s, 3 s; changeable; random if none). Sheet lifts; thrower picks (4 s, random after). Hit hiders sit out the rest of the turn. Turn ends early if all are hit. ≈30–40 s per turn.
- Points: +10 per throw dodged, +20 per player splatted (balanced: equal expected points throwing vs hiding at any lobby size).
- Server-authoritative; hiding spots are never sent to the thrower. `server/splatroom.js`, `public/splat/index.html`, timings overridable via SPLAT_*_MS.

## Rush Hour rules
- Up to 40 racers, 3-lane road, chase camera (Three.js r128 from cdnjs). Controls: Left/Right lane change, Down = brake (hold). Touch: on-screen ◀ ▼ ▶ + swipes. Solo mode vs 7 ghost bots.
- Players never collide with each other (others are translucent ghosts). NPCs: red cars, blue trucks, white semis — all slower than players. Rear-end = big slowdown + short stun; sideswipe = smaller slowdown + pushed back to your lane. Glowing boost strips = +12 m/s fading over 1 s.
- `shared/rush.js` holds ALL tuning + physics + traffic + bot AI (used by browser, bots and `scripts/rush-balance.js`). Traffic comes from the race seed; each NPC appears SPAWN (180 m) ahead of each racer at its fixed spot, so everyone meets the same traffic at the same place.
- Catch-up is a smooth function of METRES BEHIND THE LEADER (never of place): more top speed/accel, softer bumps, and a vehicle you're stuck behind drives away sooner. Balance (run `node scripts/rush-balance.js`): 4,400 m ≈ 2:00–2:05 median; first→last spread median ~9–11 s, worst ~15 s (target ≤ ~25 s).
- Server (`server/rushroom.js`) only relays positions (~10/s) and ranks finish times (unfinished → by distance); race closes 45 s after the winner. Results: top max(3, 15 %) + your place.

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
