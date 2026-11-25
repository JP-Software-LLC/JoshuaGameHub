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
    const c={ map, id:map.id, length:map.length, solids:[], ramps:[], pads:[], belts:[], movers:[], doors:[], jelly:[], signs:[],
      rooms:map.rooms||[], buckets:new Map() };
    for (const p of map.pieces||[]){
      switch (p.type){
        case "floor": case "block": case "wall": case "rail": c.solids.push(p); break;
        case "ramp": c.ramps.push(p); break;
        case "pad": c.pads.push(p); c.solids.push(p); break;
        case "belt": c.belts.push(p); c.solids.push(p); break;
        case "mover": c.movers.push(p); break;
        case "sign": c.signs.push(p); break;
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

  // ---- ground under (d,x) at race time t: highest walkable top ≤ yMax(+0.3). -Infinity over a gap. ----
  const PR={ g:-Infinity, p:null };
  function probe(c,d,x,t,yMax){
    const lim=yMax==null?Infinity:yMax+0.3; let g=-Infinity, hit=null;
    const B=c.buckets.get(Math.floor(d/BUCKET));
    if (B) for (const b of B){
      if (b.type==="mover"){ const p=moverPos(b,t); if (Math.abs(d-p.d)<=b.len/2&&Math.abs(x-p.x)<=b.w/2&&p.top<=lim&&p.top>g){ g=p.top; hit=b; } continue; }
      if (d<b.d0||d>b.d1||x<b.x0||x>b.x1) continue;
      const top=b.type==="ramp"?b.top0+(b.top1-b.top0)*(d-b.d0)/(b.d1-b.d0):b.top;
      if (top<=lim&&top>g){ g=top; hit=b; }
    }
    PR.g=g; PR.p=hit; return PR;
  }
  const groundAt=(c,d,x,t,yMax)=>probe(c,d,x,t,yMax).g;
  // widest walkable half-width at depth d (arches, signs, flags)
  function halfWidthAt(c,d){
    let w=0; const B=c.buckets.get(Math.floor(d/BUCKET))||[];
    for (const b of B) if ((b.type==="floor"||b.type==="belt"||b.type==="pad"||(b.type==="ramp"&&b.c!=="edge"))&&d>=b.d0&&d<=b.d1) w=Math.max(w,Math.abs(b.x0),Math.abs(b.x1));
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
  function makeBot(seed,skill,c){ const r=rng(seed); c=c||course(); return { r, skill, c, off:r()*2-1, think:0, pause:0, wobble:r()*6, route:{}, mir:{}, door:{}, bad:{}, diveArm:false, wasBonk:false, stuck:0 }; }
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
    if (!s.grounded) inp.jump=false;
    if (b.r()<0.002*(1-b.skill)) b.pause=0.3+b.r()*0.6;    // a little stumble now and then
    inp.mz*=0.82+0.18*b.skill;
    return inp;
  }

  const ANIM={ idle:0, run:1, air:2, fallen:3, dive:4, veil:5 };
  const COURSE=MAPS?course(MAPS.DEFAULT):null;              // legacy: default course (COURSE.CHECKPOINTS = depths)
  return { T, MAPS, compile, course, COURSE, moverK, moverPos, padReady, PAD_FLIGHT, probe, groundAt, halfWidthAt, spawn, respawnAt, rng, makeBot, botInput, roomAt, ANIM };
});
