// Rush Hour — shared driving simulation (browser: window.RUSH, Node: require).
// The road (traffic + boost strips) comes from one seed. Traffic is a pure function of the
// race clock, so every racer sees the same vehicles in the same places at the same moment
// (ghosts weave the same traffic you do). Each browser simulates only its own car.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RUSH = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

// ------------------------------------------------------------
//  TUNING (metres, seconds). Balanced with scripts/rush-balance.js
// ------------------------------------------------------------
const T = {
  dist: 3100,          // race length (≈80 s for an average driver; see rush-balance.js)
  lanes: 3, laneW: 3.6,
  vmax: 40, accel: 9, brake: 30, vmin: 5,           // players: 144 km/h cruising
  laneSpeed: [12, 15, 18],                          // NPCs: ONE speed per lane (43/54/65 km/h) → no traffic jams, ever
  laneTime: 0.18,      // seconds to slide one lane
  carLen: 4.2, carW: 1.9,
  rowGap: [80, 125],   // metres between traffic rows
  twoLaneRows: 0.25,   // share of rows that block two lanes (never three)
  boostGap: [70, 110], // a glowing strip every 70–110 m
  boostV: 12, boostT: 1.0,                          // +12 m/s fading over 1 s
  rearKeep: 0.32,      // rear-ending: drop to 32 % of the VEHICLE's speed…
  stunT: 0.6,          // …with half acceleration for 0.6 s
  sideKeep: 0.72,      // sideswipe: keep 72 % and get pushed back to your lane
  hitCooldown: 0.35,
  pinT: 4.0,           // stuck right behind a vehicle this long → it pulls over onto the shoulder
  pinHelpT: 2.0,       // …this long if you're far behind (full catch-up)
  // catch-up ("help") is a smooth function of METRES BEHIND THE LEADER, never of place,
  // so racers close together get almost exactly the same help.
  helpStart: 40, helpFull: 480,
  helpVmax: 0.18, helpAccel: 0.6, helpHit: 0.5,
};
const NPC = {
  car:   { len:4.5,  w:1.9 },   // red cars
  truck: { len:7.5,  w:2.3 },   // blue trucks
  semi:  { len:15.5, w:2.5 },   // white semis
};
const SPAWN=180;                 // vehicles are drawn/collided within this distance ahead
const VREF=34;                   // reference racer speed used to lay out traffic rows
const laneX=l=>(l-1)*T.laneW;    // lanes 0,1,2 → x = -3.6, 0, 3.6
const laneOf=x=>Math.max(0,Math.min(2,Math.round(x/T.laneW)+1));
const SHOULDER=T.laneW*1.5+2.2;  // x of the road shoulder (pulled-over vehicles)

function rng(seed){ let a=seed>>>0; return ()=>{ a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// ------------------------------------------------------------
//  TRACK. Rows are placed where the reference racer meets them; vehicles then move at their
//  lane's speed: z(t) = z0 + v·t. Same lane = same speed, so gaps never shrink.
// ------------------------------------------------------------
function makeTrack(seed, dist=T.dist){
  const r=rng(seed), lanes=[[],[],[]], boosts=[];
  let m=SPAWN+60, i=0;
  while (m<dist-80){
    const nLanes=r()<T.twoLaneRows?2:1;
    for (const lane of [0,1,2].sort(()=>r()-0.5).slice(0,nLanes)){
      const k=r(), type=k<0.5?"car":k<0.8?"truck":"semi", v=T.laneSpeed[lane], meet=m+(r()-0.5)*8;
      lanes[lane].push({ i:i++, lane, type, len:NPC[type].len, w:NPC[type].w, v, z0:meet-v*(meet/VREF) });
    }
    m+=T.rowGap[0]+r()*(T.rowGap[1]-T.rowGap[0]);
  }
  for (const L of lanes){ L.sort((a,b)=>a.z0-b.z0);                       // keep a safe gap inside each lane
    for (let k=1;k<L.length;k++) L[k].z0=Math.max(L[k].z0,L[k-1].z0+L[k-1].len+10); }
  for (let z=140; z<dist-40; z+=T.boostGap[0]+r()*(T.boostGap[1]-T.boostGap[0])) boosts.push({ lane:r()*3|0, z });
  return { seed, dist, lanes, boosts, count:i };
}
// vehicles around this car at its race time: [{ n, type, lane, x, z (rear bumper), v, len, w }]
function traffic(track, car){
  const t=car.t, out=[];
  for (let l=0;l<3;l++){
    const arr=track.lanes[l], v=T.laneSpeed[l], lo=car.d-60-v*t, hi=car.d+SPAWN-v*t;
    let a=0, b=arr.length; while (a<b){ const c=(a+b)>>1; if (arr[c].z0+arr[c].len<lo) a=c+1; else b=c; }
    for (let i=a;i<arr.length&&arr[i].z0<=hi;i++){
      const n=arr[i], z=n.z0+v*t, p=car.pulled[n.i];
      let x=laneX(l), lane=l;
      if (p){ const k=Math.min(1,(t-p.t0)/0.8); x=laneX(l)+(p.side*SHOULDER-laneX(l))*(k*k*(3-2*k)); lane=-1; }   // pulling over
      out.push({ n, type:n.type, lane, x, z, v, len:n.len, w:n.w, pulled:!!p });
    }
  }
  return out;
}

// ------------------------------------------------------------
//  CAR
// ------------------------------------------------------------
function newCar(){ return { d:0, x:laneX(1), lane:1, fromLane:1, v:0, boost:0, cd:0, stun:0, t:0, done:false, finishT:0,
  pulled:{}, pin:{ id:-1, t:0 }, hits:{ rear:0, side:0 }, boosts:0, lastHit:"" }; }
function helpFor(gap){ return Math.max(0,Math.min(1,(gap-T.helpStart)/(T.helpFull-T.helpStart))); }

// One fixed step. input: { lane: -1/0/+1 (edge), brake: bool }. leaderD = furthest racer (catch-up).
function step(car, track, dt, input, leaderD){
  if (car.done) return "";
  car.t+=dt; car.lastHit="";
  const h=helpFor(Math.max(0,leaderD-car.d));
  if (input.lane){ const nl=Math.max(0,Math.min(2,car.lane+input.lane)); if (nl!==car.lane){ car.fromLane=car.lane; car.lane=nl; } }
  const sx=T.laneW/T.laneTime*dt; car.x+=Math.max(-sx,Math.min(sx,laneX(car.lane)-car.x));
  const cap=T.vmax*(1+T.helpVmax*h);
  if (input.brake) car.v=Math.max(T.vmin,car.v-T.brake*dt);
  else car.v=Math.min(cap,car.v+T.accel*(1+T.helpAccel*h)*(car.stun>0?0.5:1)*dt);
  car.stun=Math.max(0,car.stun-dt);
  if (car.boost>0){ car.boost=Math.max(0,car.boost-dt); car.v=Math.max(car.v,cap+T.boostV*(car.boost/T.boostT)); }
  else if (car.v>cap) car.v=Math.max(cap,car.v-T.accel*2*dt);
  const prevD=car.d;
  car.d+=car.v*dt;
  car.cd=Math.max(0,car.cd-dt);
  let ev="";
  const cl=laneOf(car.x); let tailing=null;
  for (const n of traffic(track, car)){
    if (n.pulled || n.z>car.d+30) continue;
    if (n.lane===cl && n.z-car.d>-0.5 && n.z-car.d<8) tailing=n;
    const latOverlap=Math.abs(car.x-n.x) < (T.carW+n.w)/2*0.92;
    const lonOverlap=car.d>n.z && car.d-T.carLen<n.z+n.len;
    if (!latOverlap || !lonOverlap) continue;
    if (prevD<=n.z+0.6 && Math.abs(car.x-n.x)<T.laneW*0.45){                 // nose into its tail → rear-end
      car.d=n.z-0.05;
      if (car.cd<=0 && car.v-n.v>3){
        const keep=T.rearKeep+(0.85-T.rearKeep)*T.helpHit*h;
        car.v=Math.max(T.vmin,n.v*keep); car.stun=T.stunT*(1-0.6*h); car.hits.rear++; car.cd=T.hitCooldown; ev="rear"; car.boost=0;
      } else car.v=Math.min(car.v,n.v);                                       // just tailing it
    } else if (car.cd<=0){                                                     // side contact → back to your lane
      const keep=T.sideKeep+(1-T.sideKeep)*T.helpHit*h; car.v=Math.max(T.vmin,car.v*keep);
      const back=car.fromLane!==car.lane?car.fromLane:(car.x<n.x?Math.max(0,n.lane-1):Math.min(2,n.lane+1));
      car.lane=back; car.fromLane=back; car.hits.side++; car.cd=T.hitCooldown; ev="side";
    }
  }
  // stuck right behind the same vehicle for a while → it pulls over onto the shoulder for you
  if (tailing){
    if (car.pin.id!==tailing.n.i) car.pin={ id:tailing.n.i, t:0 };
    car.pin.t+=dt;
    if (car.pin.t>T.pinT-(T.pinT-T.pinHelpT)*h){
      const l=tailing.n.lane, side=l===0?-1:l===2?1:(car.x<=0?1:-1);
      car.pulled[tailing.n.i]={ t0:car.t, side }; car.pin={ id:-1, t:0 }; ev=ev||"pullover";
    }
  } else if (car.pin.id>=0){ car.pin.t-=dt*0.5; if (car.pin.t<=0) car.pin={ id:-1, t:0 }; }
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
// nearest vehicle rear in a lane within [from,to] metres of the nose → {gap, v} (gap Infinity if clear)
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
    const gap=l=>nearest(track,car,l,-T.carLen-3,look).gap;
    const opts=[0,1,2].filter(l=>l!==car.lane).map(l=>{
      let c=gap(l);
      if (Math.abs(l-car.lane)===2){ if (bot.skill>0.45 && gap(1)>=car.v*0.5) c-=4; else c=-1; }
      return { l, c };
    }).sort((a,b)=>b.c-a.c);
    if (opts[0] && opts[0].c>ahead.gap+4 && opts[0].c>10) input.lane=Math.sign(opts[0].l-car.lane);
    else if (bot.skill>0.35) bot.brakeFor={ v:ahead.v, gapAt:car.d+ahead.gap, age:0 };   // boxed in: ease off behind it
  } else if (bot.skill>0.5){                                        // good drivers chase boost strips
    const b=track.boosts.find(b=>b.z>car.d+10&&b.z<car.d+look*1.3);
    if (b && Math.abs(b.lane-car.lane)===1 && nearest(track,car,b.lane,-T.carLen-3,b.z-car.d+6).gap===Infinity) input.lane=b.lane-car.lane;
  }
  return input;
}

return { T, NPC, SPAWN, SHOULDER, laneX, laneOf, rng, makeTrack, traffic, newCar, step, helpFor, makeBot, botInput, nearest };
});
