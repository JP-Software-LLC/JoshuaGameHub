// Bumbling Stumbling Math: shared tuning + course data (UMD: window.STUMBLE in the browser, require on the server).
// CONTRACT (vertical slice) — the server only needs T.*; everything else is client-side.
//   Course runs straight along +d (metres forward). x = sideways (metres, 0 = centre), y = height.
//   Client -> server: pos{d,x,y,a}  (a = anim state 0 idle · 1 run · 2 air · 3 fallen/respawning · 4 diving · 5 solving a veil)
//                     finish{time, extra = falls}
//   Server -> client: ps{p:[[pid,d,x,fin,y,a],...]} ~10/s · go{seed,dist,limit,...} · lobby{...,limit}
//   Host/teacher -> server: limit{min: 0|2|3|5} (lobby only, 0 = off) · end{} (playing only)
//                           qpv{n} (questions per veil, T.qpvMin..T.qpvMax, default T.qpv) · mode{mode} · digits{d} (Math Race rules)
//   lobby + go also carry: map (id), qpv, mode, digits. Questions: HOOPS.questionStream(seed, mode, digits) — everyone same order.
//
// Client side (browser only): the course is MAP DATA (shared/stumble-maps.js). compile(map) turns a map into a "course"
// (static boxes, ramps, pads, belts, jelly panels, movers whose motion is a pure function of race time, so every screen
// sees the same thing); groundAt/probe read it; bean movement tuning and the solo bot brain live here too. Physics
// itself (Rapier KinematicCharacterController) lives in public/bumbling-stumbling-math/world.js, which reads it all from here.
(function(root,f){ if (typeof module==="object"&&module.exports) module.exports=f(require("./stumble-maps.js")); else root.STUMBLE=f(root.STUMBLE_MAPS); })(this,function(MAPS){
  "use strict";
  const T={
    dist:600,          // course length in metres = the default map's length (shared/stumble-maps.js)
    halfWidth:12,      // |x| never exceeds this
    endFrac:0.6,       // race ends once 60 % of the class has finished
    limits:[0,2,3,5],  // teacher time-limit choices in minutes (0 = off, default)
    safetyMin:15,      // hidden safety close
    qpv:2, qpvMin:1, qpvMax:4,   // math questions per veil (teacher picks in the lobby: qpv{n})
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
    diveV:10.5,        // second Space in the air = dive: forward speed m/s
    diveUp:3.2,        // small upward pop when the dive starts
    diveGetUp:0.5,     // belly slide + getting back up after a dive lands (no control)
    slideFriction:11,  // deceleration while belly-sliding
    radius:0.45, halfH:0.4,   // capsule (total height 1.7)
    // ---- hazards: KNOCK-BACK (sweepers, pendulums, sliding gates). Tune feel here. ----
    hitPush:9.5,       // sideways speed (m/s) a hit gives you, along the hazard's motion. ≈ how far you fly: 6.8 → ~3.5 m, 9.5 → ~5.5 m
    hitUp:6,           // upward pop on a hit (m/s): 5 → ~0.5 m high, ~0.42 s in the air; 6 → ~0.75 m, ~0.5 s
    hitStun:0.55,      // seconds of stumble after a hit: reduced control, momentum kept
    hitControl:0.25,   // how much of your steering works during the stumble (0..1)
    hitDrag:1.5,       // air deceleration during the stumble (m/s², low = the throw carries)
    hitSlide:11,       // ground deceleration during the stumble (m/s², lower = slide further after landing)
    hitImmune:0.9,     // no new hit for this long after a hit (counted from the hit; > hitStun so you aren't juggled)
    hitMinSpd:0.6,     // hazard slower than this at the contact point = a soft bump straight out, not a throw
    hitSoft:0.45,      // soft bump strength (× hitPush / hitUp): slow hazards, or running into the back of an arm
    hitAlong:0.35,     // how much the throw leans outward from the hazard (0 = exactly along its motion)
    // ---- Map 2 footing ----
    ssSlide:0.12,      // seesaw: tilt (sin) above which you start sliding toward the low side
    ssSlideK:14,       // seesaw: slide speed (m/s) per unit of sin(tilt) above ssSlide
    tileWob:0.8,       // a fake tile wobbles this long after you step on it, then drops
    tileGone:3,        // …and comes back this long after it dropped
    bumpUp:3.5,        // bumper bounce: upward pop (m/s); sideways = the bumper's kick
    hitFling:0.9,      // sweepers: extra lean AWAY from the hub, × (contact radius / arm length): the tip flings you off the rim,
                       // near the hub it just shoves you along
  };


  // ============================================================
  //  COURSE = a compiled map (shared/stumble-maps.js). compile() is cached on the map object.
  //  c.solids  axis-aligned static boxes (floor, block, wall, rail, post, lintel, pad, belt, closed jelly panels)
  //  c.ramps   sloped slabs · c.movers · c.pads · c.belts · c.doors (with .panels) · c.jelly (closed panels)
  //  c.veils   [{ d, cp }] (cp = index of the checkpoint just past it) · c.checkpoints · c.rooms · c.length
  // ============================================================
  const BUCKET=8;
  function compileDoors(p,i){
    const n=p.n||5, post=p.post??0.5, thick=p.thick??0.6, h=p.h??2.8, top=p.wallTop??4.2, open=new Set(p.open||[]);
    const w=(p.x1-p.x0-(n+1)*post)/n, d0=p.d-thick/2, d1=p.d+thick/2;
    const posts=[], panels=[];
    for (let k=0;k<=n;k++){ const x=p.x0+k*(w+post); posts.push({ type:"post", d0, d1, x0:x, x1:x+post, top, h:top+0.3 }); }
    posts.push({ type:"post", d0, d1, x0:p.x0, x1:p.x1, top, h:top-h });                     // lintel over the doors
    for (let k=0;k<n;k++){ const x=p.x0+post+k*(w+post);
      panels.push({ type:"jelly", d0:p.d-0.14, d1:p.d+0.14, x0:x, x1:x+w, top:h, h:h+0.3, open:open.has(k), k, door:i, bounce:p.bounce??5 }); }
    return { i, d:p.d, x0:p.x0, x1:p.x1, n, w, post, thick, h, top, posts, panels, src:p };
  }
  function compile(map){
    if (map.__course) return map.__course;
    const c={ map, id:map.id, length:map.length, solids:[], ramps:[], pads:[], belts:[], movers:[], doors:[], jelly:[], signs:[], hazards:[], decks:[],
      discs:[], seesaws:[], tiles:[], traps:[], bumpers:[], lfloors:[], rooms:map.rooms||[], buckets:new Map() };
    for (const p of map.pieces||[]){
      switch (p.type){
        case "floor": case "block": case "wall": case "rail": c.solids.push(p); break;
        case "ramp": c.ramps.push(p); break;
        case "pad": c.pads.push(p); c.solids.push(p); break;
        case "belt": c.belts.push(p); c.solids.push(p); break;
        case "mover": c.movers.push(p); break;
        case "sign": c.signs.push(p); break;
        case "deck": { const q={ ...p, type:"deck", round:true, cx:p.x||0, cd:p.d, x0:(p.x||0)-p.r, x1:(p.x||0)+p.r, d0:p.d-p.r, d1:p.d+p.r, top:p.top??0, h:p.h??3, src:p };
          c.decks.push(q); c.solids.push(q); break; }
        case "sweeper": case "pendulum": case "gate": case "piston": case "gumball": { const h=compileHazard(p,c.hazards.length); c.hazards.push(h);
          if (h.hub) c.solids.push(h.hub); break; }
        case "disc": { const q={ ...p, type:"disc", round:true, cx:p.x||0, cd:p.d, x0:(p.x||0)-p.r, x1:(p.x||0)+p.r, d0:p.d-p.r, d1:p.d+p.r, top:p.top??0, h:p.h??1.2,
            speed:p.speed||0, phase:p.phase||0, src:p }; c.discs.push(q); c.solids.push(q); break; }
        case "seesaw": { const cx=p.x||0, q={ ...p, type:"seesaw", cx, x0:cx-p.w/2, x1:cx+p.w/2, top:p.top??0, h:p.h??0.5, hold:p.hold??0.3, phase:p.phase||0,
            i:c.seesaws.length, dyn:seesawTop, src:p }; c.seesaws.push(q); c.solids.push(q); break; }
        case "tiles": case "traps": { const F=compileGrid(p,p.type==="tiles"?c.tiles.length:c.traps.length); (p.type==="tiles"?c.tiles:c.traps).push(F); c.solids.push(...F.cells); break; }
        case "bumper": { const q={ ...p, type:"bumper", round:true, cx:p.x, cd:p.d, r:p.r??0.7, base:p.top??0, x0:p.x-(p.r??0.7), x1:p.x+(p.r??0.7), d0:p.d-(p.r??0.7), d1:p.d+(p.r??0.7),
            top:(p.top??0)+(p.h??1.4), h:p.h??1.4, kick:p.kick??8, i:c.bumpers.length, src:p }; c.bumpers.push(q); c.solids.push(q); break; }
        case "luckydoors": { const D=compileDoors({ ...p, n:p.n||4, open:[] },c.doors.length); D.lucky=true; D.src=p; c.doors.push(D); c.solids.push(...D.posts);
          const lane=p.lane??6, lh=p.laneH??0.5, a=D.d+D.thick/2, top=p.laneTop??0; D.lane=[a,a+lane]; D.extra=[];
          for (const q of D.panels){ q.lucky=true; const f={ type:"lfloor", d0:a, d1:a+lane, x0:q.x0, x1:q.x1, top, h:lh, k:q.k, D, dyn:lfloorTop }; q.floor=f; c.lfloors.push(f); c.solids.push(f); }
          const dt=top+(p.divH??1.8);                                   // corridor dividers: too tall to hop, low enough to see in
          for (const P of D.posts.slice(0,D.n+1)) D.extra.push({ type:"block", d0:a, d1:a+lane, x0:P.x0, x1:P.x1, top:dt, h:dt-top+lh });
          if (p.roof!==false) D.extra.push({ type:"block", d0:a, d1:a+lane, x0:D.x0, x1:D.x1, top:D.top+0.35, h:0.35, roof:true });
          c.solids.push(...D.extra); break; }
        case "doors": { const D=compileDoors(p,c.doors.length); c.doors.push(D); c.solids.push(...D.posts);
          for (const q of D.panels) if (!q.open){ c.jelly.push(q); c.solids.push(q); } break; }
      }
    }
    c.checkpoints=(map.checkpoints&&map.checkpoints.length?map.checkpoints:[{ d:0 }]).slice().sort((a,b)=>a.d-b.d);
    c.veils=(map.veils||[]).map((d,k)=>({ d, k, cp:c.checkpoints.findIndex(q=>q.veil===k) }));
    c.CHECKPOINTS=c.checkpoints.map(q=>q.d);                       // legacy: plain depths
    // spatial buckets along d (ground probes are called a lot: shadows, bots)
    const put=(b,lo,hi)=>{ for (let k=Math.floor(lo/BUCKET);k<=Math.floor(hi/BUCKET);k++){ if (!c.buckets.has(k)) c.buckets.set(k,[]); c.buckets.get(k).push(b); } };
    for (const b of c.solids) put(b,b.d0,b.d1);
    for (const b of c.ramps) put(b,b.d0,b.d1);
    for (const m of c.movers) put(m,Math.min(m.dA,m.dB)-m.len/2,Math.max(m.dA,m.dB)+m.len/2);
    Object.defineProperty(map,"__course",{ value:c, enumerable:false });
    applySeed(c,1);
    return c;
  }
  const course=id=>compile(MAPS?MAPS.get(id):{ id:"", length:T.dist, pieces:[], checkpoints:[{ d:0 }] });

  // ---- moving platforms: k(t) 0 = at A (dA,x) · 1 = at B (dB,xB). Holds `hold` of each period split over both ends ----
  const easeS=s=>0.5-0.5*Math.cos(Math.PI*Math.max(0,Math.min(1,s)));
  function moverK(m,t){
    const h=m.hold||0, a=h/2, mv=0.5-h;
    const u=((Math.max(0,t)/m.period+(m.phase||0))%1+1)%1;
    if (u<a) return 0; if (u<0.5-a) return easeS((u-a)/mv); if (u<0.5+a) return 1; if (u<1-a) return 1-easeS((u-0.5-a)/mv); return 0;
  }
  function moverPos(m,t){ const k=moverK(m,t); return { d:m.dA+(m.dB-m.dA)*k, x:m.xB!=null?m.x+(m.xB-m.x)*k:m.x, top:m.top, k }; }
  // a pad that throws you onto a mover: "go now" = the mover will be home when you land (and stay a moment)
  const PAD_FLIGHT=0.65;
  function padReady(c,pad,t){
    if (!pad.wait) return true; const m=c.movers[pad.wait.m]; if (!m) return true;
    return moverK(m,t+PAD_FLIGHT)<0.02 && moverK(m,t+PAD_FLIGHT+0.3)<0.06;
  }

  // ============================================================
  //  HAZARDS — pure data + a pure function of race time (same motion on every screen, no server).
  //  shape(t) is used by BOTH the drawing (world.js) and the collision (hazardContact), so what you see is what hits you.
  //  sweeper  { d, x=0, top=0, len, y=0.55, thick=0.3, speed (rad/s, + turns from +x toward +d), phase (rad), arms=1, hub=0.8, hubH=1.6 }
  //           arm(s) from the centre out to `len`, `y` above the deck (low enough to jump); a solid hub post in the middle
  //  pendulum { d, x=0, py (pivot height), rope, amp (rad), period (s), phase (0..1), r (ball radius) }  swings across the path (x)
  //  gate     { d, top=0, w, h=1.9, thick=0.8, xA, xB (centre slides xA↔xB), period, hold=0.2, phase=0, gap=0 }
  //           a sliding box; gap>0 = a wall of width w with an opening of `gap` at its centre. Solid (kinematic body).
  //  Each compiled hazard gets i (index), z0..z1 (the depths it can reach: bots wait before z0).
  // ============================================================
  const TAU=Math.PI*2;
  function compileHazard(p,i){
    const h={ ...p, i, x:p.x||0, top:p.top??0, src:p };
    if (h.type==="sweeper"){ h.y=p.y??0.55; h.thick=p.thick??0.3; h.arms=p.arms||1; h.phase=p.phase||0;
      const hr=p.hub??0.8, hh=p.hubH??1.6; h.z0=h.d-h.len-h.thick; h.z1=h.d+h.len+h.thick;
      if (hr>0) h.hub={ type:"hub", round:true, cx:h.x, cd:h.d, r:hr, x0:h.x-hr, x1:h.x+hr, d0:h.d-hr, d1:h.d+hr, top:h.top+hh, h:hh }; }
    else if (h.type==="pendulum"){ h.phase=p.phase||0; h.z0=h.d-h.r; h.z1=h.d+h.r; }
    else if (h.type==="gumball"){ h.r=p.r??0.85; h.z0=h.d0-1.5; h.z1=h.d1+h.r; h.top0=p.top0??0; h.top1=p.top1??0; h.travel=(h.d1-h.d0+1.5)/h.speed; h.sched=[]; }
    else if (h.type==="piston"){ h.h=p.h??1.8; h.thick=p.thick??2; h.phase=p.phase||0; h.solid=true; h.L=p.reach+0.6;
      const s=h.side; h.xOut=s*(p.edge+0.25+h.L/2); h.xBack=s*(p.edge+0.25+(p.back??0.9)+h.L/2); h.xIn=s*(p.edge-p.reach+h.L/2);
      h.tele=p.tele??0.8; h.punch=p.punch??0.2; h.hold=p.hold??0.55; h.ret=p.ret??0.7; h.rest=Math.max(0.2,h.period-h.tele-h.punch-h.hold-h.ret);
      h.z0=h.d-h.thick/2; h.z1=h.d+h.thick/2; }
    else { h.solid=true; h.h=p.h??1.9; h.thick=p.thick??0.8; h.hold=p.hold??0.2; h.phase=p.phase||0; h.gap=p.gap||0; h.z0=h.d-h.thick/2; h.z1=h.d+h.thick/2; }
    return h;
  }
  const gateX=(h,t)=>h.xA+(h.xB-h.xA)*moverK(h,t);
  function gateBoxes(h,cx){
    const y0=h.top, y1=h.top+h.h, d0=h.d-h.thick/2, d1=h.d+h.thick/2;
    if (!h.gap) return [{ x0:cx-h.w/2, x1:cx+h.w/2, d0, d1, y0, y1 }];
    return [{ x0:cx-h.w/2, x1:cx-h.gap/2, d0, d1, y0, y1 }, { x0:cx+h.gap/2, x1:cx+h.w/2, d0, d1, y0, y1 }];
  }
  // piston: rests outside the edge → PULLS BACK (telegraph, tele s) → punches in (punch s) → holds → slides back out
  function pistonX(h,t){
    const P=h.period, u=(((Math.max(0,t)/P+h.phase)%1)+1)%1*P;
    if (u<h.rest) return h.xOut; let v=u-h.rest;
    if (v<h.tele) return h.xOut+(h.xBack-h.xOut)*easeS(v/h.tele); v-=h.tele;
    if (v<h.punch) return h.xBack+(h.xIn-h.xBack)*(v/h.punch); v-=h.punch;
    if (v<h.hold) return h.xIn; v-=h.hold;
    return h.xIn+(h.xOut-h.xIn)*easeS(v/h.ret);
  }
  // 0..1: how close the piston is to punching (1 = punching now) — for the warning light
  function pistonWarn(h,t){ const P=h.period, u=(((Math.max(0,t)/P+h.phase)%1)+1)%1*P; return u<h.rest?0:u<h.rest+h.tele+h.punch?1:0; }
  // gumballs: every lane has its own schedule of release times (from the race seed); a ball rolls from d1 down to d0
  // at `speed`, then sinks into the drain just below d0. Pure function of (seed, t): every screen sees the same balls.
  function gumY(h,d){ return d>=h.d0?h.top0+(h.top1-h.top0)*(d-h.d0)/(h.d1-h.d0)+h.r:h.top0+h.r-2.2*(h.d0-d); }
  function gumBalls(h,t,out){
    out=out||[]; out.length=0;
    for (let L=0;L<h.sched.length;L++){ const S=h.sched[L], lo=t-h.travel;
      let a=0, b=S.length; while (a<b){ const m=(a+b)>>1; if (S[m]<=lo) a=m+1; else b=m; }       // first release after t-travel
      for (let i=a;i<S.length&&S[i]<=t;i++){ const s=(t-S[i])*h.speed, d=h.d1-s; out.push({ x:h.lanes[L], d, y:gumY(h,d), r:h.r, s, lane:L }); } }
    return out;
  }
  function hazardShape(h,t){
    if (h.type==="gumball"){ const bs=gumBalls(h,t), sl=(h.top1-h.top0)/(h.d1-h.d0);
      return { kind:"balls", balls:bs, vd:-h.speed, vy:-h.speed*sl }; }
    if (h.type==="piston"){ const cx=pistonX(h,t);
      return { kind:"box", cx, boxes:[{ x0:cx-h.L/2, x1:cx+h.L/2, d0:h.d-h.thick/2, d1:h.d+h.thick/2, y0:h.top, y1:h.top+h.h }], vx:(pistonX(h,t+0.02)-pistonX(h,t-0.02))/0.04 }; }
    if (h.type==="sweeper"){ const a=h.phase+h.speed*Math.max(0,t), segs=[];
      for (let k=0;k<h.arms;k++){ const b=a+k*TAU/h.arms; segs.push([h.x,h.d,h.x+h.len*Math.cos(b),h.d+h.len*Math.sin(b)]); }
      return { kind:"seg", a, y:h.top+h.y, r:h.thick, segs }; }
    if (h.type==="pendulum"){ const u=TAU*(Math.max(0,t)/h.period+h.phase), th=h.amp*Math.sin(u), w=h.amp*TAU/h.period*Math.cos(u);
      return { kind:"ball", th, x:h.x+h.rope*Math.sin(th), y:h.py-h.rope*Math.cos(th), d:h.d, r:h.r, vx:h.rope*Math.cos(th)*w, vy:h.rope*Math.sin(th)*w }; }
    const cx=gateX(h,t);
    return { kind:"box", cx, boxes:gateBoxes(h,cx), vx:(gateX(h,t+0.02)-gateX(h,t-0.02))/0.04 };
  }
  // contact between hazard h at time t and a bean standing at (d,x,y) (capsule radius R, default T.radius).
  // Returns null or { h, nx,ny,nd (unit normal hazard→bean), vx,vy,vd (hazard velocity at the contact), pen (overlap m) }.
  function hazardContact(h,t,d,x,y,R){
    R=R??T.radius; const ya=y+T.radius, yb=y+T.radius+2*T.halfH;          // the capsule's axis (bottom/top sphere centres)
    if (d<h.z0-R-0.6||d>h.z1+R+0.6) return null;
    const S=hazardShape(h,t);
    if (S.kind==="seg"){
      let best=null;
      for (const g of S.segs){ const ex=g[2]-g[0], ed=g[3]-g[1], L2=ex*ex+ed*ed;
        const s=Math.max(0,Math.min(1,((x-g[0])*ex+(d-g[1])*ed)/(L2||1))), px=g[0]+ex*s, pd=g[1]+ed*s;
        const cy=Math.max(ya,Math.min(yb,S.y)), hx=x-px, hd=d-pd, hy=cy-S.y, dist=Math.hypot(hx,hy,hd);
        if (dist<R+S.r&&(!best||dist<best.dist)){ const k=dist||1;
          const rx=px-h.x, rd=pd-h.d, rl=Math.hypot(rx,rd)||1, f=T.hitFling*rl/h.len;
          best={ h, dist, nx:hx/k, ny:hy/k, nd:hd/k, vx:-h.speed*rd, vy:0, vd:h.speed*rx, pen:R+S.r-dist, fx:rx/rl*f, fd:rd/rl*f }; } }
      return best;
    }
    if (S.kind==="balls"){
      let best=null;
      for (const B of S.balls){ const cy=Math.max(ya,Math.min(yb,B.y)), hx=x-B.x, hy=cy-B.y, hd=d-B.d, dist=Math.hypot(hx,hy,hd);
        if (dist<R+B.r&&(!best||dist<best.dist)){ const k=dist||1; best={ h, dist, nx:hx/k, ny:hy/k, nd:hd/k, vx:0, vy:S.vy, vd:S.vd, pen:R+B.r-dist }; } }
      return best;
    }
    if (S.kind==="ball"){
      const cy=Math.max(ya,Math.min(yb,S.y)), hx=x-S.x, hy=cy-S.y, hd=d-S.d, dist=Math.hypot(hx,hy,hd);
      if (dist>=R+S.r) return null; const k=dist||1;
      return { h, dist, nx:hx/k, ny:hy/k, nd:hd/k, vx:S.vx, vy:S.vy, vd:0, pen:R+S.r-dist };
    }
    // box (gate): vertical overlap, then circle (x,d,R) vs rectangle
    let best=null;
    for (const b of S.boxes){
      if (y+2*(T.radius+T.halfH)<b.y0||y>b.y1) continue;
      const qx=Math.max(b.x0,Math.min(b.x1,x)), qd=Math.max(b.d0,Math.min(b.d1,d));
      let nx, nd, pen;
      if (qx===x&&qd===d){                                       // centre inside: push out the shortest way
        const o=[[x-b.x0,-1,0],[b.x1-x,1,0],[d-b.d0,0,-1],[b.d1-d,0,1]].sort((a,b2)=>a[0]-b2[0])[0];
        nx=o[1]; nd=o[2]; pen=o[0]+R; }
      else { const hx=x-qx, hd=d-qd, dist=Math.hypot(hx,hd); if (dist>=R) continue; nx=hx/dist; nd=hd/dist; pen=R-dist; }
      if (!best||pen>best.pen) best={ h, nx, ny:0, nd, vx:S.vx, vy:0, vd:0, pen };
    }
    return best;
  }
  // every hazard touching a bean at (d,x,y) at time t (few hazards per map: a plain loop is fine)
  function hazardContacts(c,t,d,x,y,R){ const out=[]; for (const h of c.hazards){ const k=hazardContact(h,t,d,x,y,R); if (k) out.push(k); } return out; }
  function hazardAny(c,t,d,x,y,R,skip){ for (const h of c.hazards){ if (h===skip) continue; if (hazardContact(h,t,d,x,y,R)) return h; } return null; }

  // ============================================================
  //  MOVING FOOTING (Map 2). All pure functions of race time (+ the race seed), except fake tiles: they drop when a
  //  LOCAL bean (mine / a solo bot) steps on them, so other players only see your ghost fall (same fake tiles for all).
  //  disc    { d, x=0, r, top=0, h=1.2, speed rad/s (+ = from +x toward +d), phase }  turning round platform; carries you
  //  seesaw  { d0,d1, x=0, w, top=0 (pivot = top centre), h=0.5, amp rad, period s, hold=0.3, phase }  plank rolling
  //          left↔right (rests tilted, then swings over); past T.ssSlide you slide toward the low side
  //  tiles   { d0, x0, rows, cols, tw, td, gap=0.3, top=0, h=0.5, fake=0.45 }  Tip-Toe: ~fake share wobble (T.tileWob s)
  //          then drop when stepped on, back after T.tileGone s. Fake/real from rng(seed); a real path always exists.
  //  traps   { d0, x0, rows, cols, tw, td, gap=0.2, top=0, h=0.5, period, up, blink=0.8, gone, rise=0.4, wave, checker }
  //          trapdoors: blink, drop, come back — a pure function of t. phase(r,c) = r*wave + (checker&&(r+c)%2)*0.5
  //  bumper  { d, x, r=0.7, top=0 (base), h=1.4, kick=8 }  pinball post: touching it bounces you away (radially)
  //  luckydoors { d, x0,x1, n=4, h, wallTop, post, thick, lane=6 (corridor length behind), laneTop=0, laneH=0.5, divH=1.8, roof=true, bounce=5 }
  //          a wall of n "?" doors with walled corridors behind. From rng(seed): one is the SHORTCUT CHUTE (its corridor
  //          has no floor: you drop to whatever the map puts below), one is jelly (bounces you back), the rest are normal.
  //  HAZARDS: piston { d, side ±1, edge (|x| of the path edge), reach, thick=2 (along d), h=1.8, top, period, phase, tele, punch, hold, ret }
  //           gumball { d0 (bottom), d1 (top), top0, top1 (ramp heights), lanes:[x…], r=0.85, speed m/s, every:[min,max] s between releases (whole hill) }
  // ============================================================
  const seesawA=(q,t)=>q.amp*(2*moverK(q,t)-1);                       // roll angle (rad), + = the +x side goes UP
  function seesawTop(q,d,x,t){ if (d<q.d0||d>q.d1) return null; const a=seesawA(q,t), u=x-q.cx, c=Math.cos(a);
    if (Math.abs(u)>q.w/2*c) return null; return q.top+u*Math.tan(a); }
  // sideways slide speed (m/s, along x) on a plank tilted by a: 0 until |a| > T.ssSlide, toward the low side
  const seesawSlide=a=>{ const e=Math.abs(Math.sin(a))-T.ssSlide; return e>0?-Math.sign(a)*e*T.ssSlideK:0; };
  // does the plank lean past `lim` at any time in [t0,t1]?
  function seesawCalm(q,t0,t1,lim){ for (let t=t0;t<=t1+1e-6;t+=0.1) if (Math.abs(seesawA(q,t))>lim) return false; return true; }
  // grid fields (tiles, trapdoors)
  function compileGrid(p,fi){
    const gap=p.gap??(p.type==="tiles"?0.3:0.2), top=p.top??0, h=p.h??0.5, cells=[];
    const F={ ...p, type:p.type, i:fi, gap, top, h, cells, d1:p.d0+p.rows*p.td+(p.rows-1)*gap, x1:p.x0+p.cols*p.tw+(p.cols-1)*gap, src:p };
    if (p.type==="traps"){ F.blink=p.blink??0.8; F.rise=p.rise??0.4; }
    for (let r=0;r<p.rows;r++) for (let k=0;k<p.cols;k++){
      const d0=p.d0+r*(p.td+gap), x0=p.x0+k*(p.tw+gap);
      const q={ type:p.type==="tiles"?"tile":"trap", F, r, k, d0, d1:d0+p.td, x0, x1:x0+p.tw, top, h, fake:false, trig:-1, dyn:p.type==="tiles"?tileTop:trapTop, n:cells.length };
      if (p.type==="traps") q.ph=(r*(p.wave||0)+(p.checker&&(r+k)%2?0.5:0))%1;
      cells.push(q); }
    return F;
  }
  // how far a fake tile has dropped (0 = in place). trig = race time it was stepped on (-1 = idle)
  function tileDrop(q,t){
    if (q.trig<0) return 0; const u=t-q.trig-T.tileWob;
    if (u<0) return 0; if (u<T.tileGone) return Math.min(40,0.5*34*u*u);
    if (u<T.tileGone+0.4) return 1.2*(1-(u-T.tileGone)/0.4); return 0;
  }
  const tileWobble=(q,t)=>q.trig>=0&&t-q.trig<T.tileWob?(t-q.trig)/T.tileWob:0;                  // 0..1 while wobbling
  const tileIdle=(q,t)=>q.trig<0||t-q.trig>=T.tileWob+T.tileGone+0.4;
  function tileTop(q,d,x,t){ const y=tileDrop(q,t); return y>0.3?null:q.top-y; }
  // trapdoor cycle: up (solid) → blink (still solid) → gone (dropped) → rising back
  function trapState(q,t){ const F=q.F, P=F.period, u=(((Math.max(0,t)/P+q.ph)%1)+1)%1*P;
    if (u<F.up) return { s:0, u, left:F.up+F.blink-u };
    if (u<F.up+F.blink) return { s:1, u, left:F.up+F.blink-u };
    const v=u-F.up-F.blink; if (v<F.gone) return { s:2, u, drop:Math.min(40,0.5*34*v*v), left:0 };
    return { s:3, u, drop:1.2*(1-(v-F.gone)/F.rise), left:0 }; }
  function trapDrop(q,t){ const S=trapState(q,t); return S.drop||0; }
  function trapTop(q,d,x,t){ const y=trapDrop(q,t); return y>0.3?null:q.top-y; }
  // seconds the trapdoor stays solid from time t (0 = gone / about to go)
  function trapSolidFor(q,t){ const S=trapState(q,t); if (S.s>=2) return S.s===3&&S.drop<0.3?0.01:0; return S.left; }
  function lfloorTop(q,d,x,t){ return q.D.kinds&&q.D.kinds[q.k]==="chute"?null:q.top; }
  function gridCell(F,d,x){ const r=Math.floor((d-F.d0)/(F.td+F.gap)), k=Math.floor((x-F.x0)/(F.tw+F.gap));
    if (r<0||r>=F.rows||k<0||k>=F.cols) return null; const q=F.cells[r*F.cols+k]; return d<=q.d1&&x<=q.x1?q:null; }

  // ---- everything that comes from the race SEED (fake tiles, gumball times, which lucky door is which). Called by
  //  world.js at every race start (W.seed); compile() applies seed 1 so menus/tests work without a race.
  function applySeed(c,seed){
    seed=(seed>>>0)||1; c.seed=seed;
    for (const F of c.tiles){ const r=rng(seed*31+F.i*977+17), path=new Set(); let k=Math.floor(r()*F.cols);
      for (let row=0;row<F.rows;row++){ if (row) k=Math.max(0,Math.min(F.cols-1,k+Math.floor(r()*3)-1)); path.add(row*F.cols+k); }
      const pf=Math.min(0.95,(F.fake??0.45)*F.cols/(F.cols-1));
      for (const q of F.cells){ q.fake=!path.has(q.n)&&r()<pf; q.trig=-1; q.real=path.has(q.n); } }
    // gumballs: ONE release sequence for the whole hill (a ball every `every` s, never twice in a row in the same lane),
    // so two balls are always ≥ every[0] × speed apart and there is always a lane to dodge into
    for (const h of c.hazards) if (h.type==="gumball"){ const r=rng(seed*13+h.i*7919+3), e=h.every||[1.6,2.8];
      h.sched=h.lanes.map(()=>[]); let t=-h.travel+r()*e[1], L=-1;
      while (t<1800){ let k=Math.floor(r()*(h.lanes.length-1)); if (L>=0&&k>=L) k++; else if (L<0) k=Math.floor(r()*h.lanes.length); h.sched[k].push(t); L=k; t+=e[0]+r()*(e[1]-e[0]); } }
    c.jelly=c.jelly.filter(q=>!q.lucky);
    for (const D of c.doors) if (D.lucky){ const r=rng(seed*7+D.i*131+5), kinds=["chute","jelly"]; while (kinds.length<D.n) kinds.push("normal");
      for (let i=kinds.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [kinds[i],kinds[j]]=[kinds[j],kinds[i]]; }
      D.kinds=kinds; for (const q of D.panels){ q.kind=kinds[q.k]; q.open=q.kind!=="jelly"; if (!q.open) c.jelly.push(q); } }
    return c;
  }

  // ---- ground under (d,x) at race time t: highest walkable top ≤ yMax(+0.3). -Infinity over a gap. ----
  const PR={ g:-Infinity, p:null };
  function probe(c,d,x,t,yMax){
    const lim=yMax==null?Infinity:yMax+0.3; let g=-Infinity, hit=null;
    const B=c.buckets.get(Math.floor(d/BUCKET));
    if (B) for (const b of B){
      if (b.type==="mover"){ const p=moverPos(b,t); if (Math.abs(d-p.d)<=b.len/2&&Math.abs(x-p.x)<=b.w/2&&p.top<=lim&&p.top>g){ g=p.top; hit=b; } continue; }
      if (d<b.d0||d>b.d1||x<b.x0||x>b.x1) continue;
      if (b.round&&(d-b.cd)*(d-b.cd)+(x-b.cx)*(x-b.cx)>b.r*b.r) continue;
      let top;
      if (b.dyn){ top=b.dyn(b,d,x,t); if (top==null) continue; }
      else top=b.type==="ramp"?b.top0+(b.top1-b.top0)*(d-b.d0)/(b.d1-b.d0):b.top;
      if (top<=lim&&top>g){ g=top; hit=b; }
    }
    PR.g=g; PR.p=hit; return PR;
  }
  const groundAt=(c,d,x,t,yMax)=>probe(c,d,x,t,yMax).g;
  // widest walkable half-width at depth d (arches, signs, flags)
  function halfWidthAt(c,d){
    let w=0; const B=c.buckets.get(Math.floor(d/BUCKET))||[];
    for (const b of B) if ((b.type==="floor"||b.type==="belt"||b.type==="pad"||b.type==="deck"||b.type==="disc"||b.type==="seesaw"||b.type==="tile"||b.type==="trap"||b.type==="lfloor"||(b.type==="ramp"&&b.c!=="edge"))&&d>=b.d0&&d<=b.d1) w=Math.max(w,Math.abs(b.x0),Math.abs(b.x1));
    return w||7;
  }

  // spawn slot for colour index i (a grid behind the start line)
  function spawn(i,c){ const sp=(c&&c.map.spawn)||{ d:1.5, cols:8, gap:1.6, rows:5 };
    const col=i%sp.cols, row=Math.floor(i/sp.cols)%sp.rows; return { d:sp.d-row*sp.gap, x:(col-(sp.cols-1)/2)*sp.gap }; }
  // where to reappear at checkpoint i (nearest of its spots to where you fell, spread a little by colour)
  function respawnAt(c,i,fromX,spIdx,t){
    const cp=c.checkpoints[i]||c.checkpoints[0], xs=cp.xs||[0]; let bx=xs[0];
    for (const x of xs) if (Math.abs(x-fromX)<Math.abs(bx-fromX)) bx=x;
    const sw=cp.sw??2.6, d=cp.d+(cp.veil!=null?0:0.4);
    let x=bx+(((spIdx||0)%5)-2)/2*sw, g=groundAt(c,d,x,t);
    if (g===-Infinity){ x=bx; g=groundAt(c,d,x,t); }
    return { d, x, y:(g===-Infinity?0:g)+1.2 };
  }

  // ---- seeded rng (mulberry32) ----
  function rng(seed){ let a=seed>>>0; return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=a; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }

  // ============================================================
  //  SOLO BOTS: a small brain returning input { mx (-1..1 sideways), mz (-1..1 forward), jump, press }.
  //  Reads the map: per-room lines (rooms[i].bot), ground probes for hops/gaps, movers, pads with `wait`, door walls.
  //  skill 0..1: higher = straighter lines, better jump timing, picks the risky fast routes and open doors more often.
  //  Veils are handled by world.js (the bean is frozen; bots wait qpv × 2.5–6 s).
  // ============================================================
  function makeBot(seed,skill,c){ const r=rng(seed); c=c||course(); return { r, skill, c, off:r()*2-1, think:0, pause:0, wobble:r()*6, route:{}, mir:{}, door:{}, bad:{}, diveArm:false, wasBonk:false, stuck:0, hz:{},
    tile:{}, badTile:new Set(), lastRow:null, gum:{ L:null, at:0 }, ss:{}, trap:{ at:0, x:null, wait:false } }; }
  function roomAt(c,d){ const R=c.rooms; for (let i=0;i<R.length;i++) if (d<R[i].d1) return i; return Math.max(0,R.length-1); }
  function lineAt(pts,d){
    if (d<=pts[0][0]) return pts[0];
    for (let i=1;i<pts.length;i++) if (d<=pts[i][0]){ const a=pts[i-1], b=pts[i], k=(d-a[0])/((b[0]-a[0])||1); return [d,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k]; }
    return pts[pts.length-1];
  }
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function botInput(b,s,t,dt){
    const c=b.c, inp={ mx:0, mz:1, jump:false, press:false };
    if (s.fallen>0){ b.hz={}; b.ss={}; b.tile={}; b.trap.at=0; b.gum.L=null; }        // fell: think again from scratch (new timing guesses)
    if (s.quiz>=0||s.fallen>0) return { mx:0, mz:0, jump:false, press:false };
    b.think-=dt; if (b.think<=0){ b.think=0.8+b.r()*1.5; if (b.r()<0.4) b.off=b.r()*2-1; }
    if (b.pause>0){ b.pause-=dt; inp.mz=0; }
    // 1. where to steer: the room's line (safe or fast route, maybe mirrored) + this bot's own offset
    const look=s.d+1.5, ri=roomAt(c,look), room=c.rooms[ri]||{ d0:0, d1:c.length };
    const B=room.bot||{ safe:[[room.d0,0,4],[room.d1,0,4]] };
    if (!(ri in b.route)){ b.route[ri]=B.fast&&b.r()<0.2+0.7*b.skill?"fast":"safe"; b.mir[ri]=B.mirror&&b.r()<0.5?-1:1; }
    const low=B.low&&s.y<(B.lowY??-1.5);
    const L=lineAt(low?B.low:B[b.route[ri]]||B.safe,look); let target=L[1]*(low?1:b.mir[ri])+b.off*L[2]*0.8;
    // 2. door walls: pick a door (better bots guess open ones more often); a jelly bounce = try another
    const bonkEdge=s.bonk>0&&!b.wasBonk; b.wasBonk=s.bonk>0;
    for (const D of c.doors){ const dd=D.d-s.d; if (dd<-0.8||dd>11) continue;
      let k=b.door[D.i];
      if (bonkEdge&&dd<2.5&&k!=null){ (b.bad[D.i]||(b.bad[D.i]={}))[k]=1; k=null; }
      if (k==null){ const bad=b.bad[D.i]||{}, cand=D.panels.filter(p=>!bad[p.k]), open=cand.filter(p=>p.open);
        const near=a=>a.reduce((m,p)=>Math.abs((p.x0+p.x1)/2-s.x)<Math.abs((m.x0+m.x1)/2-s.x)?p:m);
        const pick=open.length&&b.r()<0.35+0.5*b.skill?near(open):cand[Math.floor(b.r()*cand.length)]||D.panels[0];
        k=b.door[D.i]=pick.k; }
      const P=D.panels[k]; target=(P.x0+P.x1)/2+clamp(b.off,-1,1)*0.3;
      if (D.lucky&&dd>0&&dd<1.6&&(s.x<P.x0+0.2||s.x>P.x1-0.2)) b.side=0.25;      // lucky doors: line up with my door first
    }
    // 3. don't run into tall things: slide the target sideways to the nearest clear lane
    const g0=s.grounded?s.y:groundAt(c,s.d,s.x,t,s.y);
    const tall=(x)=>{ for (let k=0.6;k<=3;k+=0.6){ const g=groundAt(c,s.d+k,x,t,g0+3); if (g>g0+1.3) return true; } return false; };
    if (s.grounded&&tall(target)){ for (const o of [0.8,-0.8,1.6,-1.6,2.4,-2.4,3.2,-3.2,4.5,-4.5]) if (!tall(target+o)&&groundAt(c,s.d+1.5,target+o,t,g0+0.5)>g0-0.5){ target+=o; break; } }
    const hz=c.hazards.length&&!(s.hit>0)?hazardPlan(b,s,t,dt,target):null;
    if (hz&&hz.x!=null) target=hz.x;
    const fp=!(s.hit>0)&&!low?floorPlan(b,s,t,dt,target,b.route[ri]==="fast"||!B.fast):null;
    if (fp&&fp.x!=null) target=fp.x;
    inp.mx=clamp((target-s.x)*0.9+Math.sin(t*1.3+b.wobble)*0.15*(1-b.skill),-1,1);
    // 4. ground ahead: hop walls, gaps (jump / dive / wait), pads, movers
    if (s.grounded){
      const xa=s.x+(target-s.x)*0.25, cur=probe(c,s.d,s.x,t,s.y+0.1).p, onMover=cur&&cur.type==="mover";
      let hole=-1, step=-1, pad=null;
      let gp=g0;                                                 // previous probe: a ramp going down is not a hole, a sudden drop is
      for (let k=0.2;k<=2.6;k+=0.2){ const P=probe(c,s.d+k,xa,t,gp+1.4), g=P.g;
        if (P.p&&P.p.type==="pad"){ pad=P.p; break; }
        if (g>gp+0.22&&g<=gp+1.3){ step=k; break; }
        if (g>gp+1.3) break;
        if (g<gp-1.0&&groundAt(c,s.d+k+0.3,xa,t,gp+1.4)<gp-1.0){ hole=k; break; }   // small drops are just walked; a seam (tiles) isn't a hole
        gp=g; }
      const lead=0.35+0.55*b.skill+Math.max(0,s.vd)*0.03;
      if (fp&&fp.noHole) hole=-1;
      if (B.nojump&&hole>=0&&B.nojump.some(([a,z])=>s.d>=a&&s.d<=z)) hole=-1;     // the lucky chute: walk in
      if (pad){
        if (pad.wait){ const dist=pad.d0-s.d, eta=Math.max(0,dist-0.1)/Math.max(1.5,s.vd);
          if (!padReady(c,pad,t+eta)&&dist<1.7) inp.mz=0; }      // wait for the ferry, then run onto the pad
      } else if (step>=0&&step<=lead+0.35) inp.jump=true;
      else if (hole>=0){
        // landing: first ground at about our height beyond the hole
        let land=-1; for (let k=hole+0.4;k<=hole+7.6;k+=0.2){ const P=probe(c,s.d+k,xa,t,g0+1.0); if (P.g>=g0-1.0&&P.p.type!=="mover"){ land=k; break; } }   // never jump onto a moving ferry
        const gap=land<0?99:land-hole;
        if (gap<=4.2){ if (hole<=lead) inp.jump=true; }
        else if (gap<=7.4&&!onMover){ if (hole<=lead*0.8){ inp.jump=true; b.diveArm=true; } }   // dive gap
        else if (hole<1.7) inp.mz=0;                             // too far: wait at the edge (a ferry is coming)
      }
      // a ferry docked right now but leaving soon: don't step on half-way
      if (!onMover&&hole<0&&!pad&&c.movers.length){ for (let k=0.4;k<=1.6;k+=0.3) if (groundAt(c,s.d+k,xa,t+0.7,g0+0.5)<g0-0.5&&groundAt(c,s.d+k,xa,t,g0+0.5)>g0-0.5){ inp.mz=0; break; } }
      if (inp.jump) b.diveArm=b.diveArm&&true; else if (!(hole>=0)) b.diveArm=false;
    } else if (b.diveArm&&s.vy<0.8){ inp.press=true; b.diveArm=false; }
    if (hz&&hz.wait) inp.mz=0;
    if (fp&&fp.wait) inp.mz=0;
    if (b.side>0){ b.side-=dt; inp.mz=Math.min(inp.mz,0); }
    if (hz&&hz.jump&&s.grounded) inp.jump=true;
    if (!s.grounded) inp.jump=false;
    if (b.r()<0.002*(1-b.skill)) b.pause=0.3+b.r()*0.6;    // a little stumble now and then
    inp.mz*=0.82+0.18*b.skill;
    return inp;
  }

  // ---- bots vs hazards. One rule for every hazard: before its zone, imagine running straight through it
  //  (at our arrival time) and WAIT at the edge while that would hit; through gates, pick the nearest lane that will be
  //  clear. Sweeper arms are low: hop when one is about to hit. Weaker bots misjudge the timing (err), sometimes just
  //  go (careless), react late to arms, and give up waiting after a few seconds. So they get knocked off sometimes.
  const HZ_V=T.run*0.92;
  function crossClear(c,z0,z1,te,x,y,R){
    for (let dd=z0-R;dd<=z1+R;dd+=0.3){ if (hazardAny(c,te+(dd-z0+R)/HZ_V,dd,x,y,R)) return false; }
    return true;
  }
  function hazardPlan(b,s,t,dt,target){
    const c=b.c, out={ x:null, wait:false, jump:false }, sk=b.skill;
    for (const h of c.hazards){
      if (h.type==="gumball") continue;                                // lanes: floorPlan
      const dist=h.z0-T.radius-s.d;
      if (s.d<h.z0-6){ delete b.hz[h.i]; continue; }                 // fell back behind it: decide afresh next time
      if (s.d>h.z1+T.radius||dist>3.5) continue;
      const m=b.hz[h.i]||(b.hz[h.i]={ err:(b.r()-0.5)*1.1*(1-sk), careless:b.r()<0.3*(1-sk)*(1-sk), waited:0, x:null, react:null,
        margin:0.15+0.3*sk, patience:3+b.r()*4 });
      // group = every hazard sharing this zone (two gates side by side): cross all of them at once
      let z0=h.z0, z1=h.z1; for (const g of c.hazards) if (g.z0<z1&&g.z1>z0){ z0=Math.min(z0,g.z0); z1=Math.max(z1,g.z1); }
      if (dist>0&&!m.careless&&m.x==null&&h.type!=="sweeper"){            // sweepers: don't wait for a clear deck, hop the arm
        const eta=Math.max(0,dist)/HZ_V, te=t+eta+m.err, R=T.radius+m.margin, y=s.y;
        let best=null;
        if (h.solid){ const hw=halfWidthAt(c,h.d)-0.7;
          for (let x=-hw;x<=hw+0.01;x+=0.5){ const lag=Math.abs(x-s.x)/T.run*0.6;
            if (crossClear(c,z0,z1,te+lag,x,y,R)&&(best==null||Math.abs(x-target)<Math.abs(best-target))) best=x; } }
        else if (crossClear(c,z0,z1,te,target,y,R)) best=target;
        if (best==null){ if (dist<1.8){ out.wait=true; m.waited+=dt; if (m.waited>m.patience) m.careless=true; } }
        else if (h.solid){ out.x=best; if (dist<0.4) m.x=best; }
      }
      if (h.solid&&m.x!=null&&s.d<=z1+T.radius) out.x=m.x;      // committed to a lane: hold it through the row
      if (h.type==="sweeper"&&s.grounded){                                // an arm is coming: hop it (if we notice in time)
        let th=-1; for (let k=1;k<=10;k++){ const tau=k*0.05; if (hazardContact(h,t+tau,s.d+s.vd*tau,s.x+s.vx*tau,s.y,T.radius+0.1)){ th=tau; break; } }
        if (th<0) m.react=null;
        else { if (m.react==null) m.react=b.r()<0.4+0.6*sk; if (m.react&&th<=0.2+0.08*(1-sk)*(b.r()-0.3)) out.jump=true; }
      }
    }
    return out;
  }

  // ---- bots vs moving footing (Map 2): tiles, trapdoors, seesaws, gumball lanes. Returns { x, wait, noHole } or null.
  function floorPlan(b,s,t,dt,target,useTiles){
    const c=b.c, sk=b.skill, out={ x:null, wait:false, noHole:false };
    // TIP-TOE TILES: pick a tile in the row ahead. Better bots "know" (= watched others) real tiles more often; everyone
    // avoids tiles seen wobbling/dropping and tiles they fell through. Weaker bots hesitate on tiles (and so can drop).
    if (useTiles) for (const F of c.tiles){ if (s.d<F.d0-2.5||s.d>F.d1) continue;
      const pitch=F.td+F.gap, row=Math.max(0,Math.min(F.rows-1,Math.floor((s.d+1.1-F.d0)/pitch)));
      const cur=s.grounded?gridCell(F,s.d,s.x):null;
      if (cur&&cur.fake&&cur.trig>=0) b.badTile.add(F.i*1000+cur.n);
      const seen=q=>b.badTile.has(F.i*1000+q.n)||!tileIdle(q,t)&&q.fake;
      const key=F.i*100+row; let k=b.tile[key];
      if (k!=null&&seen(F.cells[row*F.cols+k])&&!(cur&&cur.r===row)) k=null;
      if (k==null){ const cells=F.cells.slice(row*F.cols,row*F.cols+F.cols), ok=cells.filter(q=>!seen(q)), pool=ok.length?ok:cells;
        const know=b.r()<0.4+0.5*sk, real=pool.filter(q=>!q.fake);
        const near=a=>a.reduce((m,q)=>Math.abs((q.x0+q.x1)/2-s.x)<Math.abs((m.x0+m.x1)/2-s.x)?q:m);
        const pick=know&&real.length?near(real):b.r()<0.5?near(pool):pool[Math.floor(b.r()*pool.length)];
        k=b.tile[key]=pick.k;
        if (b.lastRow!==key&&s.d>F.d0-0.5&&b.r()<0.4*(1-sk)) b.pause=0.4+b.r()*0.9*(1-sk);   // a kid stops to look
        b.lastRow=key; }
      const q=F.cells[row*F.cols+k]; out.x=(q.x0+q.x1)/2+clamp(b.off,-1,1)*0.35;
      if (tileDrop(q,t)>0.3&&!(cur&&cur.r===row)&&q.d0-s.d<1.6) out.wait=true;       // it's down right now: wait for it
      return out; }
    // TRAPDOORS: row by row — step onto the panel (in my column, or one beside it) that will still be up when I get
    // there and while I cross it; if none, wait on solid ground; if my own panel is about to go, move anyway.
    for (const F of c.traps){ if (s.d<F.d0-3||s.d>F.d1+0.2||!useTiles) continue;
      out.noHole=true;
      const m=b.trap, pitch=F.td+F.gap, v=T.run*0.85, cx=k=>F.x0+k*(F.tw+F.gap)+F.tw/2;
      { const cr=s.d<F.d0?-1:Math.min(F.rows-1,Math.floor((s.d-F.d0)/pitch)), nr=cr+1;
        const cur=cr>=0?F.cells[cr*F.cols+Math.max(0,Math.min(F.cols-1,Math.floor((s.x-F.x0)/(F.tw+F.gap))))]:null;
        if (nr>=F.rows){ m.x=null; m.wait=false; }
        else { if (m.row!==nr){ m.row=nr; m.err=(b.r()-0.5)*0.9*(1-sk); m.bold=b.r()<0.3*(1-sk); }   // one timing guess per row
          const dist=Math.max(0,F.d0+nr*pitch-s.d-T.radius), need=F.td/v+0.3+0.2*sk;
          const sfAt=(k,side)=>trapSolidFor(F.cells[nr*F.cols+k],t+dist/v+side+m.err);
          let k=cur?cur.k:null;
          if (k==null){ let bs=-1;                                       // on the landing: pick the best column
            for (let j=0;j<F.cols;j++){ const side=Math.abs(cx(j)-s.x)/T.run*0.8, sc=Math.min(sfAt(j,side),3)-side*0.5; if (sc>bs){ bs=sc; k=j; } } }
          const mineGoing=cur&&trapSolidFor(cur,t)<0.7;
          if (mineGoing&&sfAt(k,0)<need){ let bs=-1;                    // my panel is about to drop and the next one isn't safe: dodge sideways
            for (const j of [k-1,k+1]){ if (j<0||j>=F.cols) continue; const sc=trapSolidFor(F.cells[cr*F.cols+j],t); if (sc>bs){ bs=sc; m.dodge=j; } }
            m.x=cx(m.dodge); m.wait=true; }
          else { const ok=sfAt(k,0)>=need;
            m.wait=!ok&&!m.bold&&dist<1.3; m.x=cx(k); } } }
      out.x=m.x; out.wait=m.wait; return out; }
    // SEESAWS: step on when it will stay fairly level for the crossing; on it, keep to the high side.
    for (const q of c.seesaws){ const dist=q.d0-s.d;
      if (s.d>=q.d0-0.3&&s.d<=q.d1+0.2){ const a=seesawA(q,t); out.x=q.cx+Math.sign(a)*Math.min(1.3,Math.abs(a)*5)*(0.4+0.6*sk); return out; }
      if (dist>0&&dist<2.4){ const m=b.ss[q.i]||(b.ss[q.i]={ err:(b.r()-0.5)*0.8*(1-sk), careless:b.r()<0.35*(1-sk), waited:0, patience:2+b.r()*4 });
        const eta=Math.max(0,dist-0.3)/(T.run*0.9), cross=(q.d1-q.d0)/(T.run*0.85);
        if (!m.careless&&!seesawCalm(q,t+eta+m.err,t+eta+m.err+cross*0.6,0.19+0.06*(1-sk))&&dist<1.5){ out.wait=true; m.waited+=dt; if (m.waited>m.patience) m.careless=true; }
        out.x=q.cx; return out; }
      if (s.d<q.d0-6) delete b.ss[q.i]; }
    // GUMBALL LANES: every so often pick the lane whose next ball is furthest away (weaker bots look less often).
    for (const h of c.hazards){ if (h.type!=="gumball"||s.d<h.d0-2.5||s.d>h.d1+0.5) continue;
      const G=b.gum, v=T.run*0.8;
      if (t>=G.at||G.L==null){ G.at=t+0.12+0.45*(1-sk)+b.r()*0.15;
        const balls=gumBalls(h,t), danger=L=>{ let best=9;
          for (const B of balls){ if (B.lane!==L) continue; const gap=B.d-s.d; if (gap<-1.4) continue;
            const tau=Math.max(0,(gap-(B.r+T.radius+0.4))/(v+h.speed)); if (tau<best) best=tau; } return best; };
        let L0=0; for (let L=0;L<h.lanes.length;L++) if (Math.abs(h.lanes[L]-s.x)<Math.abs(h.lanes[L0]-s.x)) L0=L;
        if (G.L==null) G.L=L0;
        const keep=danger(G.L)-Math.abs(h.lanes[G.L]-s.x)/T.run;
        if (keep<1.3+0.4*sk){ let best=G.L, bt=keep;
          for (let L=0;L<h.lanes.length;L++){ const dL=danger(L)-Math.abs(h.lanes[L]-s.x)/T.run-(b.r()-0.5)*0.8*(1-sk); if (dL>bt+0.2){ bt=dL; best=L; } }
          G.L=best; } }
      out.x=h.lanes[G.L]+clamp(b.off,-1,1)*0.3; return out; }
    return null;
  }

  const ANIM={ idle:0, run:1, air:2, fallen:3, dive:4, veil:5 };
  const COURSE=MAPS?course(MAPS.DEFAULT):null;              // legacy: default course (COURSE.CHECKPOINTS = depths)
  return { T, MAPS, compile, course, COURSE, moverK, moverPos, padReady, PAD_FLIGHT, hazardShape, hazardContact, hazardContacts, gateBoxes, probe, groundAt, halfWidthAt, spawn, respawnAt, rng, makeBot, botInput, roomAt, ANIM,
    applySeed, seesawA, seesawTop, seesawSlide, tileDrop, tileWobble, tileIdle, trapState, trapDrop, gumBalls, pistonX, pistonWarn, gridCell };
});
