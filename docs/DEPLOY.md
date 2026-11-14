# Deploying Clean Getaway on Railway

Three services in one Railway project, all deployed from this one repo:

| Service | What it runs | Config file | Public domain |
|---|---|---|---|
| **web** | Static client (`npm run start:web`) | `/railway.web.json` | yes, e.g. `play.yourdomain.com` |
| **game** | WebSocket game server (`npm run start:game`) | `/railway.game.json` | yes, e.g. `game.yourdomain.com` |
| **Redis** | Railway's Redis template | — | no (private network only) |

```
 browser ──https──▶ web    (index.html, sim.js, config.js → "connect to wss://game…")
 browser ──wss────▶ game   (lobby + authoritative 30 Hz sim)
                    game ◀──pub/sub + keys──▶ Redis (private network)
```

## Setup (about 10 minutes)

1. **Push the repo to GitHub.**
2. **Create a Railway project**, then add **+ New → Database → Redis**.
3. **+ New → GitHub Repo →** this repo. Rename the service to `game`.
   - Settings → *Config-as-code* → Railway config file: `/railway.game.json`
   - Variables: `REDIS_URL` = `${{Redis.REDIS_URL}}`
   - Settings → Networking → **Generate Domain** (or add `game.yourdomain.com`).
4. **+ New → GitHub Repo →** the same repo again. Rename it to `web`.
   - Config file: `/railway.web.json`
   - Variables: `GAME_SERVER_URL` = `wss://${{game.RAILWAY_PUBLIC_DOMAIN}}`
   - Networking → Generate Domain, or add a custom domain like `play.yourdomain.com`. Railway shows the CNAME record to add at your DNS provider and issues TLS automatically.
5. Deploy. Check `https://<game domain>/health`. You should see `{"ok":true,"bus":"redis",…}`.
6. Open the web domain. Try **PUBLIC MATCH** in two browsers, and **PRIVATE ROOM** with **JOIN** by code.

Each service only redeploys when its own files change (`watchPatterns` in the config files). A change to `shared/sim.js` redeploys both, which is correct because client and server must run the same sim.

### Shortcut: one service only
The game server also serves the client. You can skip `web` and open the `game` domain directly. Keep `web` if you want the client on its own domain and redeploying separately from the game server, or if you plan to move the client to a CDN later.

### itch.io / Cloudflare Pages
`GAME_SERVER_URL=wss://game.yourdomain.com npm run build:static` writes a self-contained `dist/` folder. Zip it for itch.io (HTML5 game) or point Pages at it. It still connects to the Railway `game` service.

## How the multiplayer layer works

- **Server-authoritative.** Clients only send `input{d}` (a direction). The room's owner instance runs `shared/sim.js` at 30 Hz and publishes a ~220-byte snapshot each tick. The maze is sent once per floor, and cash pickups arrive as events.
- **Everything goes through the bus.** Each room has `cg:room:CODE:in` (joins, ready, inputs, drops) and `cg:room:CODE:out` (lobby, floor, snapshots). The instance that owns the socket relays `out` to its local players. This holds even with one instance, so adding replicas needs no code changes. Cross-instance play was tested: a player on instance B playing in a room hosted on instance A.
- **Redis keys:** `cg:room:CODE` (owner, state, humans; 60 s TTL, refreshed by the owner), `cg:open` (public lobbies with free seats), `cg:sess:TOKEN` (reconnect → room; 3 h TTL).
- **Identity:** no accounts. On first visit the server hands out a random token, stored in `localStorage`. Names are cleaned server-side (14 chars, letters, numbers and basic punctuation) and always rendered as text.
- **Matchmaking:** PUBLIC joins the first open public lobby or creates one. PRIVATE creates a 4-letter code. The match starts when every human in the room is ready, and bots fill the empty seats. A solo player can ready up and play against 3 bots.
- **Disconnects:** a bot takes over immediately. Reconnecting (automatic, with backoff) with the same token gives the player their seat back mid-match. A room with nobody connected is closed after 45 s.

## Capacity (target: 50 concurrent players)

- 50 players is about 13 rooms. A full 4-bot match simulates 6 minutes of play in about 0.5 s of CPU, so the sim itself is close to free.
- Traffic is about 13 rooms × 30 snapshots/s × ~250 B × 4 sockets, roughly 400 KB/s out at peak. Redis handles ~400 publishes/s.
- **One `game` replica is enough.** Leave `numReplicas: 1`. If you ever scale out, rooms already work across instances. The remaining work is sticky routing so a room's players prefer its owner instance, which saves a relay hop.
- `MAX_CONNECTIONS` (default 200) caps sockets per instance.
- Cost: three small always-on services. This should land around the Hobby plan's included usage. Check Railway's usage page after the first week.

## Local development

```
npm install
npm run dev            # http://localhost:8080 (client + server, in-memory bus)
npm test               # headless bot match + end-to-end lobby/reconnect test
REDIS_URL=redis://localhost:6379 npm run dev   # same, through a real Redis
```
To test multiplayer locally, open two browser windows (or one normal and one private, so they get different tokens).

## Roadmap (visuals and gameplay first)

1. **Local prediction for your own character.** Online, your character is currently drawn ~60 ms behind the newest snapshot, plus network delay. Running your own movement locally, using the shared `stepActor` and the known grid, and correcting from snapshots would make turns feel instant. This is the biggest gameplay-feel item.
2. **Juice:** screen shake on catch and tackle, particle "cash burst" on pickup, EMP shockwave ring, floor-clear wipe transition, animated countdown numbers.
3. **Audio:** short chiptune SFX for pickup, EMP, tackle, catch and clear, plus a mute toggle.
4. **Lobby polish:** character color picker, a "quick chat" emote wheel (no free text, which keeps moderation trivial), and an auto-start timer for public lobbies.
5. **Art pass:** swap the palette-string sprites for a CC0 pack or commissioned sheets. The renderer only needs `SPR[name]` canvases.
6. **Optional:** a public leaderboard of best scores per day in Redis (sorted set), keyed by username.
