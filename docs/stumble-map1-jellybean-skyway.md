# Map 1: Jellybean Skyway (design draft)

A candy road floating through a purple and blue sky. It is about **600 m** long, with **9 rooms** and **8 math veils** (2 questions each by default, so 16 questions), and runs about **2 minutes** without questions.
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

## Rooms (revision 2: 9 rooms, 8 veils, fewer piece types)
To keep the build small, five piece types were cut as the hardest to build: rotating discs, rolling gumballs, pendulums, sweepers and sliding gates.
All of them need moving solids that push the character controller. They can come back on a later map.

**Pieces Map 1 uses (8):**
- hop walls, gaps, moving platforms (already built)
- bounce pads, conveyor belts, jelly doors, split routes, dive-shortcut gaps

d is the distance along the course in metres, and each room is about 66 m:

| # | Room | d (m) | Idea | Phase | Est. time |
|---|---|---|---|---|---|
| 1 | **Launch Pad** | 0–66 | Wide plaza, three rows of low hop walls | teach jump | 12 s |
| 2 | **Jellybean Gaps** | 66–132 | Four 2–3 m gaps; a candy floor under the first one | teach gaps | 13 s |
| 3 | **Bounce House** | 132–198 | Yellow pads launch you onto an upper deck; a ramp around is the easy route | teach pads + split | 13 s |
| 4 | **Cloud Ferry** | 198–264 | Moving platforms carry you across a big gap | test timing | 15 s |
| 5 | **Treadmill Trouble** | 264–330 | Belts push you backward, then sideways; hop walls on the belts | teach belts, twist jump | 14 s |
| 6 | **Jelly Doors** | 330–396 | Two walls of 5 doors, some of which jiggle and bounce you back gently | light luck | 12 s |
| 7 | **Fork in the Road** | 396–462 | Left: a slow belt (safe). Right: a narrow beam with gaps and a dive shortcut (fast). They merge | split + dive | 13 s |
| 8 | **Bounce & Ferry** | 462–528 | Pads that launch you onto moving platforms | twist pads + ferry | 14 s |
| 9 | **Super Bounce → Finish Parade** | 528–600 | A chain of pads over the last gap, then a wide downhill to the arch with confetti. No veil | finale | 12 s |

That totals about **2 min**. The **8 veils** sit at the end of rooms 1–8, about every 13 s.

## Veil behaviour (agreed)
- A blue see-through curtain spans the full width and full height at its depth. You can't avoid it.
- **Touching it:**
  - Your bean freezes in place and a question pops up, with the same rules as Hurdle Dash: checked on the last digit, Backspace works, and a wrong answer shows the right one and gives a new question.
  - Right: the veil turns off for you (ghosts walk through it anyway), with a ✓ and a little forward hop. The veil is now your checkpoint.
- Other players see a bean frozen at the veil with a small "?" bubble (new anim state `a=5`).
- **Questions per veil:** the teacher sets this in the lobby; the default is 2. You pass after that many right answers.
- Questions come from the race seed, so everyone gets the same questions in the same order. Teacher modes and digits come from Math Race.

## Swapping maps later
- **Map data:** `shared/stumble-maps.js` holds a registry `MAPS = { "jellybean-skyway": {…}, … }`. Each map is pure data:
  - `id`, `name`, `theme` colours, `length`
  - `rooms[]`, each listing its pieces: floors, blocks, rails, pads, gates, sweepers, pendulums, discs, belts, doors, movers
  - `veils[]` (depths), spawns and finish
- **Motion:** every moving part is a pure function of (piece, race time), so every screen agrees without the server.
- **Server:** the server only needs `length` and the map `id`. The lobby gets a `map` choice later; for now it's always Map 1. `go` carries `map`.
- **Client:** the client builds meshes and physics from the data with one builder per piece type. A new map is then mostly a new data file, plus a new builder only when it adds a new piece type.
