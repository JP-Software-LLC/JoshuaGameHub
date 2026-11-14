// Bear Attack! — shared simulation (Node: require; browser: window.BEAR for solo mode).
// Top-down round ice sheet, up to 40 players, one bear in the middle.
// Server-authoritative online: clients only send their stick direction.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BEAR = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

// ------------------------------------------------------------
//  TUNING (units ≈ metres, seconds)
// ------------------------------------------------------------
const T = {
  R0: 16, Rmin: 5, shrink: 0.84,       // ice radius, smallest ice, shrink per round
  pR: 0.8, bearR: 2.1,                // body radii
  maxV: 7,                            // top skating speed
  accel: 1.6,                         // how fast speed eases toward your input (slow take-off)
  glide: 0.55,                        // how fast you slow down with no input (ice: you keep sliding)
  bump: 0.85,                         // bounciness when players bump each other
  wake: [5, 3],                       // bear wake-up: first round, later rounds
  warn0: 2.0, warnStep: 0.3, warnMin: 0.6,   // red path warning time, shortened each round
  dashes: 3, dashV: 30, pause: 0.8,
  minDash: 0.55,                      // a dash is at least this × ice radius long
  hitV: 19,                           // shove speed
  shrinkT: 2.2,
};
const warnFor=round=>Math.max(T.warnMin, T.warn0-(round-1)*T.warnStep);

function rng(seed){ let a=seed>>>0; return ()=>{ a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// ------------------------------------------------------------
//  GAME
//  phases: wake → (warn → dash → pause) × 3 → shrink → wake …  → over
//  events: wake, warn{sx,sy,tx,ty,dur}, dash, hit{id}, frozen{id}, shrink{R}, round{n}, over{winners}
// ------------------------------------------------------------
class Game {
  constructor(players, seed=(Math.random()*2**31)|0){
    this.r=rng(seed); this.events=[]; this.time=0;
    this.R=T.R0; this.Rfrom=T.R0; this.Rto=T.R0;
    this.round=1; this.dashN=0;
    this.bear={ x:0, y:0, sx:0, sy:0, tx:0, ty:0, dx:0, dy:1, face:Math.PI/2 };
    this.players=players.map(p=>({ id:p.id, name:p.name, bot:!!p.bot, x:0, y:0, vx:0, vy:0, ix:0, iy:0, alive:true, outT:null, outRound:null, hits:0, hitCD:0 }));
    this.spawn();
    this.setPhase("wake", T.wake[0]);
    this.solo=this.players.length===1;
  }
  emit(type,data){ this.events.push(Object.assign({ type },data)); }
  drainEvents(){ const e=this.events; this.events=[]; return e; }
  setPhase(p,dur){ this.phase=p; this.timer=dur; this.phaseDur=dur; }
  alive(){ return this.players.filter(p=>p.alive); }
  // random spread-out spawn, away from the bear and from each other
  spawn(){
    const placed=[];
    for (const p of this.players){
      let best=null, bestD=-1;
      for (let k=0;k<30;k++){
        const a=this.r()*Math.PI*2, d=Math.sqrt(0.18+this.r()*0.72)*(this.R-1.5), x=Math.cos(a)*d, y=Math.sin(a)*d;
        let m=Infinity; for (const q of placed) m=Math.min(m,Math.hypot(q.x-x,q.y-y));
        if (m>bestD){ bestD=m; best={ x, y }; } if (m>2.2) break;
      }
      p.x=best.x; p.y=best.y; placed.push(best);
    }
  }
  setInput(id,ix,iy){ const p=this.players.find(q=>q.id===id); if (!p) return;
    const m=Math.hypot(ix,iy); if (m>1){ ix/=m; iy/=m; } p.ix=ix||0; p.iy=iy||0; }

  // choose a straight dash: random direction, random length between a minimum and the ice edge
  pickDash(){
    const b=this.bear, lim=this.R-T.bearR, minD=T.minDash*this.R;
    for (let k=0;k<60;k++){
      const a=this.r()*Math.PI*2, ux=Math.cos(a), uy=Math.sin(a);
      const bu=b.x*ux+b.y*uy, disc=bu*bu-(b.x*b.x+b.y*b.y)+lim*lim;
      if (disc<0) continue;
      const maxD=-bu+Math.sqrt(disc);
      if (maxD<minD) continue;
      const d=minD+this.r()*(maxD-minD);
      return { tx:b.x+ux*d, ty:b.y+uy*d };
    }
    const d=Math.hypot(b.x,b.y)||1;                              // fallback: straight through the middle
    return { tx:-b.x/d*lim*0.8, ty:-b.y/d*lim*0.8 };
  }

  step(dt){
    if (this.phase==="over") return;
    this.time+=dt; this.timer-=dt;
    const b=this.bear;
    // ---- bear / phase machine
    switch (this.phase){
      case "wake": if (this.timer<=0) this.startWarn(); break;
      case "warn": if (this.timer<=0){ this.setPhase("dash",99); this.emit("dash",{}); } break;
      case "dash": {
        const rx=b.tx-b.x, ry=b.ty-b.y, rem=Math.hypot(rx,ry), stepL=T.dashV*dt;
        if (rem<=stepL){ b.x=b.tx; b.y=b.ty; this.dashN++;
          if (this.dashN>=T.dashes) this.startShrink(); else this.setPhase("pause",T.pause); }
        else { b.x+=rx/rem*stepL; b.y+=ry/rem*stepL; }
        break; }
      case "pause": if (this.timer<=0) this.startWarn(); break;
      case "shrink": {
        const k=1-Math.max(0,this.timer)/T.shrinkT, e=k*k*(3-2*k);
        this.R=this.Rfrom+(this.Rto-this.Rfrom)*e;
        b.x=b.sx*(1-e); b.y=b.sy*(1-e);                            // bear waddles back to the middle
        if (this.timer<=0){ this.R=this.Rto; b.x=0; b.y=0; this.round++; this.dashN=0;
          this.emit("round",{ n:this.round }); this.setPhase("wake",T.wake[1]); }
        break; }
    }
    // ---- players: ice physics (speed eases toward the stick, long glide when you let go)
    for (const p of this.players){
      if (!p.alive) continue;
      const hasIn=p.ix||p.iy, k=1-Math.exp(-(hasIn?T.accel:T.glide)*dt);
      p.vx+=(p.ix*T.maxV-p.vx)*(hasIn||Math.hypot(p.vx,p.vy)<=T.maxV?k:k*2);
      p.vy+=(p.iy*T.maxV-p.vy)*(hasIn||Math.hypot(p.vx,p.vy)<=T.maxV?k:k*2);
      p.x+=p.vx*dt; p.y+=p.vy*dt; p.hitCD=Math.max(0,p.hitCD-dt);
    }
    // ---- player bumps (soft, a bit bouncy)
    const A=this.alive();
    for (let i=0;i<A.length;i++) for (let j=i+1;j<A.length;j++){
      const p=A[i], q=A[j], dx=q.x-p.x, dy=q.y-p.y, d=Math.hypot(dx,dy), min=T.pR*2;
      if (d>=min||d===0) continue;
      const nx=dx/d, ny=dy/d, over=(min-d)/2;
      p.x-=nx*over; p.y-=ny*over; q.x+=nx*over; q.y+=ny*over;
      const rel=(q.vx-p.vx)*nx+(q.vy-p.vy)*ny;
      if (rel<0){ const j2=-(1+T.bump)*rel/2; p.vx-=j2*nx; p.vy-=j2*ny; q.vx+=j2*nx; q.vy+=j2*ny; }
    }
    // ---- bear shoves anyone in front of it while charging
    if (this.phase==="dash"){
      for (const p of A){
        const dx=p.x-b.x, dy=p.y-b.y, d=Math.hypot(dx,dy);
        if (d>T.bearR+T.pR || p.hitCD>0) continue;
        const nx=d?dx/d:b.dx, ny=d?dy/d:b.dy;
        p.vx=nx*T.hitV*0.75+b.dx*T.hitV*0.65; p.vy=ny*T.hitV*0.75+b.dy*T.hitV*0.65;
        p.x=b.x+nx*(T.bearR+T.pR+0.05); p.y=b.y+ny*(T.bearR+T.pR+0.05);
        p.hitCD=0.5; p.hits++; this.emit("hit",{ id:p.id });
      }
    }
    // ---- shrinking ice gently herds players inward (nobody falls off during a shrink)
    if (this.phase==="shrink"){
      for (const p of A){ const d=Math.hypot(p.x,p.y), lim=this.R-T.pR;
        if (d>lim){ const ux=p.x/d, uy=p.y/d; p.x=ux*lim; p.y=uy*lim; const out=p.vx*ux+p.vy*uy; if (out>0){ p.vx-=out*ux; p.vy-=out*uy; } } }
    }
    // ---- fall off the edge → FROZEN!
    for (const p of A) if (Math.hypot(p.x,p.y)>this.R+T.pR*0.3){
      p.alive=false; p.outT=this.time; p.outRound=this.round; this.emit("frozen",{ id:p.id }); }
    // ---- game over: last one on the ice (or solo player falls)
    const left=this.alive();
    if ((!this.solo && left.length<=1) || !left.length){
      const winners=left.length?[left[0].id]:this.lastOut();
      this.setPhase("over",0); this.emit("over",{ winners });
    }
  }
  lastOut(){ const t=Math.max(...this.players.map(p=>p.outT??-1)); return this.players.filter(p=>p.outT===t).map(p=>p.id); }
  startWarn(){
    const b=this.bear, d=this.pickDash(), dur=warnFor(this.round);
    b.sx=b.x; b.sy=b.y; b.tx=d.tx; b.ty=d.ty;
    const L=Math.hypot(b.tx-b.x,b.ty-b.y)||1; b.dx=(b.tx-b.x)/L; b.dy=(b.ty-b.y)/L; b.face=Math.atan2(b.dy,b.dx);
    this.setPhase("warn",dur); this.emit("warn",{ sx:b.x, sy:b.y, tx:b.tx, ty:b.ty, dur });
  }
  startShrink(){
    const b=this.bear; b.sx=b.x; b.sy=b.y;
    this.Rfrom=this.R; this.Rto=Math.max(T.Rmin,this.R*T.shrink);
    this.setPhase("shrink",T.shrinkT); this.emit("shrink",{ R:this.Rto });
  }
  // final ranking: still on the ice first, then whoever stayed on longest
  ranking(){
    return [...this.players].sort((a,b)=>(b.alive-a.alive)||((b.outT??1e9)-(a.outT??1e9)))
      .map(p=>({ id:p.id, name:p.name, alive:p.alive, time:p.alive?this.time:p.outT, rounds:(p.alive?this.round:p.outRound)-1, hits:p.hits }));
  }
  snapshot(){
    const r=v=>Math.round(v*100)/100, b=this.bear;
    return { ph:this.phase, tm:r(this.timer), pd:r(this.phaseDur), rd:this.round, dn:this.dashN, R:r(this.R),
      b:[r(b.x),r(b.y),r(b.face)], w:this.phase==="warn"||this.phase==="dash"?[r(b.sx),r(b.sy),r(b.tx),r(b.ty)]:null,
      p:this.players.map(p=>[p.id,r(p.x),r(p.y),p.alive?1:0,p.hitCD>0.3?1:0]) };
  }
}

// ------------------------------------------------------------
//  BOT (solo mode): stay off the red path, keep away from the edge and the bear
// ------------------------------------------------------------
function botThink(g, p, bot){
  bot.t-=1/30; if (bot.t>0) return; bot.t=bot.react*(0.6+g.r()*0.8);
  let fx=0, fy=0;
  const b=g.bear;
  const d0=Math.hypot(p.x,p.y); if (d0>0.1){ const edge=d0/g.R; fx-=p.x/d0*Math.pow(edge,3)*2.2; fy-=p.y/d0*Math.pow(edge,3)*2.2; }   // stay off the edge
  const bx=p.x-b.x, by=p.y-b.y, bd=Math.hypot(bx,by)||1; if (bd<6){ fx+=bx/bd*(6-bd)/6; fy+=by/bd*(6-bd)/6; }   // keep clear of the bear
  if ((g.phase==="warn"||g.phase==="dash") && g.r()>bot.blind){           // dodge sideways off the red path
    const ux=b.dx, uy=b.dy, rx=p.x-b.sx, ry=p.y-b.sy, along=rx*ux+ry*uy, L=Math.hypot(b.tx-b.sx,b.ty-b.sy);
    const perp=rx*(-uy)+ry*ux;
    if (along>-T.bearR && along<L+T.bearR && Math.abs(perp)<T.bearR+T.pR+1.6){ const s=perp>=0?1:-1; fx+=-uy*s*2.5; fy+=ux*s*2.5; }
  }
  fx+=(g.r()-0.5)*bot.noise; fy+=(g.r()-0.5)*bot.noise;
  const m=Math.hypot(fx,fy); g.setInput(p.id, m>0.15?fx/Math.max(1,m):0, m>0.15?fy/Math.max(1,m):0);
}
const makeBot=(skill)=>({ t:0, react:0.45-0.3*skill, blind:0.45*(1-skill), noise:0.6*(1-skill) });

return { T, warnFor, rng, Game, botThink, makeBot };
});
