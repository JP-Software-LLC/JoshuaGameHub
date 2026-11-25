# Map 2: Gumdrop Gauntlet (plan)

Map 1 (Jellybean Skyway) stays as it is. Map 2 fixes what playtesting found, without raising the overall difficulty: a 3rd grader should still finish in about 2 minutes plus questions.

## Playtest complaints → fixes

| Complaint | Cause on Map 1 | Map 2 fix |
|---|---|---|
| Boring, not enough moving parts | Only ferries move; everything else is static | **Every room has at least one moving hazard.** New hazard system: sweepers, pendulums, sliding gates, pistons, spinning discs, rolling gumballs, seesaws |
| Too hard to get knocked off | Rails on almost every edge, and nothing pushes you | **Open edges by default**, with rails only on veil landings. Hazards **knock you back**, so they can push you off |
| No gambles | Only the jelly doors were luck | **Two gamble rooms** (Tip-Toe Tiles, Lucky Doors), plus risky shortcuts with a safe route beside them |
| Dead space | Long flat runs between ideas | Something to react to **at least every 10–12 m**; flat stretches only as veil landings |
| Repetitive | Same flat lilac deck, same kinds of rooms | **Nine different rooms**, more height changes (ramps, drops, raised islands), with each hazard used in one or two rooms |

The overall difficulty stays the same because the extra falls are cheap:
- A checkpoint at every veil plus one in the middle of each room, so a fall costs about 5 s.
- Hazards are slow and readable, with timing windows of at least 1.2 s.
- Target for a 3rd grader: **4–8 falls per run**. On Map 1 it was about 0–1.

## Design rules
1. **Every room has motion.** At least one moving hazard, and hazards that overlap in time so there's always something to watch.
2. **Edges are open.** Rails go only on the 6 m veil landing pads, which are the calm zones.
3. **Knock, don't kill.** A hit pushes you (impulse, short stumble). Only the goo sends you back.
4. **Gambles are fair.** Random elements are seeded from the race seed, so everyone faces the same layout, and other players' falls teach you the safe path. Every gamble has a slower safe route beside it.
5. **Veils are safe zones.** No hazard reaches within 6 m of a veil. A frozen bean (answering) can't be hit.
6. **Telegraph everything.**
   - Hot pink with white stripes means it moves or pushes.
   - Trapdoors and fake tiles wobble or blink for 0.8 s before they drop.
   - Pistons pull back before they punch.

## Rooms (about 600 m, 9 rooms, 8 veils at the end of rooms 1–8)

| # | Room | Moving parts | Gamble / risk | Teaches |
|---|---|---|---|---|
| 1 | **Spin Start** | One slow sweeper arm on a wide round deck, open edges | Jump it, or get swept toward the edge | Hazards knock you; edges are open |
| 2 | **Tip-Toe Tiles** | A grid of tiles where about 45 % are fake and wobble then drop (they reset after 3 s); pattern from the seed | **Gamble:** guess, or follow the people ahead | Watch others |
| 3 | **Pendulum Alley** | Four wrecking balls swinging over a 5 m bridge with no rails | Run under or wait; out of step so there's always a gap | Timing |
| 4 | **Gate Crash** | Three rows of sliding pink gates on small islands with gaps between | Thread a moving gap and jump the gap at the same time | Combining two skills |
| 5 | **Spin Cycle** | Three rotating discs that carry you; a small sweeper on the biggest one | Riding the spin vs. jumping off early | Moving footing |
| 6 | **Seesaw Sea** | Four rocking planks over goo, tilting on a timer, in a different rhythm each | **Gamble:** cross the high side now, or wait | Patience |
| 7 | **Gumball Hill** | A ramp uphill, with gumballs rolling down three lanes (times from the seed) and bumpers on the sides | Dodge lanes; a bumper can bounce you off | Reading lanes |
| 8 | **Lucky Doors & Trapdoors** | Floor panels drop in a blinking pattern, then a wall of 4 doors | **Gamble:** one door is a shortcut chute (seed), two are normal, one is jelly. Wrong guess = slower, not a fall | Risk vs. reward |
| 9 | **Hammer Finale** | Pistons punch sideways from both edges, then a big double sweeper before the finish arch | Pass between the punches | Everything at once |

That's roughly 12–14 s per room for a good player, about 2 min in total, the same as Map 1.

## Technical plan
**A hazard system** (the piece types cut from Map 1). Each hazard is pure data plus a pure function of race time, so every screen sees the same motion without the server.
- `shape(t)` gives where it is: segment (sweeper), sphere (pendulum, gumball), box (gate, piston, trapdoor, tile), or rotating box/disc.
- **Solid parts you can stand on** (discs, seesaws, gates, tiles) become Rapier kinematic bodies, moved to `shape(t)` each step like the ferries. Standing on a disc or seesaw carries you by its motion, the same way ferries do now.
- **Knock-back:** in `stepBean`, we test the bean capsule against each nearby hazard's shape analytically. A hit applies an impulse (direction = the hazard's velocity at the contact point, plus a little up), and puts you in a 0.5 s stumble with reduced control (the existing bonk, made stronger).
  - This replaces Rapier pushing, which the character controller can't do.
- **Ghosts** need nothing new: they follow relayed positions, and the hazards look the same on every screen.
- **Seeded random:** fake tiles, gumball schedules and the lucky door come from `rng(seed)`. The `go` message already carries the seed.
- **Bots:** each hazard type gets a small bot rule ("wait until the sweeper angle is safe", "follow a known tile path with some mistakes"), aiming for a bot median of about 110 s.

**Map picker:** a lobby option `map{id}` (host/teacher), offering *Jellybean Skyway (classic)* and *Gumdrop Gauntlet (wild)*. The server checks the id against the registry and sets DIST from that map's length.

## Build order (vertical first)
1. Hazard core, with one hazard of each kind (sweeper, pendulum, gate) in a test room. Check that knock-back feels fun and can push you off.
2. Solid moving footing: discs, seesaws, tiles and trapdoors.
3. Gumballs, pistons and the lucky doors.
4. Lay out the 9 rooms. Tune with bots for about 110 s, and target 4–8 falls for a "kid-skill" bot.
5. Map picker in the lobby, tests, docs, and a playtest with you.
