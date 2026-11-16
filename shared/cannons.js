// Star Cannons — shared simulation (browser: window.CANNONS, Node: require). Server-authoritative online;
// the browser runs the same code for solo play.
// Everyone's laser cannon slides along the same floor. Every cannon fires a constant laser straight up; the beam
// stops at the first thing above it (asteroid or power-up) and damages it. Asteroids bounce under gravity; when
// one runs out of HP it splits into two smaller ones. An asteroid touching your cannon knocks you out.
// Points = damage you deal (1 per HP) + a bonus for the final blow on each asteroid. "+1 laser" power-ups stack for good. No time limit: asteroids get bigger, tougher and more numerous until
// nobody is left (very hard after ~3 minutes).
// Units: world is W wide, H tall, y=0 is the floor, y points up.
(function(root,factory){
  if (typeof module==="object" && module.exports) module.exports=factory();
  else root.CANNONS=factory();
})(typeof self!=="undefined"?self:this,function(){
  "use strict";
  const T={
    W:100, H:62, g:34,
    cannonW:2.6, cannonH:2.6, speed:34,
    dps:7, rapidMul:2.2, rapidT:8, shieldSafeT:1.5, freezeT:4,
    powerEvery:11, powerLife:11, powerBonus:25, lastHit:5, maxLasers:5,     // last-hit bonus = lastHit × size; +1 laser power-up stacks to maxLasers
    sizes:[0,2.2,3.4,4.7,6.1,7.6],                 // radius by size 1–5
    bounceH:[0,20,27,33,38,42],                    // every asteroid bounces back up to its own height
  };
  const rngOf=seed=>{ let s=(seed>>>0)||7; return ()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }; };

  class Game {
    constructor(players,seed){
      this.r=rngOf(seed||((Math.random()*2**31)|0));
      const n=players.length;
      this.players=players.map((p,i)=>({ id:p.id, name:p.name, bot:!!p.bot, x:T.W*(i+1)/(n+1), dir:0, alive:true, score:0, hits:0, outT:null,
        shield:0, safe:0, rapid:0, lasers:1, lastHits:0 }));
      this.rocks=[]; this.powers=[]; this.nextId=1; this.time=0; this.spawnT=1.5; this.powerT=T.powerEvery*0.7; this.freeze=0;
      this.events=[]; this.phase="playing";
    }
    setInput(id,dir){ const p=this.players.find(q=>q.id===id); if (p) p.dir=Math.max(-1,Math.min(1,dir||0)); }
    alive(){ return this.players.filter(p=>p.alive); }
    // difficulty rises steadily; by ~180 s rocks are big, tough and frequent
    level(){ return this.time/60; }
    hpFor(size){ const n=Math.max(1,this.alive().length); return Math.round(size*size*3.2*(1+this.level()*0.9)*Math.sqrt(n)); }
    spawnRock(){
      const L=this.level(), maxSize=Math.min(5,2+Math.floor(this.time/35)), minSize=Math.min(maxSize,1+Math.floor(this.time/70));
      const size=minSize+Math.floor(this.r()*(maxSize-minSize+1)), rad=T.sizes[size];
      const left=this.r()<0.5, hp=this.hpFor(size);
      this.rocks.push({ id:this.nextId++, x:left?-rad:T.W+rad, y:T.H*0.62+this.r()*T.H*0.25, vx:(left?1:-1)*(7+this.r()*5+L*1.5), vy:0, r:rad, size, hp, max:hp, enter:true });
    }
    spawnPower(){
      const types=["rapid","shield","freeze","bomb","laser","laser"], type=types[this.r()*types.length|0], left=this.r()<0.5;
      this.powers.push({ id:this.nextId++, type, x:left?2:T.W-2, y:T.H*(0.42+this.r()*0.3), vx:(left?1:-1)*(5+this.r()*3), life:T.powerLife });
    }
    // what each cannon's beam hits: the lowest asteroid or power-up straight above it
    beamTarget(p){
      let best=null, by=Infinity;
      for (const a of this.rocks){ if (Math.abs(a.x-p.x)<a.r*0.92 && a.y>T.cannonH*0.5){ const y=a.y-Math.sqrt(Math.max(0,a.r*a.r-(a.x-p.x)**2)); if (y<by){ by=y; best=a; } } }
      for (const u of this.powers){ if (Math.abs(u.x-p.x)<1.6 && u.y<by){ by=u.y; best=u; } }
      return best;
    }
    step(dt){
      if (this.phase!=="playing") return;
      this.time+=dt;
      const L=this.level();
      // spawning
      this.spawnT-=dt;
      const maxRocks=2+Math.floor(this.time/25);
      if (this.spawnT<=0){ if (this.rocks.filter(a=>a.enter||a.size>=2).length<maxRocks) this.spawnRock(); this.spawnT=Math.max(1.4,6.5-this.time/32); }
      this.powerT-=dt; if (this.powerT<=0){ this.spawnPower(); this.powerT=T.powerEvery; }
      // cannons
      for (const p of this.players){ if (!p.alive) continue;
        if (p.bot) p.dir=botDir(this,p);
        p.x=Math.max(T.cannonW/2,Math.min(T.W-T.cannonW/2,p.x+p.dir*T.speed*dt));
        p.safe=Math.max(0,p.safe-dt); p.rapid=Math.max(0,p.rapid-dt); }
      // rocks move (frozen rocks hang in the air)
      this.freeze=Math.max(0,this.freeze-dt);
      if (!this.freeze) for (const a of this.rocks){
        a.vy-=T.g*dt; a.x+=a.vx*dt; a.y+=a.vy*dt;
        if (a.enter){ if (a.x>a.r && a.x<T.W-a.r) a.enter=false; }
        else { if (a.x<a.r){ a.x=a.r; a.vx=Math.abs(a.vx); } if (a.x>T.W-a.r){ a.x=T.W-a.r; a.vx=-Math.abs(a.vx); } }
        if (a.y<a.r){ a.y=a.r; a.vy=Math.sqrt(2*T.g*T.bounceH[a.size]); this.events.push(["bounce",a.id]); }
        if (a.y>T.H-a.r && a.vy>0) a.vy=-a.vy*0.5;
      }
      for (const u of this.powers){ u.x+=u.vx*dt; u.life-=dt; if (u.x<1||u.x>T.W-1) u.vx=-u.vx; }
      this.powers=this.powers.filter(u=>u.life>0);
      // beams
      const popped=[];
      for (const p of this.players){ if (!p.alive) continue;
        const t=this.beamTarget(p); if (!t) continue;
        if (t.type){ this.powerUp(p,t); continue; }
        const dmg=T.dps*p.lasers*(p.rapid>0?T.rapidMul:1)*dt;      // each extra laser adds a full beam of damage
        const done=Math.min(t.hp,dmg); t.hp-=dmg; p.score+=done; p.hits+=done; if (done>0) t.last=p.id;
        if (t.hp<=0 && !popped.includes(t)) popped.push(t);
      }
      for (const a of popped) this.pop(a);
      // crushes
      for (const a of this.rocks) for (const p of this.players){ if (!p.alive || p.safe>0) continue;
        const nx=Math.max(p.x-T.cannonW/2,Math.min(p.x+T.cannonW/2,a.x)), ny=Math.max(0,Math.min(T.cannonH,a.y));
        if ((a.x-nx)**2+(a.y-ny)**2<(a.r*0.9)**2){
          if (p.shield){ p.shield=0; p.safe=T.shieldSafeT; this.events.push(["shield",p.id]); }
          else { p.alive=false; p.outT=this.time; this.events.push(["out",p.id]); }
        } }
      if (!this.alive().length){ this.phase="over"; this.events.push(["over"]); }
    }
    pop(a){
      this.rocks=this.rocks.filter(q=>q!==a);
      const k=this.players.find(q=>q.id===a.last), bonus=k?T.lastHit*a.size:0;          // the final blow earns a bonus
      if (k){ k.score+=bonus; k.lastHits++; }
      this.events.push(["pop",a.id,Math.round(a.x*10)/10,Math.round(a.y*10)/10,a.size,k?k.id:0,bonus]);
      if (a.size>1){ const s=a.size-1, hp=Math.max(2,Math.round(this.hpFor(s)*0.8));
        for (const d of [-1,1]) this.rocks.push({ id:this.nextId++, x:Math.max(T.sizes[s],Math.min(T.W-T.sizes[s],a.x+d*a.r*0.4)), y:Math.max(T.sizes[s],a.y), vx:d*(8+this.r()*4), vy:16, r:T.sizes[s], size:s, hp, max:hp, enter:false }); }
    }
    powerUp(p,u){
      this.powers=this.powers.filter(q=>q!==u); p.score+=T.powerBonus;
      if (u.type==="rapid") p.rapid=T.rapidT;
      if (u.type==="shield") p.shield=1;
      if (u.type==="freeze") this.freeze=T.freezeT;
      if (u.type==="laser") p.lasers=Math.min(T.maxLasers,p.lasers+1);
      if (u.type==="bomb"){ const pop=[]; for (const a of this.rocks){ const d=Math.min(a.hp,Math.ceil(a.max*0.35)); a.hp-=d; p.score+=d; p.hits+=d; if (d>0) a.last=p.id; if (a.hp<=0) pop.push(a); } pop.forEach(a=>this.pop(a)); }
      this.events.push(["power",p.id,u.type,Math.round(u.x*10)/10,Math.round(u.y*10)/10]);
    }
    drainEvents(){ const e=this.events; this.events=[]; return e; }
    snapshot(){
      const r1=v=>Math.round(v*10)/10;
      return { t:r1(this.time), fz:this.freeze>0?1:0,
        p:this.players.map(p=>[p.id,r1(p.x),p.alive?1:0,p.shield||p.safe>0?1:0,p.rapid>0?1:0,Math.round(p.score),p.lasers]),
        a:this.rocks.map(a=>[a.id,r1(a.x),r1(a.y),a.size,Math.max(0,Math.ceil(a.hp))]),
        u:this.powers.map(u=>[u.id,r1(u.x),r1(u.y),u.type]) };
    }
    // most points first; survival time breaks ties
    ranking(){
      return this.players.map(p=>({ id:p.id, name:p.name, score:Math.round(p.score), time:p.outT??this.time, alive:p.alive, lastHits:p.lastHits, lasers:p.lasers }))
        .sort((a,b)=>b.score-a.score||b.time-a.time);
    }
  }
  // solo bots: stay under something to shoot, step away from rocks about to land on them
  function botDir(g,p){
    let danger=0;
    for (const a of g.rocks){ const dx=a.x-p.x; if (Math.abs(dx)<a.r+4 && a.y<a.r+14 && a.vy<4) danger+=dx>0?-1:1; }
    if (danger) return Math.sign(danger);
    let tgt=null, best=Infinity; for (const a of g.rocks){ if (a.enter) continue; const d=Math.abs(a.x-p.x)+a.y*0.3; if (d<best){ best=d; tgt=a; } }
    if (!tgt) return 0; const dx=tgt.x+(((p.id*37)%7)-3)*0.6-p.x; return Math.abs(dx)<0.8?0:Math.sign(dx);
  }
  return { T, Game };
});
