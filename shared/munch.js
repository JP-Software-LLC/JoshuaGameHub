// Marble Munch — shared rules (browser: window.MUNCH, Node: require). Server-authoritative online, also runs solo.
// Every player is a hippo on the rim of a round bowl. Marbles are let into the bowl a few at a time and roll
// around it: a pull toward the middle (the bowl's slope) makes each one trace an ellipse that slowly turns
// (rosette), and they bounce off the rim. Press Space as fast as you like: each press is one chomp (the head
// lunges into the bowl). A marble inside your jaws during a chomp is caught → a math question pops up.
// Answer before the timer (teacher picks 2–10 s, default 4) → you keep it. Wrong or too slow → you spit it back.
// The game ends when every marble has been kept (3 per player) or after T.maxT.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MUNCH = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

const T = {
  R: 10,                  // bowl radius
  mr: 0.42,               // marble radius
  k: 3.6,                 // pull toward the middle (ω² — one loop ≈ 3.3 s)
  bend: 0.3,              // extra pull near the rim → the ellipses slowly turn
  ampMin: 0.9, ampMax: 1.15,   // each marble's swing, as a share of R (so they all reach the hippos)
  thin: 0.4, spin: 0.22,              // ellipse width ÷ length at most (rounder orbits would never reach the rim)
  reach: 2.6,             // how far a chomp reaches into the bowl from the rim
  chompT: 0.26,           // jaws open + lunge
  chompCd: 0.1,           // after a chomp, before the next one
  perPlayer: 3, minMarbles: 8,
  qTime: 4, qMin: 2, qMax: 10,
  spitImmune: 1.2,        // the spitter can't catch the same marble straight back
  maxT: 6 * 60,
};
const MODES = ["add", "sub", "mul", "div", "money"];

function rng(seed){ let a=seed>>>0; return ()=>{ a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const cash=c=>"$"+Math.floor(c/100)+"."+String(c%100).padStart(2,"0");
// Same generator and options as Math Race. Every question is { top, bottom, op, s (answer), len (digits to type), money }.
function questionStream(seed, mode="add", digits="12"){
  const r=rng(seed), int=(lo,hi)=>lo+(r()*(hi-lo+1)|0), num=()=>r()<0.3 ? int(1,9) : int(10,99);
  const D=digits==="1"||digits==="2"?digits:"12";
  let prev="";
  const make={
    add(){ if (D==="1"){ const a=int(1,9), b=int(1,9); return { top:Math.max(a,b), bottom:Math.min(a,b), op:"+", s:a+b }; }
      if (D==="2"){ const a=int(10,99), b=int(10,99); return { top:Math.max(a,b), bottom:Math.min(a,b), op:"+", s:a+b }; }
      const a=num(), b=num(), s=a+b; return s<10?null:{ top:Math.max(a,b), bottom:Math.min(a,b), op:"+", s }; },
    sub(){ if (D==="1"){ const a=int(2,9), b=int(1,a-1); return { top:a, bottom:b, op:"−", s:a-b }; }
      if (D==="2"){ const a=int(20,99), b=int(10,a-1); return { top:a, bottom:b, op:"−", s:a-b }; }
      const a=int(20,99), b=int(1,a-10); return { top:a, bottom:b, op:"−", s:a-b }; },
    mul(){ if (D==="1"){ const a=int(2,9), b=int(2,9); return { top:Math.max(a,b), bottom:Math.min(a,b), op:"×", s:a*b }; }
      if (D==="2"){ const a=int(10,20), b=int(10,15); return { top:Math.max(a,b), bottom:Math.min(a,b), op:"×", s:a*b }; }
      const a=int(2,12), b=int(2,12); return { top:Math.max(a,b), bottom:Math.min(a,b), op:"×", s:a*b }; },
    div(){ if (D==="1"){ const b=int(1,9), q=int(1,Math.floor(9/b)); if (b===1&&q===1) return null; return { top:b*q, bottom:b, op:"÷", s:q }; }
      if (D==="2"){ const b=int(10,49), q=int(2,9); if (b*q>99) return null; return { top:b*q, bottom:b, op:"÷", s:q }; }
      const b=int(2,12), q=int(2,12); if (b*q>99) return null; return { top:b*q, bottom:b, op:"÷", s:q }; },
    money(){ const a=int(1,199)*5, b=int(1,199)*5; return { top:cash(Math.max(a,b)), bottom:cash(Math.min(a,b)), op:"+", s:a+b, money:true }; },
  }[MODES.includes(mode)?mode:"add"];
  return ()=>{ for(;;){ const q=make(); if (!q) continue;
    const key=q.top+q.op+q.bottom; if (key===prev) continue; prev=key;
    q.len=String(q.s).length; return q; } };
}
// Hippo geometry, shared by the rules and the drawing so the catch zone IS the mouth you see.
// Hippos sit just outside the rim (body centre at R+1.7), facing the middle; sc shrinks them as the class grows.
// A chomp lunges the head straight in (up to T.reach) and back out; ch = chomp time left, 0–1.
const hippoScale=n=>Math.min(1.45,2*Math.PI*(T.R+1.6)/Math.max(1,n)/3.4);
const lungeOf=ch=>ch>0?1-Math.abs(1-2*ch):0;
function mouthAt(n,i,ch){
  const sc=hippoScale(n), a=Math.PI/2+2*Math.PI*i/Math.max(1,n), d=T.R+1.7-1.2*sc-lungeOf(ch)*T.reach;
  return { x:Math.cos(a)*d, y:Math.sin(a)*d, r:0.85*sc, a, sc };
}
const angDiff=(a,b)=>{ let d=(a-b)%(2*Math.PI); if (d>Math.PI) d-=2*Math.PI; if (d<-Math.PI) d+=2*Math.PI; return d; };

class Game {
  // players: [{ id, name }]   opts: { seed, mode, digits, qTime }
  constructor(players, opts={}){
    this.seed=(opts.seed>>>0)||((Math.random()*1e9)|0); this.r=rng(this.seed);
    this.mode=MODES.includes(opts.mode)?opts.mode:"add"; this.digits=opts.digits||"1";
    this.qTime=Math.max(T.qMin,Math.min(T.qMax,+opts.qTime||T.qTime));
    this.players=players.map((p,i)=>this.newPlayer(p,i));
    this.total=Math.max(T.minMarbles,T.perPlayer*this.players.length);
    this.released=0; this.eaten=0; this.marbles=[]; this.nextId=1; this.releaseIn=0.4;
    this.time=0; this.phase="play"; this.events=[];
  }
  newPlayer(p,i){ return { id:p.id, name:p.name, score:0, chomp:0, cd:0, q:null, qLeft:0, held:0, right:0, wrong:0, slow:0, chomps:0, lastT:0,
    stream:questionStream(this.seed+(i+1)*7919, this.mode, this.digits) }; }
  addPlayer(p){ if (this.players.some(q=>q.id===p.id)) return; this.players.push(this.newPlayer(p,this.players.length)); }
  removePlayer(id){ const p=this.players.find(q=>q.id===id); if (!p) return; if (p.q) this.spit(p,"left"); this.players=this.players.filter(q=>q!==p); }
  angleOf(i){ return Math.PI/2+2*Math.PI*i/this.players.length; }     // player 0 at the bottom
  inBowlCap(){ return Math.max(12,Math.ceil(this.players.length*1.2)); }   // doubled: lots of marbles rolling at once
  releaseGap(){ return Math.max(0.375,0.8-this.players.length*0.01); }   // twice as fast as the first version
  release(){
    const a=this.r()*Math.PI*2, r0=T.R*(0.12+this.r()*0.12), A=T.R*(T.ampMin+this.r()*(T.ampMax-T.ampMin));
    const turn=(this.r()<0.5?-1:1)*(0.9+this.r()*0.5), sp=A*Math.sqrt(T.k), va=a+turn;
    this.marbles.push({ id:this.nextId++, x:Math.cos(a)*r0, y:Math.sin(a)*r0, vx:Math.cos(va)*sp, vy:Math.sin(va)*sp, E:0.5*T.k*A*A, imm:0, immT:0, hue:this.r()*360|0 });
    this.released++;
  }
  chomp(id){
    const p=this.players.find(q=>q.id===id);
    if (!p || this.phase!=="play" || p.q || p.chomp>0 || p.cd>0) return false;
    p.chomp=T.chompT; p.chomps++; return true;
  }
  answer(id,v){
    const p=this.players.find(q=>q.id===id); if (!p || !p.q) return "";
    const ok=+v===p.q.s;
    if (ok){ p.score++; p.right++; this.eaten++; p.lastT=this.time; this.events.push({ type:"keep", id, n:p.score }); p.q=null; p.held=0; p.cd=0.2; }
    else { p.wrong++; this.spit(p,"wrong"); }
    if (this.eaten>=this.total) this.end();
    return ok?"right":"wrong";
  }
  spit(p,why){
    const i=this.players.indexOf(p), a=this.angleOf(i), r0=T.R-T.reach-T.mr, A=T.R*(T.ampMin+this.r()*(T.ampMax-T.ampMin));
    const sp=A*Math.sqrt(T.k)*0.75, va=a+Math.PI+(this.r()-0.5)*1.4;          // back into the bowl, a little to one side
    this.marbles.push({ id:this.nextId++, x:Math.cos(a)*r0, y:Math.sin(a)*r0, vx:Math.cos(va)*sp, vy:Math.sin(va)*sp, E:0.5*T.k*A*A, imm:p.id, immT:T.spitImmune, hue:p.held||0 });
    this.events.push({ type:"spit", id:p.id, why, s:p.q?p.q.s:null });
    p.q=null; p.held=0; p.cd=0.35;
  }
  end(){ if (this.phase==="over") return; this.phase="over"; this.events.push({ type:"over" }); }
  step(dt){
    if (this.phase!=="play") return;
    this.time+=dt;
    // let marbles in, a few at a time
    this.releaseIn-=dt;
    if (this.releaseIn<=0 && this.released<this.total && this.marbles.length<this.inBowlCap()){ this.release(); this.releaseIn=this.releaseGap(); }
    // roll: pull to the middle (stronger near the rim), keep each marble's swing (energy) steady, bounce off the rim
    const R=T.R-T.mr;
    for (const m of this.marbles){
      const r2=m.x*m.x+m.y*m.y, f=T.k*(1+T.bend*r2/(T.R*T.R));
      m.vx-=m.x*f*dt; m.vy-=m.y*f*dt;
      const E=0.5*(m.vx*m.vx+m.vy*m.vy)+0.5*T.k*r2, g=1+0.6*dt*(m.E-E)/m.E;
      m.vx*=g; m.vy*=g;
      // keep the ellipse long and thin (sideways spin ≤ T.thin of a full swing) so every marble keeps reaching the rim
      const rr=Math.sqrt(r2);
      if (rr>0.5){ const A=Math.sqrt(2*m.E/T.k), Lmax=(this.players.length<=4?0.75:T.thin)*Math.sqrt(T.k)*A*A, L=m.x*m.vy-m.y*m.vx;
        // ...but never a straight line through the middle: a little spin makes every ellipse slowly turn (the bowl's pull is stronger near the rim), so it sweeps past every hippo instead of missing the same ones forever
        const Lmin=T.spin*Math.sqrt(T.k)*A*A, aL=Math.abs(L), want=aL>Lmax?Lmax:aL<Lmin?Lmin:aL;
        if (want!==aL){ const tx=-m.y/rr, ty=m.x/rr, sg=L<0?-1:1, dv=(sg*want-L)/rr*Math.min(1,3*dt); m.vx+=tx*dv; m.vy+=ty*dv; } }
      m.x+=m.vx*dt; m.y+=m.vy*dt;
      const r=Math.hypot(m.x,m.y);
      if (r>R){ const nx=m.x/r, ny=m.y/r, vn=m.vx*nx+m.vy*ny; if (vn>0){ m.vx-=2*vn*nx; m.vy-=2*vn*ny; } m.x=nx*R; m.y=ny*R; }
      if (m.immT>0){ m.immT-=dt; if (m.immT<=0) m.imm=0; }
    }
    // marbles nudge each other apart (soft, so the ellipses stay readable)
    const M=this.marbles, D=T.mr*2;
    for (let i=0;i<M.length;i++) for (let j=i+1;j<M.length;j++){ const a=M[i], b=M[j], dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy);
      if (d>0 && d<D){ const nx=dx/d, ny=dy/d, push=(D-d)/2; a.x-=nx*push; a.y-=ny*push; b.x+=nx*push; b.y+=ny*push;
        const rv=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny; if (rv<0){ a.vx+=rv*nx; a.vy+=rv*ny; b.vx-=rv*nx; b.vy-=rv*ny; } } }
    // hippos
    this.players.forEach((p,i)=>{
      if (p.cd>0) p.cd-=dt;
      if (p.q){ p.qLeft-=dt; if (p.qLeft<=0){ p.slow++; this.spit(p,"time"); } return; }
      if (p.chomp<=0) return;
      p.chomp-=dt;
      const a=this.angleOf(i);
      // jaws sweep in and back out: the mouth is deepest in the middle of the chomp
      // only a marble INSIDE the open mouth counts (jaws must be at least a third open)
      const ch=Math.max(0,p.chomp)/T.chompT, M=mouthAt(this.players.length,i,ch);
      const hit=lungeOf(ch)<0.3?null:this.marbles.find(m=>m.imm!==p.id && Math.hypot(m.x-M.x,m.y-M.y)<=M.r+T.mr);
      if (hit){
        this.marbles=this.marbles.filter(m=>m!==hit);
        p.q=p.stream(); p.qLeft=this.qTime; p.held=hit.hue||1; p.chomp=0;
        this.events.push({ type:"catch", id:p.id, q:{ top:p.q.top, bottom:p.q.bottom, op:p.q.op, len:p.q.len, money:!!p.q.money }, t:this.qTime });
      }
      if (p.chomp<=0 && !p.q){ p.chomp=0; p.cd=T.chompCd; }
    });
    if (this.time>=T.maxT) this.end();
  }
  drainEvents(){ const e=this.events; this.events=[]; return e; }
  // small, flat snapshot: m=[id,x,y,hue] · p=[id,score,chomp 0–1,quiz?1:0,held hue]
  snapshot(){
    return { t:Math.round(this.time*100)/100, left:this.total-this.eaten, total:this.total, ph:this.phase,
      m:this.marbles.map(m=>[m.id,Math.round(m.x*100)/100,Math.round(m.y*100)/100,m.hue]),
      p:this.players.map(p=>[p.id,p.score,p.chomp>0?Math.round(p.chomp/T.chompT*100)/100:0,p.q?1:0,p.held||0]) };
  }
  ranking(){
    return this.players.slice().sort((a,b)=>b.score-a.score||(a.lastT||1e9)-(b.lastT||1e9))
      .map(p=>({ id:p.id, name:p.name, score:p.score, right:p.right, wrong:p.wrong, slow:p.slow, chomps:p.chomps }));
  }
}

// ---------- bots (solo + hub demo): chomp when a marble is coming, answer after a think, sometimes wrong
function makeBot(seed, skill){ const r=rng(seed); return { r, skill, think:0, acc:0.7+0.25*skill, react:0.35+0.5*skill }; }
function botThink(g, p, bot, dt){
  if (g.phase!=="play") return;
  if (p.q){
    if (bot.think<=0) bot.think=(2.6-1.7*bot.skill)*(0.7+bot.r()*0.6);
    bot.think-=dt;
    if (bot.think<=0){ g.answer(p.id, bot.r()<bot.acc?p.q.s:p.q.s+1); bot.think=0; }
    return;
  }
  // a marble close to where the mouth will be mid-chomp
  const i=g.players.indexOf(p), M=mouthAt(g.players.length,i,0.5);
  const near=g.marbles.some(m=>Math.hypot(m.x-M.x,m.y-M.y)<M.r+T.mr+3.2);
  if ((near && bot.r()<bot.react*dt*20) || bot.r()<0.02*dt*20) g.chomp(p.id);
}

return { T, MODES, rng, cash, questionStream, angDiff, hippoScale, lungeOf, mouthAt, Game, makeBot, botThink };
});
