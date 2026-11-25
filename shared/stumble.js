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
    hitPush:6.8,       // sideways speed (m/s) a hit gives you, along the hazard's motion. ≈ how far you fly: 6.8 → ~3.5 m
    hitUp:5,           // upward pop on a hit (m/s): 5 → ~0.5 m high, ~0.42 s in the air
    hitStun:0.55,      // seconds of stumble after a hit: reduced control, momentum kept
    hitControl:0.25,   // how much of your steering works during the stumble (0..1)
    hitDrag:1.5,       // air deceleration during the stumble (m/s², low = the throw carries)
    hitSlide:11,       // ground deceleration during the stumble (m/s², lower = slide further after landing)
    hitImmune:0.9,     // no new hit for this long after a hit (counted from the hit; > hitStun so you aren't juggled)
    hitMinSpd:0.6,     // hazard slower than this at the contact point = a soft bump straight out, not a throw
    hitSoft:0.45,      // soft bump strength (× hitPush / hitUp): slow hazards, or running into the back of an arm
    hitAlong:0.35,     // how much the throw leans outward from the hazard (0 = exactly along its motion)
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
      rooms:map.rooms||[], buckets:new Map() };
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
        case "sweeper": case "pendulum": case "gate": { const h=compileHazard(p,c.hazards.length); c.hazards.push(h);
          if (h.hub) c.solids.push(h.hub); break; }
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
    else { h.h=p.h??1.9; h.thick=p.thick??0.8; h.hold=p.hold??0.2; h.phase=p.phase||0; h.gap=p.gap||0; h.z0=h.d-h.thick/2; h.z1=h.d+h.thick/2; }
    return h;
  }
  const gateX=(h,t)=>h.xA+(h.xB-h.xA)*moverK(h,t);
  function gateBoxes(h,cx){
    const y0=h.top, y1=h.top+h.h, d0=h.d-h.thick/2, d1=h.d+h.thick/2;
    if (!h.gap) return [{ x0:cx-h.w/2, x1:cx+h.w/2, d0, d1, y0, y1 }];
    return [{ x0:cx-h.w/2, x1:cx-h.gap/2, d0, d1, y0, y1 }, { x0:cx+h.gap/2, x1:cx+h.w/2, d0, d1, y0, y1 }];
  }
  function hazardShape(h,t){
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

  // ---- ground under (d,x) at race time t: highest walkable top ≤ yMax(+0.3). -Infinity over a gap. ----
  const PR={ g:-Infinity, p:null };
  function probe(c,d,x,t,yMax){
    const lim=yMax==null?Infinity:yMax+0.3; let g=-Infinity, hit=null;
    const B=c.buckets.get(Math.floor(d/BUCKET));
    if (B) for (const b of B){
      if (b.type==="mover"){ const p=moverPos(b,t); if (Math.abs(d-p.d)<=b.len/2&&Math.abs(x-p.x)<=b.w/2&&p.top<=lim&&p.top>g){ g=p.top; hit=b; } continue; }
      if (d<b.d0||d>b.d1||x<b.x0||x>b.x1) continue;
      if (b.round&&(d-b.cd)*(d-b.cd)+(x-b.cx)*(x-b.cx)>b.r*b.r) continue;
      const top=b.type==="ramp"?b.top0+(b.top1-b.top0)*(d-b.d0)/(b.d1-b.d0):b.top;
      if (top<=lim&&top>g){ g=top; hit=b; }
    }
    PR.g=g; PR.p=hit; return PR;
  }
  const groundAt=(c,d,x,t,yMax)=>probe(c,d,x,t,yMax).g;
  // widest walkable half-width at depth d (arches, signs, flags)
  function halfWidthAt(c,d){
    let w=0; const B=c.buckets.get(Math.floor(d/BUCKET))||[];
    for (const b of B) if ((b.type==="floor"||b.type==="belt"||b.type==="pad"||b.type==="deck"||(b.type==="ramp"&&b.c!=="edge"))&&d>=b.d0&&d<=b.d1) w=Math.max(w,Math.abs(b.x0),Math.abs(b.x1));
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
  function makeBot(seed,skill,c){ const r=rng(seed); c=c||course(); return { r, skill, c, off:r()*2-1, think:0, pause:0, wobble:r()*6, route:{}, mir:{}, door:{}, bad:{}, diveArm:false, wasBonk:false, stuck:0, hz:{} }; }
  function roomAt(c,d){ const R=c.rooms; for (let i=0;i<R.length;i++) if (d<R[i].d1) return i; return Math.max(0,R.length-1); }
  function lineAt(pts,d){
    if (d<=pts[0][0]) return pts[0];
    for (let i=1;i<pts.length;i++) if (d<=pts[i][0]){ const a=pts[i-1], b=pts[i], k=(d-a[0])/((b[0]-a[0])||1); return [d,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k]; }
    return pts[pts.length-1];
  }
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function botInput(b,s,t,dt){
    const c=b.c, inp={ mx:0, mz:1, jump:false, press:false };
    if (s.quiz>=0||s.fallen>0) return { mx:0, mz:0, jump:false, press:false };
    b.think-=dt; if (b.think<=0){ b.think=0.8+b.r()*1.5; if (b.r()<0.4) b.off=b.r()*2-1; }
    if (b.pause>0){ b.pause-=dt; inp.mz=0; }
    // 1. where to steer: the room's line (safe or fast route, maybe mirrored) + this bot's own offset
    const look=s.d+1.5, ri=roomAt(c,look), room=c.rooms[ri]||{ d0:0, d1:c.length };
    const B=room.bot||{ safe:[[room.d0,0,4],[room.d1,0,4]] };
    if (!(ri in b.route)){ b.route[ri]=B.fast&&b.r()<0.2+0.7*b.skill?"fast":"safe"; b.mir[ri]=B.mirror&&b.r()<0.5?-1:1; }
    const L=lineAt(B[b.route[ri]]||B.safe,look); let target=L[1]*b.mir[ri]+b.off*L[2]*0.8;
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
    }
    // 3. don't run into tall things: slide the target sideways to the nearest clear lane
    const g0=s.grounded?s.y:groundAt(c,s.d,s.x,t,s.y);
    const tall=(x)=>{ for (let k=0.6;k<=3;k+=0.6){ const g=groundAt(c,s.d+k,x,t,g0+3); if (g>g0+1.3) return true; } return false; };
    if (s.grounded&&tall(target)){ for (const o of [0.8,-0.8,1.6,-1.6,2.4,-2.4,3.2,-3.2,4.5,-4.5]) if (!tall(target+o)&&groundAt(c,s.d+1.5,target+o,t,g0+0.5)>g0-0.5){ target+=o; break; } }
    const hz=c.hazards.length&&!(s.hit>0)?hazardPlan(b,s,t,dt,target):null;
    if (hz&&hz.x!=null) target=hz.x;
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
        if (g<gp-1.0){ hole=k; break; }                     // small drops (off a hop wall, into the candy pit) are just walked
        gp=g; }
      const lead=0.35+0.55*b.skill+Math.max(0,s.vd)*0.03;
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
      const dist=h.z0-T.radius-s.d;
      if (s.d<h.z0-6){ delete b.hz[h.i]; continue; }                 // fell back behind it: decide afresh next time
      if (s.d>h.z1+T.radius||dist>3.5) continue;
      const m=b.hz[h.i]||(b.hz[h.i]={ err:(b.r()-0.5)*1.1*(1-sk), careless:b.r()<0.3*(1-sk)*(1-sk), waited:0, x:null, react:null,
        margin:0.15+0.3*sk, patience:3+b.r()*4 });
      // group = every hazard sharing this zone (two gates side by side): cross all of them at once
      let z0=h.z0, z1=h.z1; for (const g of c.hazards) if (g.z0<z1&&g.z1>z0){ z0=Math.min(z0,g.z0); z1=Math.max(z1,g.z1); }
      if (dist>0&&!m.careless&&m.x==null){
        const eta=Math.max(0,dist)/HZ_V, te=t+eta+m.err, R=T.radius+m.margin, y=s.y;
        let best=null;
        if (h.type==="gate"){ const hw=halfWidthAt(c,h.d)-0.7;
          for (let x=-hw;x<=hw+0.01;x+=0.5){ const lag=Math.abs(x-s.x)/T.run*0.6;
            if (crossClear(c,z0,z1,te+lag,x,y,R)&&(best==null||Math.abs(x-target)<Math.abs(best-target))) best=x; } }
        else if (crossClear(c,z0,z1,te,target,y,R)) best=target;
        if (best==null){ if (dist<1.8){ out.wait=true; m.waited+=dt; if (m.waited>m.patience) m.careless=true; } }
        else if (h.type==="gate"){ out.x=best; if (dist<0.4) m.x=best; }
      }
      if (h.type==="gate"&&m.x!=null&&s.d<=z1+T.radius) out.x=m.x;      // committed to a lane: hold it through the row
      if (h.type==="sweeper"&&s.grounded){                                // an arm is coming: hop it (if we notice in time)
        let th=-1; for (let k=1;k<=10;k++){ const tau=k*0.05; if (hazardContact(h,t+tau,s.d+s.vd*tau,s.x+s.vx*tau,s.y,T.radius+0.1)){ th=tau; break; } }
        if (th<0) m.react=null;
        else { if (m.react==null) m.react=b.r()<0.4+0.6*sk; if (m.react&&th<=0.2+0.08*(1-sk)*(b.r()-0.3)) out.jump=true; }
      }
    }
    return out;
  }

  const ANIM={ idle:0, run:1, air:2, fallen:3, dive:4, veil:5 };
  const COURSE=MAPS?course(MAPS.DEFAULT):null;              // legacy: default course (COURSE.CHECKPOINTS = depths)
  return { T, MAPS, compile, course, COURSE, moverK, moverPos, padReady, PAD_FLIGHT, hazardShape, hazardContact, hazardContacts, gateBoxes, probe, groundAt, halfWidthAt, spawn, respawnAt, rng, makeBot, botInput, roomAt, ANIM };
});
