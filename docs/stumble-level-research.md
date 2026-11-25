# Bumbling Stumbling Math: level design research

Field notes for the full course. The goal is about 2 minutes of play without questions, plus about 15 math veils.

## What the genre teaches

**Mediatonic's design rules (Fall Guys developers, from interviews):**
- **Levels come from recombining a small obstacle set.** Designers start from the obstacles they already have and look for new ways to combine them. This is the main idea, rather than inventing something new every level.
- **One-sentence readability.** Every level must be explainable in one sentence, and playable with no tutorial.
- **About 80 % skill and 20 % chaos.** Most failures should feel earned. A sprinkle of randomness and player pile-ups keeps it funny.
- **Colour language.** Interactive and dangerous things get a consistent colour and pattern, so players know what they can touch at a glance.

**Classic race obstacles and how each is beaten:**

| Obstacle (genre) | What it does | How you beat it | Difficulty |
|---|---|---|---|
| Spinning sweeper bar | A long arm rotates low over a round platform | Jump it on timing (letting it hit you sometimes helps) | Easy to medium |
| Pendulums / wrecking balls | Swing across the path and knock you sideways | Read the timing and pass behind the swing | Medium |
| Sliding gates / walls | Walls with gaps slide side to side | Line up with a gap; jump at the end of a slope | Easy |
| Spinning platforms | Rotating discs you cross | Keep moving and aim jumps at the next disc | Medium |
| See-saws | Planks tilt under the players standing on them | Stay near the middle or run fast; crowds tip them | Medium, chaotic |
| Breakable vs fake doors | Rows of doors; some break, some bounce you back | Pick a door; luck plus watching others | Easy, mostly luck |
| Hidden tiles (memory path) | Grid where only some tiles are real | Remember or follow the path others found | Medium |
| Spinning hammers, sliding blocks | Clutter on a climb | Timing and routing | Medium |
| Rising slime (race variant) | Pressure from behind | Keep moving | (not for us) |
| Rolling balls, fans, conveyor belts, bounce pads | Push forces and launchers | Routing and timing | Easy to medium |

Stumble Guys race maps use the same set: hammers, spinning logs, rotating platforms, slippery ice where dives matter, and "cannon climb" verticality.

**Pacing rules from platformer design:**
- **Teach, test, twist.**
  - Teach: introduce a mechanic where failing is cheap.
  - Test: repeat it with a little pressure.
  - Twist: later, combine it with something the player already knows.
  - Space the twist out instead of placing it right after the test.
- **A staircase difficulty curve** with a short breather after each peak.
- **Checkpoints after a sequence** that teaches or tests something, used as pacing anchors.
- **Measure the bean before building:** jump height, jump length, dive length. Size every gap to those numbers, so gaps reward a good jump without feeling random.

## Our bean's measured limits (from `shared/stumble.js`)
- **Running:** 7.2 m/s. Jump take-off is 8.6 m/s with gravity 24, which gives about 1.5 m of height and about 5 m length at full speed.
- **Dive:** a 10.5 m/s burst, plus about 2–3 m more distance after a jump.
- **Sizing rules:**
  - Comfortable gap: at most 3.5 m (running jump). Dive-only gap: 5–6 m, used rarely.
  - Low walls: at most 0.6 m (hop).
- **Course length:** at about 2 min with obstacles slowing people to about 4.5–5 m/s on average, the course is roughly **550–650 m**. Today it is 160 m, about 25–30 s.

## Constraints from your brief
- **Veils:**
  - 15 track-wide veils. They are unavoidable, and every route crosses the same number of them.
  - Therefore routes may split only *between* veils and must merge back before the next one.
- **Questions:** the same as Hurdle Dash. You can't pass until the answer is right; a wrong answer shows the right one and gives a new question. The bean is frozen in place while the question is up.
- **Pacing:** 16 obstacle "rooms" between 15 veils. Each room is about 7–8 s of play, a nice short teach, test or twist beat.
- **Physics caveat:** Rapier's character controller isn't pushed by moving bodies automatically.
  - Knock-back from pendulums, sweepers and bumpers will be scripted impulses, like the existing "bonk".
  - Because the motion is a pure function of race time, every screen sees the same hit.

## Sources
- [GameSpot: How the developers make Fall Guys levels](https://gamespot.com/articles/fall-guys-heres-how-the-developers-make-its-levels/1100-6481433/)
- [GamesRadar: Mediatonic interview (skill vs chaos)](https://www.gamesradar.com/fall-guys-interview)
- [SCMP: Talking level design with the creators of Fall Guys](https://scmp.com/yp/discover/entertainment/tech-gaming/article/3104705/talking-level-design-creators-fall-guys)
- [Interview with Anthony Pepper, Senior Designer](https://waytoomany.games/2020/08/18/interview-with-anthony-pepper-senior-designer-behind-fall-guys/)
- [TheGamer: Complete guide to every Fall Guys round](https://www.thegamer.com/fall-guys-complete-guide/)
- [TheGamer: Best strategies for race rounds](https://www.thegamer.com/fall-guys-strategies-race-rounds/)
- [GameSpot: Fall Guys beginner's guide](https://www.gamespot.com/articles/fall-guys-beginners-guide-how-to-win-every-round/1100-6480981/)
- [Epic: Designing a Fall Guys obstacle course (UEFN)](https://dev.epicgames.com/documentation/en-us/fortnite/fall-guys-designing-an-obstacle-course-in-fortnite-creative)
- [BlueStacks: Stumble Guys maps guide](https://www.bluestacks.com/blog/game-guides/stumble-guys-multiplayer-royale/sg-maps-guide-en.html)
- [The Level Design Book: Pacing](https://book.leveldesignbook.com/process/preproduction/pacing)
- [Grave Danger: 2D platformer level design](https://gravedangergame.com/2d-platformer-level-design/)

The fan wiki, Epic's docs and GameSpot pages couldn't be opened from this sandbox (blocked hosts), so their details come from search summaries only.
