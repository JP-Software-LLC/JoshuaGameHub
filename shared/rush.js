// Rush Hour — shared driving simulation (browser: window.RUSH, Node: require).
// Everything about the road is generated from one seed, so every racer meets the same
// traffic at the same race-clock time. Each browser simulates only its own car; other racers
// are ghosts (no collisions between players).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RUSH = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

// ------------------------------------------------------------
//  TUNING (metres, seconds). Balanced with scripts/rush-balance.js
// ------------------------------------------------------------
const T = {
  dist: 4400,          // race length: ≈2 min for an average driver (see rush-balance.js)
  lanes: 3, laneW: 3.6,
  vmax: 40, accel: 9, brake: 30, vmin: 5,
  laneTime: 0.18,      // seconds to slide one lane
  carLen: 4.2, carW: 1.9,
  boostV: 12, boostT: 1.0,           // glowing strips: +12 m/s fading over 1 s
  rearKeep: 0.32,      // rear-ending an NPC: drop to 32 % of ITS speed (a big slowdown)…
  stunT: 0.6,          // …and only half acceleration for 0.6 s
  pinT: 5.5,           // stuck right behind the same vehicle this long → it moves off and drives away (nobody stays boxed in)
  pinHelpT: 2.5,       // …only this long for racers getting full catch-up help
  awayV: 70,           // …faster than any racer, then it vanishes over the horizon
  sideKeep: 0.72,      // sideswipe: keep 72 % and get pushed back to your lane
  hitCooldown: 0.35,
  rowGap: [48, 80],    // metres between traffic rows
  // catch-up ("help") is a smooth function of METRES BEHIND THE LEADER, never of place,
  // so racers close together get almost exactly the same help.
  helpStart: 40, helpFull: 480,
  helpVmax: 0.18,      // up to +18 % top speed
  helpAccel: 0.6,      // up to +60 % acceleration
  helpHit: 0.5,        // bumps hurt up to 50 % less
};
const NPC = {
  car:   { len:4.5,  w:1.9, v:[16,21] },   // red cars
  truck: { len:7.5,  w:2.3, v:[13,17] },   // blue trucks
  semi:  { len:15.5, w:2.5, v:[10,13] },   // white semis
};
const laneX=l=>(l-1)*T.laneW;            // lanes 0,1,2 → x = -3.6, 0, 3.6

function rng(seed){ let a=seed>>>0; return ()=>{ a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// ------------------------------------------------------------
//  TRACK — NPC traffic + boost strips from a seed.
//  Every NPC has a fixed spot on the road (m) and a speed. It appears SPAWN metres ahead of
//  each racer at that spot and drives on from there, so every racer meets the same traffic
//  at the same place and traffic can never pile up over the race. Racers never collide with
//  each other, so NPCs do not need to be in the same place on every screen at the same instant.
//  Rows never block all three lanes.
// ------------------------------------------------------------
const SPAWN=180;
function makeTrack(seed, dist=T.dist){
  const r=rng(seed), npcs=[], boosts=[];
  let m=SPAWN+40;
  while (m<dist-80){
    const nLanes=r()<0.36?2:1;                                   // 1 or 2 lanes per row
    const lanes=[0,1,2].sort(()=>r()-0.5).slice(0,nLanes);
    for (const lane of lanes){
      const k=r(), type=k<0.5?"car":k<0.8?"truck":"semi", spec=NPC[type];
      npcs.push({ i:npcs.length, lane, type, len:spec.len, w:spec.w, v:spec.v[0]+r()*(spec.v[1]-spec.v[0]), m:m+(r()-0.5)*10 });
    }
    if (r()<0.3) boosts.push({ lane:[0,1,2].find(l=>!lanes.includes(l)), z:m+SPAWN*0.55+r()*20 });  // open lane, near where you meet the row
    m+=T.rowGap[0]+r()*(T.rowGap[1]-T.rowGap[0]);
  }
  npcs.sort((a,b)=>a.m-b.m); npcs.forEach((n,i)=>n.i=i);
  return { seed, dist, npcs, boosts };
}
// Each racer has their own live traffic (spawned SPAWN m ahead, then simulated step by step).
// Rules: an NPC never drives through the one ahead in its lane, and one that comes up behind
// the racer in the racer's lane follows them instead of driving through them.
const laneOf=x=>Math.max(0,Math.min(2,Math.round(x/T.laneW)+1));
function advanceTraffic(track, car, dt, h){
  while (car.npcNext<track.npcs.length && track.npcs[car.npcNext].m-SPAWN<=car.d){
    const n=track.npcs[car.npcNext++]; car.live.push({ n, type:n.type, lane:n.lane, len:n.len, w:n.w, z:n.m, v:n.v });
  }
  const cl0=laneOf(car.x);
  for (const o of car.live){
    // a racer stuck right behind this vehicle: after pinT it moves off and drives away
    const g=o.z-car.d;
    if (o.lane===cl0 && g>-0.5 && g<8) o.pin=(o.pin||0)+dt;                  // close behind it (tailing or bumping)
    else if (!o.away) o.pin=Math.max(0,(o.pin||0)-dt*0.5);
    if (o.pin>T.pinT-(T.pinT-T.pinHelpT)*h) o.away=true;
    o.v=o.away?Math.min(T.awayV,(o.vAway||o.n.v)+25*dt):o.n.v; if (o.away) o.vAway=o.v;
    o.z+=o.v*dt;
  }
  car.live=car.live.filter(o=>o.z+o.len>car.d-60 && !(o.away && o.z>car.d+SPAWN));
  for (const l of [0,1,2]){
    const ln=car.live.filter(o=>o.lane===l).sort((a,b)=>b.z-a.z);
    for (let k=1;k<ln.length;k++){ const lim=ln[k-1].z-ln[k].len-5; if (ln[k].z>lim){ ln[k].z=lim; ln[k].v=ln[k-1].v; if (ln[k].away) ln[k-1].away=true; } }   // a departing vehicle clears the lane ahead too
  }
  const cl=laneOf(car.x), tail=car.d-T.carLen;
  for (const o of car.live) if (o.lane===cl && o.z<tail && o.z+o.len>tail-1.5){ o.z=tail-1.5-o.len; o.v=Math.min(o.v,car.v); }
}
const traffic=(track,car)=>car.live;

// ------------------------------------------------------------
//  CAR
// ------------------------------------------------------------
function newCar(){ return { live:[], npcNext:0, d:0, x:laneX(1), lane:1, fromLane:1, v:0, boost:0, cd:0, t:0, done:false, finishT:0, hits:{ rear:0, side:0 }, boosts:0, lastHit:"" }; }
function helpFor(gap){ return Math.max(0,Math.min(1,(gap-T.helpStart)/(T.helpFull-T.helpStart))); }

// One fixed step. input: { lane: target lane change -1/0/+1 (edge), brake: bool }.
// leaderD = furthest distance of any racer (for catch-up). Returns an event string or "".
function step(car, track, dt, input, leaderD){
  if (car.done) return "";
  car.t+=dt; car.lastHit="";
  const h=helpFor(Math.max(0,leaderD-car.d));
  // lane changes
  if (input.lane){ const nl=Math.max(0,Math.min(2,car.lane+input.lane)); if (nl!==car.lane){ car.fromLane=car.lane; car.lane=nl; } }
  const tx=laneX(car.lane), sx=T.laneW/T.laneTime*dt;
  car.x+=Math.max(-sx,Math.min(sx,tx-car.x));
  // speed
  const cap=T.vmax*(1+T.helpVmax*h);
  if (input.brake) car.v=Math.max(T.vmin,car.v-T.brake*dt);
  else car.v=Math.min(cap,car.v+T.accel*(1+T.helpAccel*h)*(car.stun>0?0.5:1)*dt);
  car.stun=Math.max(0,(car.stun||0)-dt);
  if (car.boost>0){ car.boost=Math.max(0,car.boost-dt); car.v=Math.max(car.v,cap+T.boostV*(car.boost/T.boostT)); }
  else if (car.v>cap) car.v=Math.max(cap,car.v-T.accel*2*dt);
  advanceTraffic(track, car, dt, h);
  const prevD=car.d;
  car.d+=car.v*dt;
  car.cd=Math.max(0,car.cd-dt);
  let ev="";
  // traffic
  for (const n of traffic(track, car)){
    if (n.z > car.d+30) continue;
    const latOverlap=Math.abs(car.x-laneX(n.lane)) < (T.carW+n.w)/2*0.92;
    const lonOverlap=car.d>n.z && car.d-T.carLen<n.z+n.len;
    if (!latOverlap || !lonOverlap) continue;
    if (prevD<=n.z+0.6 && Math.abs(car.x-laneX(n.lane))<T.laneW*0.45){         // nose into its tail → rear-end
      car.d=n.z-0.05;
      if (car.cd<=0 && car.v-n.v>3){                                          // a real bump: big slowdown
        const keep=T.rearKeep+(0.85-T.rearKeep)*T.helpHit*h;             // catch-up softens the bump
        car.v=Math.max(T.vmin,n.v*keep); car.stun=T.stunT*(1-0.6*h); car.hits.rear++; car.cd=T.hitCooldown; ev="rear"; car.boost=0;
      } else car.v=Math.min(car.v,n.v);                                       // just tailing it
    } else if (car.cd<=0){                                                     // side contact → back to your lane
      const keep=T.sideKeep+(1-T.sideKeep)*T.helpHit*h; car.v=Math.max(T.vmin,car.v*keep);
      const back=car.fromLane!==car.lane?car.fromLane:(car.x<laneX(n.lane)?Math.max(0,n.lane-1):Math.min(2,n.lane+1));
      car.lane=back; car.fromLane=back; car.hits.side++; car.cd=T.hitCooldown; ev="side";
    }
  }
  // boost strips
  for (const b of track.boosts) if (prevD<b.z && car.d>=b.z && Math.abs(car.x-laneX(b.lane))<T.laneW*0.55){ car.boost=T.boostT; car.boosts++; ev=ev||"boost"; }
  if (car.d>=track.dist){ car.done=true; car.finishT=car.t-(car.d-track.dist)/Math.max(1,car.v); car.d=track.dist; ev="finish"; }
  car.lastHit=ev;
  return ev;
}

// ------------------------------------------------------------
//  BOT DRIVER (solo-mode ghosts + balance testing). skill 0..1
// ------------------------------------------------------------
function makeBot(seed, skill){
  const r=rng(seed);
  return { skill, r, react:0.3+1.3*skill, think:0, mistake:0.5*Math.pow(1-skill,1.4)+0.03, swerve:0.06*(1-skill), brakeFor:null };
}
// nearest NPC rear in a lane within [from,to] metres of the car's nose → {gap, v} (gap Infinity if clear)
function nearest(track, car, lane, from, to){
  let best={ gap:Infinity, v:0 };
  for (const n of traffic(track, car)){ if (n.lane!==lane) continue;
    if (n.z+n.len<car.d+from || n.z>car.d+to) continue;
    const g=n.z-car.d; if (g<best.gap) best={ gap:g, v:n.v }; }
  return best;
}
function botInput(bot, car, track, dt){
  bot.think-=dt;
  const input={ lane:0, brake:false };
  // braking is continuous: only while faster than the car just ahead and close to it
  if (bot.brakeFor){ const close=car.v-bot.brakeFor.v, gap=bot.brakeFor.gapAt+bot.brakeFor.v*bot.brakeFor.age-car.d; bot.brakeFor.age+=dt;
    if (close>1 && gap<close*0.7+5) input.brake=true; }
  if (bot.think>0) return input;
  bot.think=0.1+bot.r()*0.08;
  bot.brakeFor=null;
  if (bot.r()<bot.swerve){ input.lane=bot.r()<0.5?-1:1; return input; }   // weaker drivers sometimes swerve for no reason
  const look=car.v*bot.react+8;
  const ahead=nearest(track,car,car.lane,-1,look);
  if (ahead.gap<look && Math.abs(car.x-laneX(car.lane))<0.4){
    if (bot.r()<bot.mistake) return input;                        // didn't notice in time
    // score every lane: clearance there, but a 2-lane move also needs a gap in the middle lane to slip through
    const gap=l=>nearest(track,car,l,-T.carLen-3,look).gap;
    const opts=[0,1,2].filter(l=>l!==car.lane).map(l=>{
      let c=gap(l);
      if (Math.abs(l-car.lane)===2 && bot.skill>0.45){ const mid=gap(1); if (mid<car.v*0.5) c=-1; else c-=4; }
      else if (Math.abs(l-car.lane)===2) c=-1;
      return { l, c };
    }).sort((a,b)=>b.c-a.c);
    if (opts[0] && opts[0].c>ahead.gap+4 && opts[0].c>10) input.lane=Math.sign(opts[0].l-car.lane);
    else if (bot.skill>0.35) bot.brakeFor={ v:ahead.v, gapAt:car.d+ahead.gap, age:0 };   // boxed in: ease off behind it
  } else if (bot.skill>0.5){                                       // good drivers chase boost strips
    const b=track.boosts.find(b=>b.z>car.d+10&&b.z<car.d+look*1.3);
    if (b && Math.abs(b.lane-car.lane)===1 && nearest(track,car,b.lane,-T.carLen-3,b.z-car.d+6).gap===Infinity) input.lane=b.lane-car.lane;
  }
  return input;
}

return { T, NPC, SPAWN, laneX, laneOf, rng, makeTrack, traffic, newCar, step, helpFor, makeBot, botInput, nearest };
});
