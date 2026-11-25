# Map 1: Jellybean Skyway (design draft)

A candy road floating through a purple and blue sky. It is about **600 m** long, with **16 rooms** and **15 math veils**, and runs about **2 minutes** without questions.
It's one straight course. The camera never turns.

## Design rules for 3rd graders
1. **One new idea per room.** Each obstacle follows teach, then test, then twist, and the twist comes several rooms later.
2. **Teach rooms can't drop you.** A teach room has rails or a floor under it, so the first time you meet an obstacle, getting it wrong costs about a second, not a fall.
3. **A fall costs at most about 6 s.** Every veil is a checkpoint, so you lose at most one room.
4. **Timing windows of at least 1.2 s.** Every moving hazard is slow and readable. Nothing needs frame-perfect timing.
5. **Sized to the bean.**
   - Gaps: at most 3 m in normal rooms (a running jump reaches about 5 m). Dive-only gaps appear only on optional shortcuts.
   - Hop walls: 0.5 m tall.
   - Platforms: at least 4 m wide.
6. **Hazards knock you around, they never "kill".**
   - Sweepers, pendulums and jelly doors push you, using the existing bonk.
   - Only falling into the goo sends you back.
7. **Colour language, the same everywhere:**

| Colour | Means |
|---|---|
| Purple / lilac | Floor |
| Cyan | Solid blocks |
| Hot pink + white stripes | Things that move or push |
| Yellow | Bouncy (pads, jelly doors) |
| Glowing blue curtain | Math veil |
| Dark blue goo far below | Fall zone |

8. **Easy route vs. fast route.** Splits give a safe path and a faster, riskier one. Both cross every veil at the same depth: a veil is a full-width, full-height curtain across the whole course.

## Rooms
Each room is a reusable module, a short piece of course that the map lists in order. Here, d is the distance along the course in metres, and V is a veil. A veil sits at the end of every room except the last.

| # | Room | d (m) | Idea | Phase | Est. time |
|---|---|---|---|---|---|
| 1 | **Launch Pad** | 0–36 | Wide plaza with three rows of low hop walls | teach jump | 6 s |
| 2 | **Jellybean Gaps** | 36–74 | Three 2 m gaps, a candy floor under the first one | teach gaps | 7 s |
| 3 | **Bounce House** | 74–110 | Yellow pads launch you onto an upper deck; a ramp around is the easy route | teach pads + split | 7 s |
| 4 | **Sliding Gates** | 110–148 | Two pink walls slide slowly side to side, each with a wide opening | teach gates | 8 s |
| 5 | **The Sweeper** | 148–186 | One slow spinning arm on a round railed platform; jump it or get pushed | teach sweeper | 8 s |
| 6 | **Cloud Ferry** | 186–224 | Two moving platforms carry you across a big gap (already in the slice) | test timing | 9 s |
| 7 | **Fork in the Road** | 224–264 | Left: a slow conveyor that pushes you back (safe). Right: a narrow beam with two small gaps (fast). They merge | split | 8 s |
| 8 | **Bumper Swing** | 264–302 | Three big soft balls swing across; walls at the edges, so no falling | teach pendulums | 8 s |
| 9 | **Door Dash-ish** | 302–338 | A wall of 5 doors: 3 open, 2 jelly doors that bounce you back gently, then a second wall | luck (light) | 7 s |
| 10 | **Spin Cycle** | 338–376 | Three slowly rotating discs over goo, with a 1.5 m hop between them | teach discs | 8 s |
| 11 | **Double Sweep** | 376–414 | Two sweepers turning opposite ways, no rails | twist sweeper | 8 s |
| 12 | **Gate Gaps** | 414–452 | Sliding gates on islands, so you time a gap jump through a gate | twist gates + gaps | 8 s |
| 13 | **Pendulum Bridge** | 452–490 | Pendulums over a 5 m-wide bridge with half rails | twist pendulums | 8 s |
| 14 | **Super Bounce** | 490–530 | A chain of pads over a long gap; a dive gap down the middle is the shortcut | finale, fun | 7 s |
| 15 | **Candy Climb** | 530–568 | Wide stairs up, with rolling gumballs coming down the edges | breather + twist | 8 s |
| 16 | **Finish Parade** | 568–600 | A wide downhill to the arch, with confetti cannons. No veil | celebration | 5 s |

That totals about **2 min** (≈ 120 s). The veils sit at the end of rooms 1–15, so roughly every 7–8 seconds.

**Repeats:** gaps, gates, sweepers and pendulums each appear twice: taught first, then twisted later. Pads, discs and splits appear once or twice. Rooms 6, 9 and 15 are the breathers.

## Veil behaviour (agreed)
- A blue see-through curtain spans the full width and full height at its depth. You can't avoid it.
- **Touching it:**
  - Your bean freezes in place and a question pops up, with the same rules as Hurdle Dash: checked on the last digit, Backspace works, and a wrong answer shows the right one and gives a new question.
  - Right: the veil turns off for you (ghosts walk through it anyway), with a ✓ and a little forward hop. The veil is now your checkpoint.
- Other players see a bean frozen at the veil with a small "?" bubble (new anim state `a=5`).
- Questions come from the race seed, so everyone gets the same 15 in the same order. Teacher modes and digits come from Math Race.

## Swapping maps later
- **Map data:** `shared/stumble-maps.js` holds a registry `MAPS = { "jellybean-skyway": {…}, … }`. Each map is pure data:
  - `id`, `name`, `theme` colours, `length`
  - `rooms[]`, each listing its pieces: floors, blocks, rails, pads, gates, sweepers, pendulums, discs, belts, doors, movers
  - `veils[]` (depths), spawns and finish
- **Motion:** every moving part is a pure function of (piece, race time), so every screen agrees without the server.
- **Server:** the server only needs `length` and the map `id`. The lobby gets a `map` choice later; for now it's always Map 1. `go` carries `map`.
- **Client:** the client builds meshes and physics from the data with one builder per piece type. A new map is then mostly a new data file, plus a new builder only when it adds a new piece type.
