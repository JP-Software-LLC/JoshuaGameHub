// Dart Party — shared simulation (browser: window.DARTS, Node: require). Server-authoritative online;
// the browser runs the same code for solo play.
// Top-down field. WASD / arrows move you AND turn you to face where you move (8 directions). Enter throws a dart
// straight ahead (2 s cooldown). Darts only fly T.range (~18 units), so you have to get close. Balloons drift across the field; pop them for points. Trees stop darts.
// Darts never hit players. First to T.target points ends the game.
// Units: field is W × H, y points DOWN (screen space).
(function(root,factory){
  if (typeof module==="object" && module.exports) module.exports=factory();
  else root.DARTS=factory();
})(typeof self!=="undefined"?self:this,function(){
  "use strict";
  const T={ W:100, H:62, speed:15, r:1.3, cool:2, dartV:40, dartLife:0.45, range:18, target:20,
    // balloon kinds: radius, speed, points, spawn weight
    kinds:{ red:{ r:1.9, v:6, pts:1, w:50 }, blue:{ r:1.5, v:9, pts:2, w:28 }, big:{ r:2.8, v:4, pts:1, w:12 }, gold:{ r:1.3, v:14, pts:5, w:5 } } };
  const DIRS=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]].map(([x,y])=>{ const l=Math.hypot(x,y); return [x/l,y/l]; });
  const dirOf=(x,y)=>{ if (!x&&!y) return -1; const a=Math.atan2(y,x); return ((Math.round(a/(Math.PI/4))%8)+8)%8; };
  const rngOf=seed=>{ let s=(seed>>>0)||7; return ()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }; };

  class Game {
    constructor(players,seed){
      this.r=rngOf(seed||((Math.random()*2**31)|0));
      const n=players.length;
      // the whole party starts in one big cluster in the middle
      this.players=players.map((p,i)=>{ const a=i*2.4, d=1.6*Math.sqrt(i);
        return { id:p.id, name:p.name, bot:!!p.bot, x:T.W/2+Math.cos(a)*d, y:T.H/2+Math.sin(a)*d, ix:0, iy:0, face:i%8, cool:0.5, fire:false, score:0, pops:0, thrown:0 }; });
      this.trees=[]; for (let i=0;i<7;i++){ let x,y,ok=false; for (let k=0;k<30&&!ok;k++){ x=8+this.r()*(T.W-16); y=6+this.r()*(T.H-12); ok=Math.hypot(x-T.W/2,y-T.H/2)>16&&this.trees.every(t=>Math.hypot(t.x-x,t.y-y)>14); } if (ok) this.trees.push({ x, y, r:2.4+this.r()*1.4 }); }
      this.balloons=[]; this.darts=[]; this.nextId=1; this.time=0; this.spawnT=0.5; this.events=[]; this.phase="playing"; this.winner=0;
      this.target=T.target;
    }
    addPlayer(p){ if (!this.players.some(q=>q.id===p.id)) this.players.push({ id:p.id, name:p.name, bot:false, x:T.W/2, y:T.H/2, ix:0, iy:0, face:this.players.length%8, cool:0.5, fire:false, score:0, pops:0, thrown:0 }); }
    setInput(id,x,y){ const p=this.players.find(q=>q.id===id); if (!p) return; const l=Math.hypot(x,y); p.ix=l>1?x/l:x; p.iy=l>1?y/l:y; }
    fire(id){ const p=this.players.find(q=>q.id===id); if (p) p.fire=true; }
    spawnBalloon(){
      const names=Object.keys(T.kinds), tot=names.reduce((s,k)=>s+T.kinds[k].w,0); let pick=this.r()*tot, kind=names[0];
      for (const k of names){ pick-=T.kinds[k].w; if (pick<=0){ kind=k; break; } }
      const K=T.kinds[kind], side=this.r()*4|0;
      let x,y; if (side===0){ x=-2; y=4+this.r()*(T.H-8); } else if (side===1){ x=T.W+2; y=4+this.r()*(T.H-8); } else if (side===2){ x=4+this.r()*(T.W-8); y=-2; } else { x=4+this.r()*(T.W-8); y=T.H+2; }
      const tx=T.W*(0.25+this.r()*0.5), ty=T.H*(0.25+this.r()*0.5), l=Math.hypot(tx-x,ty-y);
      this.balloons.push({ id:this.nextId++, kind, x, y, vx:(tx-x)/l*K.v, vy:(ty-y)/l*K.v, r:K.r, ph:this.r()*6, c:this.r()*6|0, age:0 });
    }
    step(dt){
      if (this.phase!=="playing") return;
      this.time+=dt;
      const n=this.players.length;
      this.spawnT-=dt;
      if (this.spawnT<=0){ if (this.balloons.length<6+n*0.7) this.spawnBalloon(); this.spawnT=1/(0.7+n*0.09); }
      for (const p of this.players){
        if (p.bot) botThink(this,p,dt);
        if (p.ix||p.iy){ p.x+=p.ix*T.speed*dt; p.y+=p.iy*T.speed*dt; p.face=dirOf(p.ix,p.iy); }
        p.x=Math.max(T.r,Math.min(T.W-T.r,p.x)); p.y=Math.max(T.r,Math.min(T.H-T.r,p.y));
        for (const t of this.trees){ const dx=p.x-t.x, dy=p.y-t.y, d=Math.hypot(dx,dy), m=t.r+T.r*0.8; if (d<m&&d>0){ p.x=t.x+dx/d*m; p.y=t.y+dy/d*m; } }
        p.cool=Math.max(0,p.cool-dt);
        if (p.fire && p.cool<=0){ const [dx,dy]=DIRS[p.face]; this.darts.push({ id:this.nextId++, pid:p.id, x:p.x+dx*1.6, y:p.y+dy*1.6, vx:dx*T.dartV, vy:dy*T.dartV, life:T.dartLife, face:p.face }); p.cool=T.cool; p.thrown++; this.events.push(["throw",p.id]); }
        p.fire=false;
      }
      for (const b of this.balloons){ b.age+=dt; b.ph+=dt*2; b.x+=b.vx*dt+Math.sin(b.ph)*0.6*dt; b.y+=b.vy*dt+Math.cos(b.ph*0.7)*0.5*dt; }
      this.balloons=this.balloons.filter(b=>b.age<4||(b.x>-4&&b.x<T.W+4&&b.y>-4&&b.y<T.H+4));
      // darts fly in small steps so fast darts can't skip a balloon
      for (const d of this.darts){
        const steps=3; for (let s=0;s<steps&&d.life>0;s++){
          d.x+=d.vx*dt/steps; d.y+=d.vy*dt/steps;
          if (this.trees.some(t=>Math.hypot(d.x-t.x,d.y-t.y)<t.r)){ d.life=0; this.events.push(["thunk",Math.round(d.x*10)/10,Math.round(d.y*10)/10]); break; }
          const hit=this.balloons.find(b=>Math.hypot(d.x-b.x,d.y-b.y)<b.r+0.4);
          if (hit){ d.life=0; this.popBalloon(hit,d.pid); break; }
        }
        d.life-=dt; if (d.x<-3||d.x>T.W+3||d.y<-3||d.y>T.H+3) d.life=0;
      }
      this.darts=this.darts.filter(d=>d.life>0);
    }
    popBalloon(b,pid){
      this.balloons=this.balloons.filter(q=>q!==b);
      const p=this.players.find(q=>q.id===pid), pts=T.kinds[b.kind].pts;
      if (p){ p.score+=pts; p.pops++; }
      this.events.push(["pop",pid,Math.round(b.x*10)/10,Math.round(b.y*10)/10,b.kind,pts,b.c]);
      if (p && p.score>=this.target && this.phase==="playing"){ this.phase="over"; this.winner=p.id; this.events.push(["over",p.id]); }
    }
    drainEvents(){ const e=this.events; this.events=[]; return e; }
    snapshot(){
      const r1=v=>Math.round(v*10)/10;
      return { t:r1(this.time), goal:this.target, tr:this.trees.map(t=>({ x:r1(t.x), y:r1(t.y), r:r1(t.r) })),
        p:this.players.map(p=>[p.id,r1(p.x),r1(p.y),p.face,p.score,p.cool>0?1:0]),
        b:this.balloons.map(b=>[b.id,r1(b.x),r1(b.y),b.kind,b.c]),
        d:this.darts.map(d=>[d.id,r1(d.x),r1(d.y),d.face]) };
    }
    ranking(){
      return this.players.map(p=>({ id:p.id, name:p.name, score:p.score, pops:p.pops, thrown:p.thrown, won:p.id===this.winner }))
        .sort((a,b)=>b.score-a.score||(b.won-a.won)||b.pops-a.pops);
    }
  }
  // solo bots: walk until a balloon lines up with one of the 8 directions, turn to it, throw
  function botThink(g,p,dt){
    p.think=(p.think||0)-dt; if (p.think>0) return; p.think=0.15+((p.id*13)%5)*0.03+(p.lazy||0);
    let best=null, bd=1e9;
    for (const b of g.balloons){ const d=Math.hypot(b.x-p.x,b.y-p.y); if (d<bd&&b.x>0&&b.x<T.W&&b.y>0&&b.y<T.H){ bd=d; best=b; } }
    if (!best){ p.ix=0; p.iy=0; return; }
    const dx=best.x-p.x, dy=best.y-p.y, f=dirOf(dx,dy), [ux,uy]=DIRS[f], off=Math.abs(dx*uy-dy*ux);
    if (bd<T.range-1 && off<best.r*0.9 && p.cool<=0){ p.ix=ux*0.05; p.iy=uy*0.05; p.fire=true; p.think+=(p.lazy||0)*2.5; return; }   // tiny step to face it, then throw
    if (bd<5){ p.ix=-ux*0.6; p.iy=-uy*0.6; return; }                                                  // too close: back off
    p.ix=ux*0.8+((p.id%3)-1)*0.2; p.iy=uy*0.8;
  }
  return { T, DIRS, Game };
});
