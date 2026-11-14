// Hurdle Dash room: same flow as Rush Hour (each browser runs its own runner; the server relays
// positions ~10×/s and ranks finish times). pos.x carries the runner state: 0 run · 1 quiz · 2 trip · 3 jump.
// finish.extra = clean hurdle jumps (0–5).
"use strict";
const { RushRoom }=require("./rushroom");
const HURDLE=require("../shared/hurdle.js");
class HurdleRoom extends RushRoom {}
HurdleRoom.KIND="hurdle"; HurdleRoom.DIST=HURDLE.T.dist;
module.exports={ HurdleRoom };
