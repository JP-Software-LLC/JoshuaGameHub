// Bear Attack! room: up to 40 players, server-authoritative (the server runs shared/bear.js).
// Clients send only their stick direction; the server sends a snapshot 20×/s.
"use strict";
const { RoomBase }=require("./roombase");
const BEAR=require("../shared/bear.js");

const env=(k,d)=>+process.env[k]||d;
const MAX_PLAYERS=40, MIN_PLAYERS=1;
const TICK_MS=50, SUBSTEPS=2;                         // 20 snapshots/s, physics at 40 Hz
const AUTO_START_MS=env("BEAR_AUTO_MS",30000);
const COUNTDOWN_MS=env("BEAR_COUNTDOWN_MS",3000);

class BearRoom extends RoomBase {
  constructor(code, isPublic, bus, instanceId, onClose){
    super(code, isPublic, bus, instanceId, onClose, "bear", MAX_PLAYERS);
    this.players=new Map();   // pid -> {pid,cid,name,token,connected,color}
    this.nextPid=1; this.host=0; this.autoAt=0; this.game=null; this.timer=null;
  }
  humanCount(){ return this.players.size; }
  connectedCount(){ let n=0; for (const p of this.players.values()) if (p.connected) n++; return n; }
  canReconnect(){ for (const p of this.players.values()) if (!p.connected) return true; return false; }
  cleanup(){ clearInterval(this.timer); clearTimeout(this.autoTimer); clearTimeout(this.goTimer); }
  byCid(cid){ for (const p of this.players.values()) if (p.cid===cid) return p; return null; }
  freeColor(){ const used=new Set([...this.players.values()].map(p=>p.color)); for (let i=0;i<MAX_PLAYERS;i++) if (!used.has(i)) return i; return 0; }
  roster(){ return [...this.players.values()].map(p=>({ pid:p.pid, name:p.name, color:p.color, connected:p.connected })); }

  lobby(){
    return this.send({ t:"lobby", game:"bear", code:this.code, pub:this.isPublic, state:this.state, max:MAX_PLAYERS,
      host:this.host, autoIn:this.autoAt?Math.max(0,this.autoAt-Date.now()):0, players:this.roster() });
  }
  handle(msg){
    const p=this.byCid(msg.cid);
    switch (msg.t){
      case "join": return this.join(msg);
      case "start": if (p && p.pid===this.host && this.state==="lobby") this.startGame(); return;
      case "in": if (p && this.game) this.game.setInput(p.pid, +msg.x||0, +msg.y||0); return;
      case "leave": case "drop":
        if (!p) return;
        if (this.game) this.game.setInput(p.pid,0,0);                          // let go of the stick
        if (this.state==="playing" && msg.t==="drop") p.connected=false;
        else {
          this.players.delete(p.pid);
          if (this.game){ const gp=this.game.players.find(q=>q.id===p.pid); if (gp && gp.alive){ gp.alive=false; gp.outT=this.game.time; gp.outRound=this.game.round; } }
        }
        if (p.pid===this.host) this.pickHost();
        this.register(); this.lobby(); this.scheduleAuto(); this.checkEmpty(); return;
    }
  }
  pickHost(){ const n=[...this.players.values()].find(q=>q.connected); this.host=n?n.pid:0; }
  join({cid,name,token}){
    let p=token?[...this.players.values()].find(q=>q.token===token):null;
    if (p) Object.assign(p,{ cid,name,connected:true });
    else {
      if (this.players.size>=MAX_PLAYERS) return this.send({ t:"error", code:"full", msg:"That game is full (40 players)." },cid);
      if (this.state!=="lobby") return this.send({ t:"error", code:"full", msg:"That game has already started." },cid);
      p={ pid:this.nextPid++, cid, name, token, connected:true, color:this.freeColor() };
      this.players.set(p.pid,p);
    }
    if (!this.host || !this.players.get(this.host)?.connected) this.host=p.pid;
    this.emptySince=0; this.saveSession(token);
    this.send({ t:"joined", code:this.code, game:"bear", pid:p.pid },cid);
    this.register(); this.lobby(); this.scheduleAuto();
    if (this.state==="playing" && this.game) this.send({ t:"start", players:this.roster(), in:0 },cid);   // rejoin mid-game
  }
  scheduleAuto(){
    if (this.state!=="lobby") return;
    if (this.connectedCount()>=2){
      if (!this.autoAt){ this.autoAt=Date.now()+AUTO_START_MS; this.autoTimer=setTimeout(()=>this.startGame(),AUTO_START_MS); this.lobby(); }
    } else if (this.autoAt){ clearTimeout(this.autoTimer); this.autoAt=0; this.lobby(); }
  }
  startGame(){
    if (this.state!=="lobby" || this.connectedCount()<MIN_PLAYERS) return;
    clearTimeout(this.autoTimer); this.autoAt=0;
    this.state="playing"; this.register(); this.lobby();
    this.game=new BEAR.Game([...this.players.values()].map(p=>({ id:p.pid, name:p.name })));
    this.send({ t:"start", players:this.roster(), in:COUNTDOWN_MS });
    this.send({ t:"s", s:this.game.snapshot(), e:[] });                         // show the spawn during the countdown
    this.goTimer=setTimeout(()=>{ this.timer=setInterval(()=>this.tick(),TICK_MS); },COUNTDOWN_MS);
  }
  tick(){
    const g=this.game; if (!g) return;
    for (let i=0;i<SUBSTEPS;i++) g.step(TICK_MS/1000/SUBSTEPS);
    const e=g.drainEvents();
    this.send({ t:"s", s:g.snapshot(), e });
    if (g.phase==="over") this.finish();
  }
  finish(){
    clearInterval(this.timer); this.timer=null;
    const rank=this.game.ranking().map(r=>({ ...r, pid:r.id, color:this.players.get(r.id)?.color??0 }));
    this.send({ t:"results", rank });
    this.game=null; this.state="lobby";
    for (const [pid,p] of this.players) if (!p.connected) this.players.delete(pid);
    if (!this.players.get(this.host)) this.pickHost();
    this.register(); this.lobby(); this.scheduleAuto();
  }
}
module.exports={ BearRoom, MAX_PLAYERS };
