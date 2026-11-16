// Arrow Blitz room: Math Race flow with one 1-minute round. Every browser plays locally from the
// shared seed and reports one score; the server ranks them.
"use strict";
const { MathRoom }=require("./mathroom");
const env=(k,d)=>+process.env[k]||d;
class ArrowRoom extends MathRoom {}
ArrowRoom.KIND="arrows"; ArrowRoom.ROUNDS=1; ArrowRoom.ROUND_MS=env("ARROW_ROUND_MS",60000); ArrowRoom.MAX_SCORE=99999; ArrowRoom.MODES=["arrows"]; ArrowRoom.DIGITS=false; ArrowRoom.UNIT="pts";
module.exports={ ArrowRoom };
