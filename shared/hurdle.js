// Hurdle Dash — shared rules (browser: window.HURDLE, Node: require).
// Run by tapping Left / Right in turn. At each of 10 hurdles one addition question pops up
// (Math Race rules: answer is checked the moment it has enough digits, no Enter).
// Right → jump it with a small speed boost. Wrong → no falling: you stay at the hurdle, see the right answer
// for a moment, then get a new sum. You can only jump a hurdle by answering correctly.
// The teacher picks how many digits each number has: "1" (1–9), "12" (1–99), "2" (10–99).
// Every racer gets the same questions at each hurdle (seeded per race).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HURDLE = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

const T = {
  dist: 100,                          // metres, straight track
  hurdles: [10, 18.5, 27, 35.5, 44, 52.5, 61, 69.5, 78, 86.5],   // 10 hurdles before the finish
  gain: 1.25,                         // m/s added per good (alternating) stride
  decay: 1.5,                         // speed fades this fast when you stop tapping (per second, exponential)
  vmax: 9.5,
  stumble: 0.6,                       // same key twice → keep 60 % of your speed
  questions: 1,
  tripT: 3.0,                         // (unused: nobody falls any more)
  wrongT: 1.5,                        // after a wrong answer: show the right one this long, then a new sum
  jumpT: 0.55, jumpV: 7.0,            // clearing a hurdle: short hop, land with a little speed boost
  stopBefore: 0.9,                    // runners stop this far in front of a hurdle for the quiz
};

function rng(seed){ let a=seed>>>0; return ()=>{ a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
// Addition. digits: "1" both numbers 1–9 · "12" each 1–99 · "2" both 10–99.
function questionStream(seed, digits){
  const r=rng(seed), one=()=>1+(r()*9|0), two=()=>10+(r()*90|0);
  const num=digits==="2"?two:digits==="12"?()=>(r()<0.4?one():two()):one;
  let prev=null;
  return ()=>{ for(;;){ const a=num(), b=num(), s=a+b;
    if (prev && prev.a===a && prev.b===b) continue;
    return prev={ a, b, s, len:String(s).length }; } };
}

// states: run · quiz · trip · jump · done
function newRunner(seed, digits){ return { seed, digits:digits||"1", lock:0, d:0, v:0, t:0, state:"run", last:"", strides:0, stumbles:0, h:0, qi:0, q:null, typed:"", stream:null,
  left:0, clean:0, trips:0, finishT:0, wrong:null }; }

// a stride. side: "L" | "R". Returns "stride" | "stumble" | "".
function tap(r, side){
  if (r.state!=="run") return "";
  if (side===r.last){ r.v*=T.stumble; r.stumbles++; return "stumble"; }
  r.last=side; r.strides++; r.v=Math.min(T.vmax, r.v+T.gain);
  return "stride";
}
// a digit while the quiz is up. Returns "" | "right" | "cleared" | "wrong".
function answer(r, digit){
  if (r.state!=="quiz" || r.lock>0) return "";
  r.typed+=digit;
  if (r.typed.length<r.q.len) return "";
  if (+r.typed===r.q.s){
    r.qi++; r.typed="";
    if (r.qi>=T.questions){ r.state="jump"; r.left=T.jumpT; r.clean++; return "cleared"; }
    r.q=r.stream(); return "right";
  }
  r.wrong={ q:r.q, typed:r.typed }; r.typed="";
  r.trips++; r.lock=T.wrongT;                                       // stay at the hurdle; a new sum comes after the pause
  return "wrong";
}
// Backspace while the quiz is up
function back(r){ if (r.state!=="quiz" || r.lock>0 || !r.typed) return false; r.typed=r.typed.slice(0,-1); return true; }
// advance time. Returns an event string or "".
function step(r, dt){
  if (r.state==="done") return "";
  r.t+=dt;
  let ev="";
  if (r.state==="run"){
    r.v*=Math.exp(-T.decay*dt);
    if (r.v<0.05) r.v=0;
    const next=T.hurdles[r.h];
    r.d+=r.v*dt;
    if (next!=null && r.d>=next-T.stopBefore){                      // reached a hurdle → quiz
      r.d=next-T.stopBefore; r.v=0; r.state="quiz"; r.qi=0; r.typed=""; r.wrong=null;
      r.stream=questionStream(r.seed*31+r.h*7919+1, r.digits); r.q=r.stream(); ev="hurdle";
    }
  } else if (r.state==="quiz"){
    if (r.lock>0){ r.lock-=dt; if (r.lock<=0){ r.lock=0; r.wrong=null; r.q=r.stream(); ev="retry"; } }
  } else if (r.state==="trip" || r.state==="jump"){
    r.left-=dt;
    const hx=T.hurdles[r.h];
    if (r.state==="jump") r.d=hx-T.stopBefore+(T.stopBefore*2)*(1-Math.max(0,r.left)/T.jumpT);   // hop over it
    if (r.left<=0){
      r.d=hx+T.stopBefore; r.v=r.state==="jump"?T.jumpV:0; r.state="run"; r.h++; r.last=""; ev="go";
    }
  }
  if (r.d>=T.dist){ r.finishT=r.t-(r.d-T.dist)/Math.max(0.5,r.v); r.d=T.dist; r.state="done"; ev="finish"; }
  return ev;
}

// ------------------------------------------------------------
//  BOTS (solo mode + balance check): tap rate, mistakes, quiz speed/accuracy vary with skill
// ------------------------------------------------------------
function makeBot(seed, skill){
  const r=rng(seed);
  return { r, skill, rate:5.5+5*skill, slip:0.06*(1-skill), think:2.6-1.6*skill, acc:0.82+0.16*skill, wait:0, side:"L" };
}
function botStep(bot, run, dt){
  bot.wait-=dt; if (bot.wait>0) return;
  if (run.state==="run"){
    bot.wait=1/bot.rate*(0.8+bot.r()*0.4);
    tap(run, bot.r()<bot.slip ? run.last||"L" : (run.last==="L"?"R":"L"));
  } else if (run.state==="quiz"){
    bot.wait=bot.think*(0.6+bot.r()*0.8);
    const want=String(run.q.s), right=bot.r()<bot.acc;
    const s=right?want:String(run.q.s+1+(bot.r()*3|0)).padStart(want.length,"1").slice(-want.length);
    for (const c of s) answer(run,c);
  }
}

return { T, rng, questionStream, newRunner, tap, answer, back, step, makeBot, botStep };
});
