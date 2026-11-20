// Softball Smarts — shared rules (browser: window.SOFTBALL, Node: require). Needs HOOPS (shared/hoops.js) for the
// Math Race question generator (browser: load /hoops.js first).
// You're at the plate. The pitcher winds up and throws; time slows down and a question pops up. Answer before the
// ball reaches you (host/teacher picks 3–12 s, default 6). The FASTER you answer, the better the hit:
//   ≥ 60 % of the pitch left → HOME RUN · ≥ 40 % → triple · ≥ 20 % → double · otherwise → single.
// Wrong answer (checked on the last digit, like Math Race) or too slow → STRIKE (the right answer is shown).
// 3 strikes = out. 3 outs = the inning ends and the bases are cleared. Runners advance by the number of bases hit.
// First to the run goal (host picks 5–30, default 10) finishes. Online, the game ends when 60 % of the class is done.
// Question types today: math (add · sub · mul · div · money, + digits). Spelling / vocab can plug in later as new
// "kinds" that produce { prompt, check(typed) } questions.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hoops.js"));
  else root.SOFTBALL = factory(root.HOOPS);
})(typeof self !== "undefined" ? self : this, function (HOOPS) {
"use strict";

const T = {
  runs: 10, goalMin: 5, goalMax: 30,   // run goal
  pitch: 6, pitchMin: 3, pitchMax: 12, // seconds the ball takes to reach the plate (slow motion)
  windup: 1.1,                         // pitcher winds up (no question yet)
  hitT: 1.9,                           // ball flying after a hit
  strikeT: 1.3,                        // after a strike / too-slow (the answer is shown)
  hr: 0.6, triple: 0.4, double: 0.2,   // share of the pitch left when you answered → hit type
  endFrac: 0.6,
};
const MODES = HOOPS.MODES;
const HITS = ["", "SINGLE!", "DOUBLE!", "TRIPLE!", "HOME RUN!"];

function basesFor(left){ return left>=T.hr?4:left>=T.triple?3:left>=T.double?2:1; }

// phases: windup · pitch (question up) · hit · strike · done
function newPlayer(seed, mode, digits, goal, pitch){
  const p={ goal:Math.max(T.goalMin,Math.min(T.goalMax,goal|0||T.runs)), pitchT:Math.max(T.pitchMin,Math.min(T.pitchMax,+pitch||T.pitch)),
    phase:"windup", t:0, left:T.windup, runs:0, strikes:0, outs:0, inning:1, bases:[0,0,0], typed:"", q:null, last:null,
    hits:0, homers:0, right:0, wrongs:0, slow:0, pitches:0, finishT:0, stream:HOOPS.questionStream(seed, mode||"add", digits||"1") };
  return p;
}
// how far the ball is from the pitcher's hand to the plate (0–1) while a pitch is live
const ballK=p=>p.phase==="pitch"?1-p.left/p.pitchT:p.phase==="windup"?0:1;

function swing(p, bases, left){
  p.hits++; if (bases===4) p.homers++;
  // advance runners: everyone on base moves `bases`, the batter lands on base `bases`
  let scored=0; const nb=[0,0,0];
  for (let i=2;i>=0;i--) if (p.bases[i]){ const to=i+bases; if (to>=3) scored++; else nb[to]=1; }
  if (bases>=4) scored++; else nb[bases-1]=1;
  p.bases=nb; p.runs+=scored; p.strikes=0;
  p.last={ kind:"hit", bases, scored, left };
  p.phase="hit"; p.left=T.hitT;
}
function strike(p, why){
  p.strikes++; p.last={ kind:"strike", why, q:p.q, typed:p.typed, out:false, inning:false };
  if (p.strikes>=3){ p.strikes=0; p.outs++; p.last.out=true;
    if (p.outs>=3){ p.outs=0; p.inning++; p.bases=[0,0,0]; p.last.inning=true; } }
  p.phase="strike"; p.left=T.strikeT;
}
// a digit while the pitch is live. Returns "" | "hit" | "strike".
function answer(p, digit){
  if (p.phase!=="pitch") return "";
  p.typed+=digit;
  if (p.typed.length<p.q.len) return "";
  if (+p.typed===p.q.s){ p.right++; swing(p, basesFor(p.left/p.pitchT), p.left/p.pitchT); return "hit"; }
  p.wrongs++; strike(p,"wrong"); return "strike";
}
function back(p){ if (p.phase!=="pitch" || !p.typed) return false; p.typed=p.typed.slice(0,-1); return true; }
// advance time. Returns "" | "pitch" (question up) | "strike" (too slow) | "next" (new windup) | "finish".
function step(p, dt){
  if (p.phase==="done") return "";
  p.t+=dt; p.left-=dt;
  if (p.left>0) return "";
  if (p.phase==="windup"){ p.phase="pitch"; p.left=p.pitchT; p.q=p.stream(); p.typed=""; p.pitches++; return "pitch"; }
  if (p.phase==="pitch"){ p.slow++; strike(p,"slow"); return "strike"; }
  if (p.runs>=p.goal){ p.phase="done"; p.finishT=p.t; return "finish"; }
  p.phase="windup"; p.left=T.windup; p.typed=""; return "next";
}

// ------------------------------------------------------------
//  BOTS (solo + hub demo)
// ------------------------------------------------------------
function makeBot(seed, skill){
  const r=HOOPS.rng(seed);
  return { r, skill, think:0.9+2.6*(1-skill), acc:0.78+0.2*skill, wait:-1 };
}
function botStep(bot, p, dt){
  if (p.phase!=="pitch"){ bot.wait=-1; return; }
  if (bot.wait<0) bot.wait=bot.think*(0.5+bot.r()*1.0);
  bot.wait-=dt; if (bot.wait>0) return;
  const want=String(p.q.s), s=bot.r()<bot.acc?want:String(p.q.s+1+(bot.r()*3|0)).padStart(want.length,"1").slice(-want.length);
  for (const c of s){ if (answer(p,c)) break; }
  bot.wait=-1;
}

return { T, MODES, HITS, basesFor, newPlayer, ballK, answer, back, step, makeBot, botStep, cash:HOOPS.cash };
});
