# Clean Getaway — project context

4-player browser chase game (Pac-Man Vs.-style) for itch.io / my own games site.
Priorities: visuals and gameplay feel. Security is low priority (no accounts, usernames only). Target ≤ 50 concurrent players.

## Game rules
- 4 players, public or private lobby. A random rotation decides who's the Thief ("It"); everyone gets one turn.
- The Thief has 3 lives per turn. Getting caught resets everyone's positions, but cash already collected on that floor stays collected. Losing the last life ends the turn.
- The Thief collects every cash stack to clear a floor. A new floor is generated, then a 3-2-1 countdown.
- Guards (the other 3 players) catch the Thief by colliding with them.
- Gold bar = EMP (4.5 s): guards slowed to 60%, and the Thief can tackle them, which sends them back to their post after 3 s.
- Score: +10 per second survived, +10 per cash stack, +500 per floor cleared, +200 per tackle, +300 for catching the Thief (guard).
- Speeds: guards 3.1 tiles/s, Thief 3.45 tiles/s. Floors get +4% guard speed for each floor cleared this turn.

## Layout
- `shared/sim.js`: the whole game simulation (map gen, movement, bots, rules, snapshots). UMD module: `window.CG` in the browser, `require` on the server. No DOM, no text. It emits events (`turn`, `caught`, `emp`, …) and the client turns them into UI. **Change gameplay here; client and server both use it.**
- `public/index.html`: client. Renders a "view": the local `CG.Game` (VS BOTS mode) or a `NetView` built from server snapshots with ~60 ms interpolation. Pixel art, HUD, menus and lobby all live here. Player names are always escaped.
- `server/index.js`: game server (WebSocket gateway + room hosting, also serves the client). `server/room.js`: authoritative room at 30 Hz. `server/bus.js`: Redis pub/sub + keys, with an in-memory fallback when `REDIS_URL` is unset. `server/web.js`: static-only frontend service.
- `railway.game.json` / `railway.web.json`: config-as-code for the two Railway services. Full guide: `docs/DEPLOY.md`.
- `npm run dev` (one process, localhost:8080) · `npm test` (headless bot match + end-to-end lobby/reconnect test).

## Protocol (JSON over WebSocket)
- Client → server: `hello{name,token}` `quick` `create` `join{code}` `ready{v}` `input{d}` `leave`
- Server → client: `welcome{token}` `joined{code,slot}` `lobby{slots,…}` `start{players}` `floor{grid,theme}` `s{s:snapshot,e:events}` `error`

## Next up (see docs/DEPLOY.md roadmap)
- Local prediction for the local player online (biggest feel improvement).
- Juice: shake, particles, transitions, SFX.
