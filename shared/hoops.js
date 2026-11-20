// Mathsketball — shared rules (browser: window.HOOPS, Node: require).
// Cycle: answer 3 math questions right (checked the moment the answer has enough digits, no Enter;
// wrong = quick red shake, input clears, same question again — you never skip a question) → take 3 shots → repeat.
// A shot: a power meter fills from left to right (mostly red, then yellow, then green) and starts again.
// Space stops it. The closer to (and into) the green, the more likely the ball goes in.
// First to the basket goal (teacher picks 6–50, default 10) finishes. Online, the round ends for everyone once 60 % of the class has finished.
// Questions: same generator and options as Math Race (mode add · sub · mul · div · money; digits "1" · "12" · "2").
// Everyone gets the same question order (seeded per game).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HOOPS = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

const T = {
  baskets: 10,              // default basket goal (host can pick goalMin–goalMax)
  goalMin: 6, goalMax: 50,
  questions: 3,             // right answers needed before each set of shots
  shots: 3,                 // shots per set
  wrongT: 0.4,              // wrong answer: quick red shake, then the input clears; SAME question until it is right
  fill: 1.25,               // seconds for the needle to sweep across once (start of the game)
  fillMin: 0.95,            // ... it speeds up a little with each basket, down to this
  green: 0.05,              // meter zones by distance from the middle: green < green · yellow < yellow · red beyond
  yellow: 0.2,              // (needle sweeps left → right → left; the sweet spot is the middle, 10 % wide)
  flightT: 1.05,            // ball in the air
  endFrac: 0.6,             // online: round ends when this share of the class has finished
};
const MODES = ["add", "sub", "mul", "div", "money"];

function rng(seed){ let a=seed>>>0; return ()=>{ a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const cash=c=>"$"+Math.floor(c/100)+"."+String(c%100).padStart(2,"0");

// Same as Math Race. Every question is { top, bottom, op, s (answer), len (digits to type), money }.
function questionStream(seed, mode="add", digits="12"){
  const r=rng(seed), int=(lo,hi)=>lo+(r()*(hi-lo+1)|0), num=()=>r()<0.3 ? int(1,9) : int(10,99);
  const D=digits==="1"||digits==="2"?digits:"12";
  let prev="";
  const make={
    add(){ if (D==="1"){ const a=int(1,9), b=int(1,9); return { top:a, bottom:b, op:"+", s:a+b }; }
      if (D==="2"){ const a=int(10,99), b=int(10,99); return { top:a, bottom:b, op:"+", s:a+b }; }
      const a=num(), b=num(), s=a+b; return s<10?null:{ top:a, bottom:b, op:"+", s }; },
    sub(){ if (D==="1"){ const a=int(2,9), b=int(1,a-1); return { top:a, bottom:b, op:"−", s:a-b }; }
      if (D==="2"){ const a=int(20,99), b=int(10,a-1); return { top:a, bottom:b, op:"−", s:a-b }; }
      const a=int(20,99), b=int(1,a-10); return { top:a, bottom:b, op:"−", s:a-b }; },
    mul(){ if (D==="1"){ const a=int(2,9), b=int(2,9); return { top:a, bottom:b, op:"×", s:a*b }; }
      if (D==="2"){ const a=int(10,20), b=int(10,15); return { top:a, bottom:b, op:"×", s:a*b }; }
      const a=int(2,12), b=int(2,12); return { top:a, bottom:b, op:"×", s:a*b }; },
    div(){ if (D==="1"){ const b=int(1,9), q=int(1,Math.floor(9/b)); if (b===1&&q===1) return null; return { top:b*q, bottom:b, op:"÷", s:q }; }
      if (D==="2"){ const b=int(10,49), q=int(2,9); if (b*q>99) return null; return { top:b*q, bottom:b, op:"÷", s:q }; }
      const b=int(2,12), q=int(2,12); if (b*q>99) return null; return { top:b*q, bottom:b, op:"÷", s:q }; },
    money(){ const a=int(1,199)*5, b=int(1,199)*5; return { top:cash(a), bottom:cash(b), op:"+", s:a+b, money:true }; },
  }[MODES.includes(mode)?mode:"add"];
  return ()=>{ for(;;){ const q=make(); if (!q) continue;
    const key=q.top+q.op+q.bottom; if (key===prev) continue; prev=key;
    q.len=String(q.s).length; return q; } };
}

// chance of a basket for a meter stop at pos (0–1). Green ≈ sure thing; yellow climbs towards green; red is a long shot.
function chance(pos){
  const d=Math.round(Math.abs(pos-0.5)*1e6)/1e6;
  if (d<=T.green) return 0.93;
  if (d<=T.yellow) return 0.75-0.45*(d-T.green)/(T.yellow-T.green);
  return 0.22-0.2*Math.min(1,(d-T.yellow)/(0.5-T.yellow));
}
const zone=pos=>{ const d=Math.round(Math.abs(pos-0.5)*1e6)/1e6; return d<=T.green?"green":d<=T.yellow?"yellow":"red"; };
const fillTime=made=>Math.max(T.fillMin, T.fill-0.035*made);

// phases: quiz · shoot · flight · done
function newPlayer(seed, mode, digits, goal){
  const p={ seed, goal:Math.max(T.goalMin,Math.min(T.goalMax,goal|0||T.baskets)), mode:mode||"add", digits:digits||"1", phase:"quiz", t:0, made:0, shotsTaken:0, greens:0, qi:0, typed:"", lock:0, wrong:null,
    shotsLeft:0, meter:0, dir:1, shot:null, finishT:0, right:0, wrongs:0, stream:questionStream(seed, mode||"add", digits||"1") };
  p.q=p.stream(); return p;
}
// a digit while a question is up. Returns "" | "right" | "ready" (3 right → shooting) | "wrong".
function answer(p, digit){
  if (p.phase!=="quiz" || p.lock>0) return "";
  p.typed+=digit;
  if (p.typed.length<p.q.len) return "";
  if (+p.typed===p.q.s){
    p.qi++; p.right++; p.typed=""; p.q=p.stream();
    if (p.qi>=T.questions){ p.phase="shoot"; p.shotsLeft=T.shots; p.meter=0; p.dir=1; p.qi=0; return "ready"; }
    return "right";
  }
  p.wrong={ q:p.q, typed:p.typed }; p.typed=""; p.wrongs++; p.lock=T.wrongT;
  return "wrong";
}
function back(p){ if (p.phase!=="quiz" || p.lock>0 || !p.typed) return false; p.typed=p.typed.slice(0,-1); return true; }
// stop the meter. rnd: a 0–1 random number. Returns the shot { pos, zone, make } or null.
function shoot(p, rnd){
  if (p.phase!=="shoot") return null;
  const pos=p.meter, make=rnd<chance(pos);
  p.shot={ pos, zone:zone(pos), make }; p.phase="flight"; p.left=T.flightT; p.shotsTaken++; if (p.shot.zone==="green") p.greens++;
  return p.shot;
}
// advance time. Returns "" | "retry" (new question after a wrong one) | "made" | "miss" | "quiz" (back to questions) | "finish".
function step(p, dt){
  if (p.phase==="done") return "";
  p.t+=dt;
  if (p.phase==="quiz"){
    if (p.lock>0){ p.lock-=dt; if (p.lock<=0){ p.lock=0; p.wrong=null; return "retry"; } }
  } else if (p.phase==="shoot"){
    p.meter+=p.dir*dt/fillTime(p.made);                          // ping-pong between the ends
    if (p.meter>=1){ p.meter=2-p.meter; p.dir=-1; } else if (p.meter<=0){ p.meter=-p.meter; p.dir=1; }
  } else if (p.phase==="flight"){
    p.left-=dt;
    if (p.left<=0){
      const made=p.shot.make; if (made) p.made++; p.shotsLeft--;
      if (p.made>=p.goal){ p.phase="done"; p.finishT=p.t; return "finish"; }
      if (p.shotsLeft>0){ p.phase="shoot"; p.meter=0; p.dir=1; }
      else { p.phase="quiz"; p.qi=0; p.typed=""; }
      return made?"made":"miss";
    }
  }
  return "";
}

// ------------------------------------------------------------
//  BOTS (solo mode + hub demo): think time, accuracy and meter timing vary with skill
// ------------------------------------------------------------
function makeBot(seed, skill){
  const r=rng(seed);
  return { r, skill, think:3.2-2*skill, acc:0.8+0.18*skill, aimSd:0.05+0.17*(1-skill), wait:0.6, target:-1 };
}
function botStep(bot, p, dt){
  if (p.phase==="quiz"){
    bot.wait-=dt; if (bot.wait>0 || p.lock>0) return;
    bot.wait=bot.think*(0.6+bot.r()*0.8);
    const want=String(p.q.s), right=bot.r()<bot.acc;
    const s=right?want:String(p.q.s+1+(bot.r()*3|0)).padStart(want.length,"1").slice(-want.length);
    for (const c of s) answer(p,c);
  } else if (p.phase==="shoot"){
    if (bot.target<0){ const g=(bot.r()+bot.r()+bot.r()-1.5)*2*bot.aimSd; bot.target=Math.max(0.02,Math.min(0.98,0.5+g)); }
    if (p.dir>0 ? p.meter>=bot.target : p.meter<=bot.target){ shoot(p,bot.r()); bot.target=-1; bot.wait=0.4+bot.r()*0.6; }
  }
}

return { T, MODES, rng, cash, questionStream, chance, zone, fillTime, newPlayer, answer, back, shoot, step, makeBot, botStep };
});
