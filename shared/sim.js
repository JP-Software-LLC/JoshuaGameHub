// Clean Getaway — shared game simulation.
// Runs unchanged in the browser (Quick Play, window.CG) and on the Node game server (require).
// No DOM, no rendering, no text: the sim emits events and the client turns them into UI.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CG = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

// ============================================================
//  TUNING
// ============================================================
const TUNE = {
  guardSpeed: 3.1,      // tiles/sec
  thiefSpeed: 3.45,     // slightly faster than guards
  slowMult: 0.6,        // guards during EMP
  powerTime: 4.5,       // EMP seconds
  respawnDelay: 3.0,
  stageEscalation: 0.04,
  catchRadius: 0.7,
  countdown: 3,
  lives: 3,
  rotations: 1,
  pause: 1.6,
};
const SCORE = { perSecond:10, perCash:10, perFloor:500, perTackle:200, perCapture:300 };
const DIRS = { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} };
const DLIST = [DIRS.up, DIRS.left, DIRS.down, DIRS.right];
const DNAMES = ["up","left","down","right"];
const BOT_NAMES = ["Vinnie","Lou","Marge","Sal","Dot","Frankie","Rita","Moe"];

// Theme data lives here so the server only has to send an index.
const THEMES = [
  { name:"Lobby & Teller Floor", f1:"#cfc6b4", f2:"#c3b9a5", line:"#b3a890", wall:"#6b4a2e", top:"#8f6540", hi:"#a87a4f" },
  { name:"Executive Offices",    f1:"#2e3b52", f2:"#2a364b", line:"#26314a", wall:"#3d2a1c", top:"#5e4330", hi:"#74553c" },
  { name:"Safe-Deposit Level",   f1:"#3a3f47", f2:"#363b42", line:"#2e3239", wall:"#4f5763", top:"#7a8492", hi:"#99a3b0" },
  { name:"Main Vault",           f1:"#2b2a24", f2:"#27261f", line:"#3a3624", wall:"#5c4a1c", top:"#8a6d22", hi:"#b38f2f" },
];

const CW=13, CH=11, W=CW*2+1, H=CH*2+1, CX=CW|0, CY=CH|0; // 27×23 tiles
const wrapX = x => (x+W)%W;
const opp = (a,b) => a&&b&&a.x===-b.x&&a.y===-b.y;

// ============================================================
//  MAP GENERATOR — braided maze shaped like a bank floor plan
//  # wall/counter · . cash · o EMP · _ floor · G guard-only gate
// ============================================================
function walkable(grid,x,y,isGuard){
  if (y<0||y>=H) return false;
  const c = grid[y][wrapX(x)];
  if (c==="#") return false;
  if (c==="G") return isGuard;
  return true;
}
function bfs(grid, sources, isGuard, blocked){
  const d = Array.from({length:H},()=>Array(W).fill(-1)); const q=[];
  for (const s of sources){ if (d[s.y][s.x]<0){ d[s.y][s.x]=0; q.push(s); } }
  for (let i=0;i<q.length;i++){ const p=q[i];
    for (const k of DLIST){ const nx=wrapX(p.x+k.x), ny=p.y+k.y;
      if (!walkable(grid,nx,ny,isGuard)||d[ny][nx]>=0||(blocked&&blocked(nx,ny))) continue;
      d[ny][nx]=d[p.y][p.x]+1; q.push({x:nx,y:ny}); } }
  return d;
}
function makeFloor(stage){
  const themeIdx = stage%THEMES.length;
  const g = Array.from({length:H},()=>Array(W).fill("#"));
  // 1. DFS maze over odd cells
  const seen = new Set(), stack=[[1+2*(Math.random()*CW|0), 1+2*(Math.random()*CH|0)]];
  g[stack[0][1]][stack[0][0]]="_"; seen.add(stack[0]+"");
  while (stack.length){
    const [x,y]=stack[stack.length-1];
    const n = DLIST.map(d=>[x+d.x*2,y+d.y*2,d]).filter(([a,b])=>a>0&&b>0&&a<W-1&&b<H-1&&!seen.has([a,b]+""));
    if (!n.length){ stack.pop(); continue; }
    const [a,b,d]=n[Math.random()*n.length|0];
    g[y+d.y][x+d.x]="_"; g[b][a]="_"; seen.add([a,b]+""); stack.push([a,b]);
  }
  // 2. knock out extra walls → loops, more escape routes
  for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++)
    if (g[y][x]==="#" && ((x%2===1&&y%2===0)||(x%2===0&&y%2===1)) && Math.random()<0.16) g[y][x]="_";
  // 3. guard office (pen) with ring corridor
  for (let y=CY-2;y<=CY+2;y++) for (let x=CX-4;x<=CX+4;x++) g[y][x]="_";
  for (let y=CY-1;y<=CY+1;y++) for (let x=CX-3;x<=CX+3;x++) g[y][x]="#";
  for (let x=CX-2;x<=CX+2;x++) g[CY][x]="_";
  g[CY-1][CX]="G";
  const inPen=(x,y)=>y>=CY-1&&y<=CY+1&&x>=CX-3&&x<=CX+3;
  // 4. braid: remove every dead end
  const open=(x,y)=>g[y]&&g[y][x]&&g[y][x]!=="#";
  for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++){
    if (!open(x,y)||inPen(x,y)) continue;
    const nOpen = DLIST.filter(d=>open(x+d.x,y+d.y)).length;
    if (nOpen>1) continue;
    const opts = DLIST.filter(d=>{ const wx=x+d.x, wy=y+d.y, bx=x+2*d.x, by=y+2*d.y;
      return g[wy][wx]==="#" && wx>0&&wy>0&&wx<W-1&&wy<H-1 && !inPen(wx,wy) && open(bx,by) && !inPen(bx,by); });
    if (opts.length){ const d=opts[Math.random()*opts.length|0]; g[y+d.y][x+d.x]="_"; }
  }
  // 5. side service tunnels
  for (const ty of [CY-4, CY+4]) if (ty%2===1){ g[ty][0]="_"; g[ty][W-1]="_"; g[ty][1]="_"; g[ty][W-2]="_"; }
  const spawns = { thief:{x:CX,y:H-2}, guards:[{x:CX-1,y:CY},{x:CX,y:CY},{x:CX+1,y:CY}] };
  g[spawns.thief.y][spawns.thief.x]="_";
  // 6. cash on every cell centre the thief can reach; EMPs near the corners
  const reach = bfs(g, [spawns.thief], false);
  for (let y=1;y<H-1;y+=2) for (let x=1;x<W-1;x+=2)
    if (g[y][x]==="_" && reach[y][x]>=0 && !inPen(x,y) && !(x===spawns.thief.x&&y===spawns.thief.y)) g[y][x]=".";
  for (const [x,y] of [[1,1],[W-2,1],[1,H-2],[W-2,H-2]]) if (reach[y][x]>=0) g[y][x]="o";
  let cash=0; for (const r of g) for (const c of r) if (c==="."||c==="o") cash++;
  return { grid:g, themeIdx, spawns, cash };
}

// ============================================================
//  MOVEMENT — lane-based, buffered turns, instant reversal
// ============================================================
function makeActor(slot, role, spawn){ return { slot, role, spawn, x:spawn.x, y:spawn.y, fx:spawn.x, fy:spawn.y, dir:null, want:null, tgt:null, out:0, face:1, moving:false }; }
function resetActor(a){ Object.assign(a,{x:a.spawn.x,y:a.spawn.y,fx:a.spawn.x,fy:a.spawn.y,dir:null,want:null,tgt:null,out:0}); }
function stepActor(g, a, speed, dt){
  let rem=speed*dt, guard=a.role==="guard", safety=8; a.moving=false;
  while (rem>1e-6 && safety--){
    if (a.tgt && a.want && opp(a.want,a.dir)){ const t=a.tgt; a.tgt={x:a.fx,y:a.fy}; a.fx=t.x; a.fy=t.y; a.dir=a.want; }
    if (!a.tgt){
      g.onTile(a);
      if (g.state!=="play") break;          // last cash / catch ends movement on this tile
      if (g.players[a.slot].bot) botThink(g, a);
      let d=null;
      if (a.want && walkable(g.grid,a.fx+a.want.x,a.fy+a.want.y,guard)) d=a.want;
      else if (a.dir && walkable(g.grid,a.fx+a.dir.x,a.fy+a.dir.y,guard)) d=a.dir;
      if (!d) break;
      a.dir=d; a.tgt={x:a.fx+d.x,y:a.fy+d.y};
    }
    if (a.dir.x) a.face=a.dir.x;
    a.moving=true;
    const dist=Math.abs(a.tgt.x-a.x)+Math.abs(a.tgt.y-a.y);
    if (rem>=dist){ rem-=dist; a.fx=wrapX(a.tgt.x); a.fy=a.tgt.y; a.x=a.fx; a.y=a.fy; a.tgt=null; }
    else { a.x+=a.dir.x*rem; a.y+=a.dir.y*rem; rem=0; }
  }
}

// ============================================================
//  BOTS
// ============================================================
function stepToward(g, a, field, flee){
  let best=null, bv=flee?-1:1e9;
  for (const k of DLIST){ const nx=wrapX(a.fx+k.x), ny=a.fy+k.y;
    if (!walkable(g.grid,nx,ny,a.role==="guard")) continue;
    let v=field[ny][nx]; if (v<0){ if(!flee) continue; v=99; }
    v += (opp(k,a.dir)? (flee?-0.5:0.5):0) + Math.random()*0.35*(flee?-1:1);
    if (flee? v>bv : v<bv){ bv=v; best=k; } }
  return best;
}
function tileOf(a){ return {x:wrapX(Math.round(a.x)), y:Math.round(a.y)}; }
function botThink(g, a){ (a.role==="guard"?guardThink:thiefThink)(g, a); }

// Guards coordinate: one chases, the others take the thief's escape routes.
function escapeExits(g, t){ // tiles ~4 steps out along each lane leaving the thief
  const out=[];
  for (const d of DLIST){
    let x=t.x,y=t.y,steps=0;
    while (steps<5){ const nx=wrapX(x+d.x),ny=y+d.y; if(!walkable(g.grid,nx,ny,false)) break; x=nx;y=ny;steps++;
      if (steps>=2 && DLIST.filter(k=>walkable(g.grid,x+k.x,y+k.y,false)).length>2) break; }
    if (steps) out.push({x,y,d});
  }
  return out;
}
function guardThink(g, a){
  const th=g.thief, t=tileOf(th);
  const fromThief=bfs(g.grid,[t],true);
  if (g.power>0){ a.want=stepToward(g,a,fromThief,true); return; } // run
  const live=g.guards.filter(x=>!x.out);
  const myD=fromThief[a.fy][a.fx];
  const chaser=live.reduce((b,x)=>{ const d=fromThief[tileOf(x).y][tileOf(x).x]; return d>=0&&d<b.d?{x,d}:b; },{x:null,d:1e9}).x;
  if (chaser===a || myD<=3){ a.want=stepToward(g,a,fromThief,false); return; }
  const exits=escapeExits(g,t);
  const others=live.filter(x=>x!==a&&x!==chaser);
  const fields=new Map();
  const fieldFor=e=>{ const k=e.x+","+e.y; if(!fields.has(k)) fields.set(k,bfs(g.grid,[e],true)); return fields.get(k); };
  let best=null,bv=1e9;
  for (const e of exits){
    const f=fieldFor(e), mine=f[a.fy][a.fx]; if (mine<0) continue;
    let v=mine - (th.dir&&e.d.x===th.dir.x&&e.d.y===th.dir.y?4:0);
    for (const o of others){ const ot=tileOf(o), od=f[ot.y][ot.x]; if (od>=0&&od<mine) v+=6; }
    if (chaser){ const ct=tileOf(chaser); if (f[ct.y][ct.x]>=0&&f[ct.y][ct.x]<4) v+=8; }
    if (v<bv){ bv=v; best=e; }
  }
  a.want=stepToward(g, a, best?fieldFor(best):fromThief, false);
}

// Thief only commits to cash it can reach before any guard.
function thiefThink(g, a){
  const live=g.guards.filter(x=>!x.out);
  const me=bfs(g.grid,[{x:a.fx,y:a.fy}],false);
  const gd=live.length?bfs(g.grid,live.map(tileOf),true):me.map(r=>r.map(()=>99));
  const ratio=TUNE.guardSpeed*(g.power>0?TUNE.slowMult:1)/TUNE.thiefSpeed;
  const safe=(x,y)=>me[y][x]>=0 && (gd[y][x]<0 || me[y][x]*ratio < gd[y][x]-1.5);
  if (g.power>0 && live.length){ // EMP: hunt the nearest guard we can reach in time
    let tgt=null,bv=1e9;
    for (const o of live){ const t=tileOf(o), d=me[t.y][t.x]; if (d>=0 && d/TUNE.thiefSpeed < g.power-0.4 && d<bv){bv=d;tgt=t;} }
    if (tgt){ a.want=stepToward(g,a,bfs(g.grid,[tgt],false),false); return; }
  }
  const danger=Math.min(...live.map(o=>{const t=tileOf(o);return me[t.y][t.x]<0?99:me[t.y][t.x];}),99);
  let best=null,bv=1e9;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const c=g.grid[y][x]; if ((c!=="."&&c!=="o")||!safe(x,y)) continue;
    let v=me[y][x] - 0.35*Math.min(gd[y][x],12);
    if (c==="o") v-= danger<8 ? 12 : -6; // save EMPs for emergencies
    if (v<bv){bv=v;best={x,y};}
  }
  if (best){ a.want=stepToward(g,a,bfs(g.grid,[best],false,(x,y)=>!safe(x,y)&&!(x===best.x&&y===best.y)),false) || stepToward(g,a,bfs(g.grid,[best],false),false); return; }
  let esc=null,ev=-1e9;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if(!safe(x,y)) continue; const v=gd[y][x]-0.4*me[y][x]; if(v>ev){ev=v;esc={x,y};} }
  a.want = esc ? stepToward(g,a,bfs(g.grid,[esc],false),false) : stepToward(g,a,gd,true);
}

// ============================================================
//  GAME — authoritative state machine. Emits events, never touches UI.
//  Events: turn{thief} floor countdown go emp empWearing tackle{guard}
//          caught{guard,lives} cleared{thief} resume{lives} pick{x,y} results
// ============================================================
function scoreOf(p){ return Math.floor(p.time)*SCORE.perSecond + p.cash*SCORE.perCash + p.floors*SCORE.perFloor + p.tackles*SCORE.perTackle + p.captures*SCORE.perCapture; }

class Game {
  constructor(players){
    this.players=players.map(p=>({ id:p.id, name:String(p.name), bot:!!p.bot, time:0, cash:0, floors:0, tackles:0, captures:0 }));
    this.order=[]; this.turn=0; this.stage=0; this.stageInTurn=0; this.state="idle"; this.timer=0; this.power=0;
    this.thief=null; this.guards=[]; this.actors=[]; this.cashLeft=0; this.cashTotal=0; this.lives=0;
    this.grid=null; this.themeIdx=0; this.events=[];
  }
  emit(type, data){ this.events.push(Object.assign({type}, data)); }
  drainEvents(){ const e=this.events; this.events=[]; return e; }
  get thiefSlot(){ return this.order[this.turn]; }
  score(p){ return scoreOf(p); }
  start(){
    const ids=this.players.map(p=>p.id);
    for (let i=ids.length-1;i>0;i--){ const j=Math.random()*(i+1)|0; [ids[i],ids[j]]=[ids[j],ids[i]]; }
    this.order=[]; for (let r=0;r<TUNE.rotations;r++) this.order.push(...ids);
    this.turn=0; this.stage=Math.random()*THEMES.length|0;
    this.beginTurn();
  }
  beginTurn(){
    this.stageInTurn=0; this.lives=TUNE.lives;
    this.emit("turn",{thief:this.thiefSlot});
    this.loadStage();
  }
  loadStage(){
    const f=makeFloor(this.stage);
    this.grid=f.grid; this.themeIdx=f.themeIdx;
    this.cashLeft=this.cashTotal=f.cash; this.power=0;
    this.thief=makeActor(this.thiefSlot,"thief",f.spawns.thief);
    const gs=this.players.map(p=>p.id).filter(id=>id!==this.thiefSlot);
    this.guards=gs.map((s,i)=>makeActor(s,"guard",f.spawns.guards[i]));
    this.actors=[this.thief,...this.guards];
    this.emit("floor",{});
    this.countdown();
  }
  countdown(){ this.state="countdown"; this.timer=TUNE.countdown; this.emit("countdown",{}); }
  actorFor(slot){ return this.actors.find(a=>a.slot===slot); }
  setWant(slot,dir){ const a=this.actorFor(slot); if (a) a.want=dir; }
  update(dt){
    if (this.state==="countdown"){ this.timer-=dt; if (this.timer<=0){ this.state="play"; this.emit("go",{}); } return; }
    if (this.state==="cleared"||this.state==="busted"){ this.timer-=dt; if (this.timer<=0) this.afterPause(); return; }
    if (this.state!=="play") return;
    this.players[this.thiefSlot].time+=dt;
    if (this.power>0){ const was=this.power; this.power=Math.max(0,this.power-dt);
      if (was>1.5&&this.power<=1.5) this.emit("empWearing",{}); }
    const esc=1+TUNE.stageEscalation*this.stageInTurn;
    stepActor(this,this.thief,TUNE.thiefSpeed,dt);
    if (this.state!=="play") return;
    for (const g of this.guards){
      if (g.out>0){ g.out-=dt; if (g.out<=0) resetActor(g); continue; }
      stepActor(this,g,TUNE.guardSpeed*esc*(this.power>0?TUNE.slowMult:1),dt);
    }
    for (const g of this.guards){
      if (g.out>0) continue;
      let dx=Math.abs(g.x-this.thief.x); dx=Math.min(dx,W-dx);
      if (dx+Math.abs(g.y-this.thief.y)<TUNE.catchRadius){
        if (this.power>0){
          g.out=TUNE.respawnDelay; g.x=-99; this.players[this.thiefSlot].tackles++;
          this.emit("tackle",{guard:g.slot});
        } else {
          this.players[g.slot].captures++; this.lives--;
          this.state="busted"; this.timer=TUNE.pause+0.6;
          this.emit("caught",{guard:g.slot, lives:this.lives});
          return;
        }
      }
    }
  }
  onTile(a){
    if (a.role!=="thief"||this.state!=="play") return;
    const c=this.grid[a.fy][a.fx];
    if (c==="."||c==="o"){
      this.grid[a.fy][a.fx]="_"; this.cashLeft--; this.players[a.slot].cash++;
      this.emit("pick",{x:a.fx,y:a.fy});
      if (c==="o"){ this.power=TUNE.powerTime; this.emit("emp",{}); }
      if (this.cashLeft<=0){
        this.players[a.slot].floors++; this.stageInTurn++;
        this.state="cleared"; this.timer=TUNE.pause+0.6;
        this.emit("cleared",{thief:a.slot});
      }
    }
  }
  afterPause(){
    if (this.state==="cleared"){ this.stage++; this.loadStage(); return; }
    if (this.lives>0){ // busted, lives remain: same floor, cash stays collected
      this.emit("resume",{lives:this.lives});
      for (const a of this.actors) resetActor(a); this.power=0; this.countdown(); return;
    }
    this.turn++;
    if (this.turn>=this.order.length){ this.state="results"; this.emit("results",{}); return; }
    this.stage++; this.beginTurn();
  }
  // Compact network snapshot (actors + scores). The grid is sent separately on "floor".
  snapshot(){
    const r=v=>Math.round(v*1000)/1000;
    return {
      st:this.state, tm:r(this.timer), pw:r(this.power), lv:this.lives, cl:this.cashLeft, ct:this.cashTotal, ts:this.thiefSlot,
      a:this.actors.map(a=>[a.slot, r(a.x), r(a.y), a.face, a.moving?1:0, a.out>0?1:0]),
      p:this.players.map(p=>[r(p.time),p.cash,p.floors,p.tackles,p.captures,p.bot?1:0]),
    };
  }
}

return { TUNE, SCORE, DIRS, DLIST, DNAMES, THEMES, BOT_NAMES, W, H, wrapX, walkable, bfs, makeFloor, Game, scoreOf };
});
