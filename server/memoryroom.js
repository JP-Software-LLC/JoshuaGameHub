// Memory Tiles room: up to 40, server-authoritative (runs shared/memory.js).
// Each player's position is private (sent only to them) until the round's reveal.
"use strict";
const { RoomBase }=require("./roombase");
const MEMORY=require("../shared/memory.js");

const env=(k,d)=>+process.env[k]||d;
const MAX_PLAYERS=40;
const TICK_MS=100;
const COUNTDOWN_MS=env("MEM_COUNTDOWN_MS",3000);
const AUTO_START_MS=env("MEM_AUTO_MS",30000);

class MemoryRoom extends RoomBase {
  constructor(code, isPublic, bus, instanceId, onClose){
    super(code, isPublic, bus, instanceId, onClose, "memory", MAX_PLAYERS);
    this.players=new Map(); this.nextPid=1; this.host=0; this.autoAt=0; this.game=null; this.timer=null;
  }
  humanCount(){ return this.players.size; }
  connectedCount(){ let n=0; for (const p of this.players.values()) if (p.connected) n++; return n; }
  canReconnect(){ for (const p of this.players.values()) if (!p.connected) return true; return false; }
  cleanup(){ clearInterval(this.timer); clearTimeout(this.autoTimer); clearTimeout(this.goTimer); }
  byCid(cid){ for (const p of this.players.values()) if (p.cid===cid) return p; return null; }
  freeColor(){ const used=new Set([...this.players.values()].map(p=>p.color)); for (let i=0;i<MAX_PLAYERS;i++) if (!used.has(i)) return i; return 0; }
  roster(){ return [...this.players.values()].map(p=>({ pid:p.pid, name:p.name, color:p.color, connected:p.connected })); }
  lobby(){
    return this.send({ t:"lobby", game:"memory", code:this.code, pub:this.isPublic, state:this.state, max:MAX_PLAYERS,
      host:this.host, teacher:this.teacher, autoIn:this.autoAt?Math.max(0,this.autoAt-Date.now()):0, players:this.roster() });
  }
  meMsg(pid){ const gp=this.game&&this.game.players.find(q=>q.id===pid); return gp?{ t:"me", x:gp.x, y:gp.y, alive:gp.alive }:null; }
  handle(msg){
    const p=this.byCid(msg.cid);
    switch (msg.t){
      case "join": return this.join(msg);
      case "start": if (p && p.pid===this.host && this.state==="lobby") this.startGame(); return;
      case "teacher": return this.makeTeacher(p,msg.acct);
      case "iam": return this.handleIam(p,msg);
      case "tile": {
        if (!p || !this.game) return;
        const at=this.game.move(p.pid, msg.dx|0, msg.dy|0);
        if (at) this.send({ t:"me", ...at, alive:true },p.cid);              // only you learn where you are
        return; }
      case "leave": case "drop":
        if (!p) return;
        if (this.state==="playing" && msg.t==="drop") p.connected=false;
        else {
          this.players.delete(p.pid);
          if (this.game){ const gp=this.game.players.find(q=>q.id===p.pid); if (gp&&gp.alive){ gp.alive=false; gp.outRound=this.game.round; } }
        }
        if (p.pid===this.teacher && msg.t==="leave") this.teacher=0;
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
      p={ pid:this.nextPid++, cid, name, token, connected:true, color:this.freeColor() };
      this.players.set(p.pid,p);
      if (this.state==="playing" && this.game){                                     // late joiner: into the running game from 0, or wait for the next one
        if (typeof this.game.addPlayer==="function"){ this.game.addPlayer({ id:p.pid, name }); this.send({ t:"addp", p:{ pid:p.pid, name, color:p.color, connected:true } }); }
        else p.wait=true;
      }
    }
    if (!this.host || !this.players.get(this.host)?.connected) this.host=p.pid;
    this.emptySince=0; this.saveSession(token);
    this.send({ t:"joined", code:this.code, game:"memory", pid:p.pid },cid);
    this.register(); this.lobby(); this.scheduleAuto();
    if (this.teacher && p.pid!==this.teacher) this.askIdentity(p);
    if (this.state==="playing" && this.game && !p.wait){ this.send({ t:"start", players:this.roster().filter(q=>q.pid!==this.teacher), teacher:this.teacher, in:0 },cid); const me=this.meMsg(p.pid); if (me) this.send(me,cid); }
  }
  scheduleAuto(){
    if (this.state!=="lobby" || this.teacher) return;
    if (this.connectedCount()>=2){
      if (!this.autoAt){ this.autoAt=Date.now()+AUTO_START_MS; this.autoTimer=setTimeout(()=>this.startGame(),AUTO_START_MS); this.lobby(); }
    } else if (this.autoAt){ clearTimeout(this.autoTimer); this.autoAt=0; this.lobby(); }
  }
  startGame(){
    if (this.state!=="lobby" || this.connectedCount()-(this.teacher?1:0)<1) return;
    clearTimeout(this.autoTimer); this.autoAt=0;
    for (const q of this.players.values()) q.wait=false;
    this.state="playing"; this.register(); this.lobby();
    this.game=new MEMORY.Game([...this.players.values()].filter(p=>p.pid!==this.teacher).map(p=>({ id:p.pid, name:p.name })));
    this.send({ t:"start", players:this.roster().filter(p=>p.pid!==this.teacher), teacher:this.teacher, in:COUNTDOWN_MS });
    for (const p of this.players.values()){ const me=this.meMsg(p.pid); if (me) this.send(me,p.cid); }
    this.goTimer=setTimeout(()=>{ this.game.start(); this.flush(); this.timer=setInterval(()=>this.tick(),TICK_MS); },COUNTDOWN_MS);
  }
  tick(){ if (!this.game) return; this.game.step(TICK_MS/1000); this.flush(); }
  flush(){
    for (const e of this.game.drainEvents()){
      if (e.type==="over") return this.finish();
      const { type, ...rest }=e;
      this.send({ t:type, ...rest });
    }
  }
  finish(){
    clearInterval(this.timer); this.timer=null;
    const rank=this.game.ranking().map(r=>({ ...r, pid:r.id, color:this.players.get(r.id)?.color??0 }));
    this.send({ t:"final", rank });
    this.recordSession(null,rank.map((e,i)=>({ pid:e.pid, place:i+1, score:e.rounds, stats:{ stillIn:e.alive, rounds:e.rounds, correct:e.correct } })));
    this.game=null; this.state="lobby";
    for (const [pid,p] of this.players) if (!p.connected) this.players.delete(pid);
    if (!this.players.get(this.host)) this.pickHost();
    this.register(); this.lobby(); this.scheduleAuto();
  }
}
module.exports={ MemoryRoom };
