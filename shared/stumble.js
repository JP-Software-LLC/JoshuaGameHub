// Bumbling Stumbling Math: shared tuning + course data (UMD: window.STUMBLE in the browser, require on the server).
// CONTRACT (vertical slice) — the server only needs T.*; everything else is client-side.
//   Course runs straight along +d (metres forward). x = sideways (metres, 0 = centre), y = height.
//   Client -> server: pos{d,x,y,a}  (a = anim state 0 idle · 1 run · 2 air · 3 fallen/respawning)
//                     finish{time, extra = falls}
//   Server -> client: ps{p:[[pid,d,x,fin,y,a],...]} ~10/s · go{seed,dist,limit,...} · lobby{...,limit}
//   Host/teacher -> server: limit{min: 0|2|3|5} (lobby only, 0 = off) · end{} (playing only)
//
// Client side (browser only): the course (static boxes + moving platforms whose motion is a pure function of race
// time, so every screen sees the same thing), bean movement tuning and the solo bot brain. Physics itself (Rapier
// KinematicCharacterController) lives in public/bumbling-stumbling-math/, which reads everything from here.
(function(root,f){ if (typeof module==="object"&&module.exports) module.exports=f(); else root.STUMBLE=f(); })(this,function(){
  "use strict";
  const T={
    dist:160,          // course length in metres (start line d=0 → finish line d=dist)
    halfWidth:12,      // |x| never exceeds this
    endFrac:0.6,       // race ends once 60 % of the class has finished
    limits:[0,2,3,5],  // teacher time-limit choices in minutes (0 = off, default)
    safetyMin:15,      // hidden safety close
    // ---- bean movement (client only) ----
    run:7.2,           // top run speed m/s
    accel:38,          // ground acceleration m/s²
    airAccel:16,       // air control m/s²
    friction:30,       // ground deceleration with no input
    jumpV:8.6,         // jump take-off speed (≈1.5 m high, ≈5 m long at full speed)
    gravity:24,
    coyote:0.12,       // a jump still works this long after running off an edge
    jumpBuffer:0.14,   // a jump pressed this long before landing still fires
    killY:-7,          // fall below this → respawn at the last checkpoint
    respawnT:1.1,      // seconds spent "fallen" (a=3) before reappearing
    radius:0.45, halfH:0.4,   // capsule (total height 1.7)
  };

  // ---- course: boxes are { d0, d1, x0, x1, top, h, c } in course metres (top = walkable height, h = thickness) ----
  // colour keys: "main" floor · "alt" floor · "edge" trims · "block" obstacles · "ramp"
  const W=7;                              // half width of the main lanes
  const FLOORS=[
    { d0:-10, d1:34,   x0:-W, x1:W, top:0, h:3, c:"main" },
    // gap 1: 34 → 37.4
    { d0:37.4, d1:52,  x0:-W, x1:W, top:0, h:3, c:"alt" },
    { d0:52, d1:60,    x0:-W, x1:W, top:1.2, h:4.2, c:"main" },          // a step up (jump onto it)
    { d0:60, d1:70,    x0:-W, x1:W, top:0, h:3, c:"alt" },
    // gap 2 (wider): 70 → 74
    { d0:74, d1:95,    x0:-W, x1:W, top:0, h:3, c:"main" },
    // moving platform carries you 95 → 113
    { d0:113, d1:T.dist+16, x0:-W, x1:W, top:0, h:3, c:"alt" },
  ];
  // obstacles to weave round / hop over (solid boxes standing on the floor)
  const BLOCKS=[
    { d0:12, d1:14, x0:-6, x1:-2, top:1.1, h:1.1, c:"block" },
    { d0:12, d1:14, x0:2, x1:6, top:1.1, h:1.1, c:"block" },
    { d0:22, d1:24, x0:-2, x1:2, top:1.1, h:1.1, c:"block" },
    { d0:42, d1:43, x0:-W, x1:W, top:0.55, h:0.55, c:"block" },         // low wall: hop it
    { d0:80, d1:82, x0:-W, x1:-1.5, top:1.1, h:1.1, c:"block" },
    { d0:86, d1:88, x0:1.5, x1:W, top:1.1, h:1.1, c:"block" },
    { d0:124, d1:126, x0:-6, x1:-1, top:1.1, h:1.1, c:"block" },
    { d0:124, d1:126, x0:2.5, x1:W, top:1.1, h:1.1, c:"block" },
    { d0:136, d1:137, x0:-W, x1:W, top:0.55, h:0.55, c:"block" },
    { d0:146, d1:148, x0:-W, x1:-3, top:1.1, h:1.1, c:"block" },
    { d0:146, d1:148, x0:3, x1:W, top:1.1, h:1.1, c:"block" },
  ];
  // side rails (low bumpers) along every floor so you only fall in the gaps, not off the sides by accident
  const RAILS=[];
  for (const f of FLOORS) for (const s of [-1,1]) RAILS.push({ d0:f.d0, d1:f.d1, x0:s<0?-W-0.6:W, x1:s<0?-W:W+0.6, top:f.top+0.7, h:0.7, c:"edge" });

  // moving platforms: centre at mover(i,t) (pure function of race time t in seconds)
  const MOVERS=[
    { len:5, w:6, top:0, h:0.8, dA:98, dB:110, period:7.5, x:0 },
  ];
  function moverPos(m,t){            // ease back and forth: starts at the near end
    const k=0.5-0.5*Math.cos(2*Math.PI*Math.max(0,t)/m.period);
    return { d:m.dA+(m.dB-m.dA)*k, x:m.x, top:m.top };
  }
  const GAPS=[[34,37.4],[70,74],[95,113]];
  const CHECKPOINTS=[0,40,76,115];       // respawn points (d); reached once you pass them on the ground
  const START_D=1.5;

  const COURSE={ FLOORS, BLOCKS, RAILS, MOVERS, GAPS, CHECKPOINTS, START_D, W };

  // spawn slot for colour index i (spread over a grid behind the start line)
  function spawn(i){ const col=i%8, row=Math.floor(i/8)%5; return { d:START_D-row*1.6, x:(col-3.5)*1.6 }; }

  // ground height under (d,x) at race time t (static floors/blocks + movers); -Infinity over a gap. Shadows + bots.
  function groundAt(d,x,t,yMax){
    let g=-Infinity; const lim=yMax==null?Infinity:yMax+0.3;
    for (const L of [FLOORS,BLOCKS]) for (const b of L) if (d>=b.d0&&d<=b.d1&&x>=b.x0&&x<=b.x1&&b.top<=lim&&b.top>g) g=b.top;
    for (const m of MOVERS){ const p=moverPos(m,t); if (Math.abs(d-p.d)<=m.len/2&&Math.abs(x-p.x)<=m.w/2&&p.top<=lim&&p.top>g) g=p.top; }
    return g;
  }

  // ---- seeded rng (mulberry32) ----
  function rng(seed){ let a=seed>>>0; return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=a; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }

  // ---- solo bots: a tiny brain that returns input { mx (-1..1 sideways), mz (-1..1 forward), jump } ----
  // skill 0..1: higher = straighter lines, better jump timing, fewer hesitations.
  function makeBot(seed,skill){ const r=rng(seed); return { r, skill, lane:(r()*2-1)*4, think:0, pause:0, wobble:r()*6 }; }
  function botInput(b,s,t,dt){
    // s = { d, x, y, vy, grounded }
    const inp={ mx:0, mz:1, jump:false };
    b.think-=dt; if (b.think<=0){ b.think=0.6+b.r()*1.2; if (b.r()<0.35) b.lane=(b.r()*2-1)*4.5; }
    if (b.pause>0){ b.pause-=dt; inp.mz=0; }
    // steer round the blocks just ahead
    let target=b.lane;
    for (const k of BLOCKS){ if (k.top<0.9) continue; if (k.d0-s.d<5 && k.d1-s.d>-0.5 && s.x>k.x0-0.9 && s.x<k.x1+0.9){
      const left=k.x0-1.3, right=k.x1+1.3, okL=left>-W+0.6, okR=right<W-0.6;
      target=okL&&(!okR||Math.abs(s.x-left)<Math.abs(s.x-right))?left:right; } }
    // and toward the moving platform's lane
    if (s.d>88&&s.d<114) target=MOVERS[0].x;
    inp.mx=Math.max(-1,Math.min(1,(target-s.x)*0.8+Math.sin(t*1.3+b.wobble)*0.15*(1-b.skill)));
    // jumps: low walls + the step + small gaps
    const lead=0.7+0.9*b.skill;
    for (const k of BLOCKS) if (k.top<0.9 && k.d0-s.d>0 && k.d0-s.d<lead && k.x0<=s.x && k.x1>=s.x) inp.jump=true;
    if (52-s.d>0 && 52-s.d<lead+0.3) inp.jump=true;
    for (const [g0,g1] of GAPS){
      if (g1-g0>8){                                       // the moving platform gap: wait for it to come close
        const m=MOVERS[0], p=moverPos(m,t), near=p.d-m.len/2, far=p.d+m.len/2;
        if (s.d<g0 && g0-s.d<2.2){
          if (near-g0<1.0 && (moverPos(m,t+0.4).d<=p.d+0.05)) { inp.jump=g0-s.d<1.0; }  // it's here (or arriving): hop on
          else inp.mz=g0-s.d>1.2?0.4:0;                    // wait at the edge
        } else if (s.d>=g0-0.2 && s.d<g1 && s.y>-0.5){      // riding: walk to the front, hop off at the far end
          if (g1-far<1.0) { inp.mz=1; inp.jump=far-s.d<1.6; }
          else inp.mz=s.d<far-1.4?0.6:0;
        }
      } else if (s.d<g0 && g0-s.d<lead) inp.jump=true;
    }
    if (!s.grounded) inp.jump=false;
    if (b.r()<0.002*(1-b.skill)) b.pause=0.3+b.r()*0.6;    // a little stumble now and then
    inp.mz*=0.82+0.18*b.skill;
    return inp;
  }

  const ANIM={ idle:0, run:1, air:2, fallen:3 };
  return { T, COURSE, moverPos, groundAt, spawn, rng, makeBot, botInput, ANIM };
});
