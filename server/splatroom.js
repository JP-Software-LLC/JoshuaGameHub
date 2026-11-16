// SPLAT! room: 2–6 players. Everyone gets one turn holding the water balloon.
// Each turn: up to 3 throws. Hiders pick a barrel (Left / Up / Right) behind a sheet
// (10 s, then 5 s, then 3 s); the sheet drops; the thrower picks a barrel; everyone
// behind it is splatted and sits out the rest of that turn.
//
// Server-authoritative so the thrower can never see where people hid: hiding spots are
// sent only to the other players, never to the thrower's connection.
//
// Points: +10 per throw dodged (0/10/20/30 per turn), +20 per player splatted.
// Balance: with random choices a hider dodges a throw 2/3 of the time → ≈14 pts per turn
// hiding; a thrower splats ≈0.70 × (players−1) per turn → ×20 ≈ 14 × (players−1), which is
// what each player earns across their hiding turns. Even at any lobby size.
"use strict";
const { RoomBase }=require("./roombase");

const env=(k,d)=>+process.env[k]||d;                   // overridable for tests
const MIN_PLAYERS=2, MAX_PLAYERS=6;
const HIDE_MS=[env("SPLAT_HIDE1_MS",16000), env("SPLAT_HIDE2_MS",11000), env("SPLAT_HIDE3_MS",8000)];
const THROW_MS=env("SPLAT_THROW_MS",12000);             // thrower's time to pick (random after)
const INTRO_MS=env("SPLAT_INTRO_MS",5000);
const SPLASH_MS=env("SPLAT_SPLASH_MS",3500);
const TURN_END_MS=env("SPLAT_TURN_END_MS",4000);
const AUTO_START_MS=env("SPLAT_AUTO_MS",30000);        // any lobby auto-starts 30 s after a 2nd player joins
const PTS_DODGE=10, PTS_SPLASH=20;

class SplatRoom extends RoomBase {
  constructor(code, isPublic, bus, instanceId, onClose){
    super(code, isPublic, bus, instanceId, onClose, "splat", MAX_PLAYERS);
    this.players=new Map();        // pid -> {pid,cid,name,token,connected,color,st:{points,dodged,splashes,splatted}}
    this.nextPid=1; this.host=0; this.timer=null; this.autoAt=0;
    this.resetGame();
  }
  resetGame(){ this.order=[]; this.turnIdx=-1; this.thrower=0; this.alive=new Set(); this.picks=new Map(); this.phase=""; this.phaseEnd=0; this.throwN=0; this.turnSplats=0; }
  humanCount(){ return this.players.size; }
  connectedCount(){ let n=0; for (const p of this.players.values()) if (p.connected) n++; return n; }
  canReconnect(){ for (const p of this.players.values()) if (!p.connected) return true; return false; }
  cleanup(){ clearTimeout(this.timer); clearTimeout(this.autoTimer); }
  byCid(cid){ for (const p of this.players.values()) if (p.cid===cid) return p; return null; }
  freeColor(){ const used=new Set([...this.players.values()].map(p=>p.color)); for (let i=0;i<MAX_PLAYERS;i++) if (!used.has(i)) return i; return 0; }
  scores(){ const o={}; for (const p of this.players.values()) o[p.pid]=p.st.points; return o; }
  roster(){ return [...this.players.values()].map(p=>({ pid:p.pid, name:p.name, color:p.color, connected:p.connected })); }
  later(fn,ms){ clearTimeout(this.timer); this.timer=setTimeout(()=>{ try{ fn(); }catch(e){ console.error("[splat]",e); } },ms); }

  lobby(){
    return this.send({ t:"lobby", game:"splat", code:this.code, pub:this.isPublic, state:this.state, min:MIN_PLAYERS, max:MAX_PLAYERS,
      host:this.host, autoIn:this.autoAt?Math.max(0,this.autoAt-Date.now()):0, players:this.roster() });
  }
  // ---------------- messages ----------------
  handle(msg){
    const p=this.byCid(msg.cid);
    switch (msg.t){
      case "join": return this.join(msg);
      case "start": if (p && p.pid===this.host && this.state==="lobby" && this.connectedCount()>=MIN_PLAYERS) this.startGame(); return;
      case "pick":
        if (!p || this.phase!=="hide" || !this.alive.has(p.pid)) return;
        if (![0,1,2].includes(msg.b)) return;
        this.picks.set(p.pid,msg.b); this.sendHidePos(); return;
      case "throw":
        if (!p || this.phase!=="throw" || p.pid!==this.thrower || ![0,1,2].includes(msg.b)) return;
        return this.doThrow(msg.b);
      case "leave": case "drop":
        if (!p) return;
        if (this.state==="playing" && msg.t==="drop") p.connected=false;     // keep their spot; random picks cover them
        else { this.players.delete(p.pid); this.alive.delete(p.pid); this.picks.delete(p.pid); }
        if (p.pid===this.host) this.pickHost();
        if (this.state==="playing"){
          this.send({ t:"roster", players:this.roster(), alive:[...this.alive] });
          if (this.players.size<MIN_PLAYERS) this.finish();                   // not enough left to play on
        }
        this.register(); this.lobby(); this.scheduleAuto(); this.checkEmpty(); return;
    }
  }
  pickHost(){ const n=[...this.players.values()].find(q=>q.connected); this.host=n?n.pid:0; }
  join({cid,name,token}){
    let p=token?[...this.players.values()].find(q=>q.token===token):null;
    if (p) Object.assign(p,{ cid,name,connected:true });
    else {
      if (this.players.size>=MAX_PLAYERS) return this.send({ t:"error", code:"full", msg:"That room is full (6 players)." },cid);
      if (this.state!=="lobby") return this.send({ t:"error", code:"full", msg:"That game has already started." },cid);
      p={ pid:this.nextPid++, cid, name, token, connected:true, color:this.freeColor(), st:{ points:0, dodged:0, splashes:0, splatted:0 } };
      this.players.set(p.pid,p);
    }
    if (!this.host || !this.players.get(this.host)?.connected) this.host=p.pid;
    this.emptySince=0; this.saveSession(token);
    this.send({ t:"joined", code:this.code, game:"splat", pid:p.pid },cid);
    this.register(); this.lobby(); this.scheduleAuto();
    if (this.state==="playing") this.send(this.syncMsg(p.pid),cid);           // reconnect mid-game
  }
  scheduleAuto(){
    if (this.state!=="lobby") return;
    if (this.connectedCount()>=MIN_PLAYERS){
      if (!this.autoAt){ this.autoAt=Date.now()+AUTO_START_MS; this.autoTimer=setTimeout(()=>this.startGame(),AUTO_START_MS); this.lobby(); }
    } else if (this.autoAt){ clearTimeout(this.autoTimer); this.autoAt=0; this.lobby(); }
  }
  // ---------------- game flow ----------------
  startGame(){
    if (this.state!=="lobby" || this.connectedCount()<MIN_PLAYERS) return;
    clearTimeout(this.autoTimer); this.autoAt=0;
    this.resetGame();
    for (const p of this.players.values()) p.st={ points:0, dodged:0, splashes:0, splatted:0 };
    this.order=[...this.players.keys()].sort(()=>Math.random()-0.5);
    this.state="playing"; this.register(); this.lobby();
    this.send({ t:"begin", players:this.roster(), order:this.order });
    this.nextTurn();
  }
  nextTurn(){
    do { this.turnIdx++; } while (this.turnIdx<this.order.length && !this.players.has(this.order[this.turnIdx]));
    if (this.turnIdx>=this.order.length) return this.finish();
    this.thrower=this.order[this.turnIdx];
    this.alive=new Set([...this.players.keys()].filter(pid=>pid!==this.thrower));
    this.throwN=0; this.turnSplats=0; this.phase="intro"; this.phaseEnd=Date.now()+INTRO_MS;
    this.send({ t:"turn", thrower:this.thrower, n:this.turnIdx+1, of:this.order.length, alive:[...this.alive], scores:this.scores(), dur:INTRO_MS });
    this.later(()=>this.hide(), INTRO_MS);
  }
  hide(){
    this.throwN++; this.picks=new Map();
    const dur=HIDE_MS[this.throwN-1];
    this.phase="hide"; this.phaseEnd=Date.now()+dur;
    this.send({ t:"phase", phase:"hide", throw:this.throwN, dur, alive:[...this.alive] });
    this.later(()=>this.lock(), dur);
  }
  // hiding spots go to everyone EXCEPT the thrower
  sendHidePos(){
    const pos=Object.fromEntries(this.picks);
    for (const q of this.players.values()) if (q.pid!==this.thrower && q.connected) this.send({ t:"hidepos", pos },q.cid);
  }
  lock(){
    for (const pid of this.alive) if (!this.picks.has(pid)) this.picks.set(pid,Math.random()*3|0);   // didn't choose: random barrel
    this.sendHidePos();
    this.phase="throw"; this.phaseEnd=Date.now()+THROW_MS;
    this.send({ t:"phase", phase:"throw", throw:this.throwN, dur:THROW_MS, alive:[...this.alive] });
    this.later(()=>this.doThrow(Math.random()*3|0), THROW_MS);
  }
  doThrow(b){
    if (this.phase!=="throw") return;
    clearTimeout(this.timer);
    const thrower=this.players.get(this.thrower);
    const hit=[...this.alive].filter(pid=>this.picks.get(pid)===b);
    for (const pid of hit){ this.alive.delete(pid); const q=this.players.get(pid); if (q) q.st.splatted++; }
    for (const pid of this.alive){ const q=this.players.get(pid); if (q){ q.st.dodged++; q.st.points+=PTS_DODGE; } }
    if (thrower){ thrower.st.splashes+=hit.length; thrower.st.points+=hit.length*PTS_SPLASH; }
    this.turnSplats+=hit.length;
    this.phase="splash"; this.phaseEnd=Date.now()+SPLASH_MS;
    this.send({ t:"splash", barrel:b, throw:this.throwN, pos:Object.fromEntries(this.picks), hit, alive:[...this.alive], scores:this.scores(), dur:SPLASH_MS });
    const done=!this.alive.size || this.throwN>=3;
    this.later(()=>done?this.endTurn():this.hide(), SPLASH_MS);
  }
  endTurn(){
    this.phase="turnEnd"; this.phaseEnd=Date.now()+TURN_END_MS;
    this.send({ t:"turnEnd", thrower:this.thrower, splatted:this.turnSplats, gained:this.turnSplats*PTS_SPLASH, dry:[...this.alive], scores:this.scores(), dur:TURN_END_MS });
    this.later(()=>this.nextTurn(), TURN_END_MS);
  }
  finish(){
    clearTimeout(this.timer);
    const rank=[...this.players.values()].map(p=>({ pid:p.pid, name:p.name, color:p.color, ...p.st }))
      .sort((a,b)=>b.points-a.points||b.splashes-a.splashes||b.dodged-a.dodged);
    this.send({ t:"final", rank });
    this.state="lobby"; this.resetGame();
    for (const [pid,p] of this.players) if (!p.connected) this.players.delete(pid);
    if (!this.players.get(this.host)) this.pickHost();
    this.register(); this.lobby(); this.scheduleAuto();
  }
  syncMsg(pid){
    return { t:"sync", players:this.roster(), thrower:this.thrower, n:this.turnIdx+1, of:this.order.length, phase:this.phase,
      throw:this.throwN, left:Math.max(0,this.phaseEnd-Date.now()), alive:[...this.alive], scores:this.scores(),
      pos:pid!==this.thrower&&this.phase==="hide"?Object.fromEntries(this.picks):{} };
  }
}
module.exports={ SplatRoom, PTS_DODGE, PTS_SPLASH, MAX_PLAYERS };
