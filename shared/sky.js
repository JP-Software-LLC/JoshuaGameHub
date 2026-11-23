// Sky Climb — shared simulation (browser: window.SKY, Node: require). Server-authoritative online;
// the browser runs the same code for solo play and to predict your own flyer.
// Flap (Space) to rise, ← → to steer. The level wraps left↔right. Climb past ledges (one-way: you fly up
// through them and land on top), stone blocks (solid), and flying critters (a bump stuns you and knocks you down).
// Players bump into each other: hit someone from below and they're pushed UP; land on someone from above and
// they're pushed DOWN. Nobody is ever "out". Reach the finish line at the top; the game ends when everyone is up
// (or at T.maxT). Units: y up, world W wide, finish at T.goal.
// The level (ledges, blocks, critters) is a pure function of (seed, time) so every browser can draw it locally.
(function(root,factory){
  if (typeof module==="object" && module.exports) module.exports=factory();
  else root.SKY=factory();
})(typeof self!=="undefined"?self:this,function(){
  "use strict";
  const T={ W:80, goal:480, rowGap:11, r:0.95, g:34, flapV:13, flapMax:15, ax:46, maxVx:13, drag:1.6, groundDrag:9,
    stunT:0.9, bumpUp:14, bumpDown:-13, critterR:1.3, maxT:7*60 };
  const rngOf=seed=>{ let s=(seed>>>0)||7; return ()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }; };
  const wrapX=x=>((x%T.W)+T.W)%T.W;
  const dxw=(a,b)=>{ let d=(a-b)%T.W; if (d>T.W/2) d-=T.W; if (d<-T.W/2) d+=T.W; return d; };

  // ---------- level ----------
  function makeLevel(seed){
    const r=rngOf(seed*13+5), ledges=[], blocks=[], critters=[], gaps=[];
    const rows=Math.floor(T.goal/T.rowGap), rowGaps=[[]];
    // pass 1: each row is a solid stone floor with 2–3 wide gaps to fly up through (the bottom-row difficulty all the way up)
    for (let i=1;i<rows;i++){
      const y=i*T.rowGap, hard=1/rows;   // same (bottom-row) difficulty all the way up
      const ng=r()<0.45-hard*0.3?3:2, gw=()=>Math.max(5.5,9.5-hard*3.5)*(0.85+r()*0.3), seg=T.W/ng, row=[];
      for (let k=0;k<ng;k++){ const w=gw(); row.push({ x:seg*k+1+r()*(seg-w-2), w }); }
      let cur=0;
      for (const g of row){ if (g.x-cur>0.5) blocks.push({ x:cur, y, w:g.x-cur, h:1.6 }); cur=g.x+g.w; gaps.push({ x:g.x, y, w:g.w }); }
      if (T.W-cur>0.5) blocks.push({ x:cur, y, w:T.W-cur, h:1.6 });
      rowGaps.push(row);
    }
    // pass 2: obstacles between rows
    for (let i=1;i<rows;i++){
      const y=i*T.rowGap, hard=1/rows, clear=[...rowGaps[i],...(rowGaps[i+1]||[])];
      // extra stone chunks floating between rows, never under or over a gap, so every gap stays flyable
      const extra=(r()<0.4+hard*0.5?1:0)+(r()<hard*0.6?1:0);
      for (let k=0;k<extra;k++){ const w=5+r()*8; for (let tries=0;tries<12;tries++){ const x=r()*(T.W-w);
        if (clear.every(g=>x+w<g.x-2.5||x>g.x+g.w+2.5)){ blocks.push({ x, y:y+3.5+r()*4, w, h:1.6 }); break; } } }
      // the odd one-way ledge (only ~1 in 10 rows) as a resting spot
      if (r()<0.1){ const w=7+r()*5; ledges.push({ x:r()*(T.W-w), y:y+T.rowGap*0.5, w, amp:r()<0.5?5:0, per:5, ph:r()*6.28 }); }
      // buzzers: one most rows, often two, three near the top
      const nb=(r()<0.75+hard*0.25?1:0)+(r()<0.35+hard*0.5?1:0)+(hard>0.6&&r()<hard*0.6?1:0);
      for (let k=0;k<nb;k++){ const dir=r()<0.5?-1:1; critters.push({ x0:r()*T.W, y:y+T.rowGap*(0.25+r()*0.55), v:dir*(5+r()*5+hard*7), bob:r()*6.28 }); }
    }
    return { seed, ledges, blocks, critters, gaps };
  }
  const ledgeX=(l,t)=>l.x+(l.amp?Math.sin(t*6.283/l.per+l.ph)*l.amp:0);
  const critterAt=(c,t)=>({ x:wrapX(c.x0+c.v*t), y:c.y+Math.sin(t*2+c.bob)*0.8 });

  // ---------- one flyer ----------
  function newFlyer(id,name,x){ return { id, name, x, y:T.r, vx:0, vy:0, ground:true, stun:0, flap:false, ix:0, fin:null, best:0, bumps:0 }; }
  function stepFlyer(L,p,t,dt){
    if (p.fin!=null) return;
    p.stun=Math.max(0,p.stun-dt);
    const ctl=p.stun>0?0:p.ix;
    if (p.flap && p.stun<=0){ p.vy=Math.min(T.flapMax,Math.max(p.vy,0)+T.flapV); p.ground=false; }
    p.flap=false;
    p.vx+=ctl*T.ax*dt; p.vx-=p.vx*(p.ground?T.groundDrag:T.drag)*dt; p.vx=Math.max(-T.maxVx,Math.min(T.maxVx,p.vx));
    p.vy-=T.g*dt; if (p.vy<-30) p.vy=-30;
    const py=p.y;
    p.x=wrapX(p.x+p.vx*dt); p.y+=p.vy*dt;
    p.ground=false;
    if (p.y<=T.r){ p.y=T.r; p.vy=0; p.ground=true; }                                  // the starting floor
    // one-way ledges: land on top when falling
    if (p.vy<=0) for (const l of L.ledges){ if (py-T.r>=l.y-0.05 && p.y-T.r<l.y){ const lx=ledgeX(l,t);
      if (p.x>lx-0.4 && p.x<lx+l.w+0.4){ p.y=l.y+T.r; p.vy=0; p.ground=true;
        if (l.amp){ const lx2=ledgeX(l,t+dt); p.x=wrapX(p.x+(lx2-lx)); } break; } } }
    // solid stone blocks
    for (const b of L.blocks){ if (p.y<b.y-2||p.y>b.y+b.h+2) continue; const nx=Math.max(b.x,Math.min(b.x+b.w,p.x)), ny=Math.max(b.y,Math.min(b.y+b.h,p.y)), dx=p.x-nx, dy=p.y-ny, d=Math.hypot(dx,dy);
      if (d<T.r){ if (Math.abs(dy)>=Math.abs(dx)){ if (dy>0){ p.y=b.y+b.h+T.r; if (p.vy<0){ p.vy=0; p.ground=true; } } else { p.y=b.y-T.r; if (p.vy>0) p.vy=-1; } }
        else { p.x=wrapX(nx+Math.sign(dx||1)*T.r); p.vx=-p.vx*0.4; } } }
    // critters: bump = stunned and knocked down
    if (p.stun<=0) for (const c of L.critters){ const q=critterAt(c,t); if (Math.abs(q.y-p.y)<T.critterR+T.r && Math.abs(dxw(p.x,q.x))<T.critterR+T.r && Math.hypot(dxw(p.x,q.x),q.y-p.y)<T.critterR+T.r){
      p.stun=T.stunT; p.vy=-10; p.vx=Math.sign(dxw(p.x,q.x)||1)*9; p.bumps++; p.hitC=true; break; } }
    p.best=Math.max(p.best,p.y);
    if (p.y>=T.goal) p.fin=t;
  }

  // ---------- the game ----------
  class Game {
    constructor(players,seed){
      this.seed=seed||((Math.random()*2**31)|0); this.L=makeLevel(this.seed);
      const n=players.length;
      this.players=players.map((p,i)=>Object.assign(newFlyer(p.id,p.name,(i+0.5)*T.W/n),{ bot:!!p.bot, lazy:p.lazy||0 }));   // one floor, spread out, no overlaps
      this.time=0; this.events=[]; this.phase="playing";
    }
    addPlayer(p){ if (!this.players.some(q=>q.id===p.id)) this.players.push(Object.assign(newFlyer(p.id,p.name,T.W*(0.2+Math.random()*0.6)),{ bot:false, lazy:0 })); }   // late joiner: from the ground
    setInput(id,x){ const p=this.players.find(q=>q.id===id); if (p) p.ix=Math.max(-1,Math.min(1,+x||0)); }
    flap(id){ const p=this.players.find(q=>q.id===id); if (p) p.flap=true; }
    step(dt){
      if (this.phase!=="playing") return;
      this.time+=dt; const t=this.time;
      for (const p of this.players){ if (p.bot) botThink(this,p,dt); const was=p.fin; p.hitC=false; stepFlyer(this.L,p,t,dt);
        if (p.hitC) this.events.push(["bonk",p.id]); if (was==null && p.fin!=null) this.events.push(["fin",p.id,Math.round(p.fin*10)/10]); }
      this.collide();
      const left=this.players.filter(p=>p.fin==null&&!p.gone);              // disconnected players don't hold the game up
      if (!left.length || t>=T.maxT){ this.phase="over"; this.events.push(["over"]); }
    }
    // player ↔ player bumps
    collide(){
      const P=this.players.filter(p=>p.fin==null), D=T.r*2;
      for (let i=0;i<P.length;i++) for (let j=i+1;j<P.length;j++){
        const a=P[i], b=P[j], dx=dxw(b.x,a.x), dy=b.y-a.y; if (Math.abs(dx)>=D||Math.abs(dy)>=D) continue;
        const d=Math.hypot(dx,dy); if (d>=D||d===0) continue;
        const nx=dx/d, ny=dy/d, push=(D-d)/2;
        a.x=wrapX(a.x-nx*push); a.y-=ny*push; b.x=wrapX(b.x+nx*push); b.y+=ny*push;
        if (Math.abs(ny)>0.55){                                           // one is on top of the other
          const up=ny>0?b:a, lo=ny>0?a:b;
          if (lo.vy>up.vy && lo.vy>0){ up.vy=T.bumpUp; lo.vy=Math.min(lo.vy,-2); this.events.push(["boost",up.id,lo.id]); }   // hit from below → pushed up
          else { lo.vy=T.bumpDown; up.vy=Math.max(up.vy,8); lo.ground=false; this.events.push(["squash",lo.id,up.id]); }           // landed on from above → pushed down
        } else { const t=a.vx; a.vx=b.vx*0.8-nx*4; b.vx=t*0.8+nx*4; this.events.push(["boing",a.id,b.id]); }
        if (a.y<T.r) a.y=T.r; if (b.y<T.r) b.y=T.r;
      }
    }
    drainEvents(){ const e=this.events; this.events=[]; return e; }
    snapshot(){
      const r1=v=>Math.round(v*100)/100;
      return { t:Math.round(this.time*100)/100, p:this.players.map(p=>[p.id,r1(p.x),r1(p.y),r1(p.vx),r1(p.vy),p.stun>0?1:0,p.fin!=null?1:0,p.ground?1:0]) };
    }
    ranking(){
      return this.players.map(p=>({ id:p.id, name:p.name, time:p.fin, best:Math.round(p.best), percent:Math.min(100,Math.round(100*p.best/T.goal)), bumps:p.bumps }))
        .sort((a,b)=>(a.time==null)-(b.time==null)||(a.time!=null?a.time-b.time:b.best-a.best));
    }
  }
  // solo bots: aim for a ledge on the row above, flap in rhythm, hold back when a critter is close
  function botThink(g,p,dt){
    p.bt=(p.bt||0)-dt; if (p.bt>0) return; p.bt=0.12+p.lazy*0.2+Math.random()*0.08;
    const t=g.time, rowY=(Math.floor((p.y-T.r)/T.rowGap)+1)*T.rowGap;
    let tx=null, bd=1e9; for (const q of g.L.gaps){ if (Math.abs(q.y-rowY)>0.1) continue; const cx=q.x+q.w/2, d=Math.abs(dxw(cx,p.x)); if (d<bd){ bd=d; tx=cx; } }
    let danger=false; for (const c of g.L.critters){ const q=critterAt(c,t); const ahead=dxw(p.x,q.x)*Math.sign(c.v); if (q.y>p.y-1 && q.y<p.y+6 && ahead>-3 && ahead<10) danger=true; }
    const dx=tx==null?0:dxw(tx,p.x); p.ix=Math.abs(dx)<1.5?0:Math.sign(dx);
    if (danger && p.ground) return;
    if (Math.random()<p.lazy*0.35) return;
    if (p.vy<3 && (Math.abs(dx)<1.6 || p.y<rowY-4)) p.flap=true;                    // only push up through the gap when lined up under it
  }
  return { T, makeLevel, ledgeX, critterAt, wrapX, dxw, newFlyer, stepFlyer, Game };
});
