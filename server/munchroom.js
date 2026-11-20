// Marble Munch room: up to 40 hippos, server-authoritative (the server runs shared/munch.js).
// Clients send fire{} (one chomp per Space press) and ans{v} (their answer). The server sends a snapshot 20×/s,
// and a caught marble's question only to the player who caught it: q{q:{top,bottom,op,len,money},sec}.
// Host / teacher settings in the lobby: mode{mode} · digits{d} · qtime{s} (seconds per question, 2–10, default 4).
"use strict";
const { RoomBase }=require("./roombase");
const MUNCH=require("../shared/munch.js");

const env=(k,d)=>+process.env[k]||d;
const MAX_PLAYERS=40, MIN_PLAYERS=1;
const TICK_MS=50, SUBSTEPS=2;                         // 20 snapshots/s, physics at 40 Hz
const AUTO_START_MS=env("MUNCH_AUTO_MS",30000);
const COUNTDOWN_MS=env("MUNCH_COUNTDOWN_MS",3000);

class MunchRoom extends RoomBase {
  constructor(code, isPublic, bus, instanceId, onClose){
    super(code, isPublic, bus, instanceId, onClose, "munch", MAX_PLAYERS);
    this.players=new Map();   // pid -> {pid,cid,name,token,connected,color}
    this.nextPid=1; this.host=0; this.autoAt=0; this.game=null; this.timer=null;
    this.mode="add"; this.digits="1"; this.qTime=MUNCH.T.qTime;
  }
  humanCount(){ return this.players.size; }
  connectedCount(){ let n=0; for (const p of this.players.values()) if (p.connected) n++; return n; }
  canReconnect(){ for (const p of this.players.values()) if (!p.connected) return true; return false; }
  cleanup(){ clearInterval(this.timer); clearTimeout(this.autoTimer); clearTimeout(this.goTimer); }
  byCid(cid){ for (const p of this.players.values()) if (p.cid===cid) return p; return null; }
  freeColor(){ const used=new Set([...this.players.values()].map(p=>p.color)); for (let i=0;i<MAX_PLAYERS;i++) if (!used.has(i)) return i; return 0; }
  roster(){ return [...this.players.values()].map(p=>({ pid:p.pid, name:p.name, color:p.color, connected:p.connected })); }
  startMsg(inMs){ return { t:"start", players:this.roster().filter(p=>p.pid!==this.teacher), teacher:this.teacher, in:inMs, qtime:this.qTime, mode:this.mode, digits:this.digits }; }

  lobby(){
    return this.send({ t:"lobby", game:"munch", code:this.code, pub:this.isPublic, state:this.state, max:MAX_PLAYERS,
      host:this.host, teacher:this.teacher, mode:this.mode, digits:this.digits, qtime:this.qTime,
      autoIn:this.autoAt?Math.max(0,this.autoAt-Date.now()):0, players:this.roster() });
  }
  hostInLobby(p){ return p && p.pid===this.host && this.state==="lobby"; }
  handle(msg){
    const p=this.byCid(msg.cid);
    switch (msg.t){
      case "join": return this.join(msg);
      case "start": if (p && p.pid===this.host && this.state==="lobby") this.startGame(); return;
      case "teacher": return this.makeTeacher(p,msg.acct);
      case "iam": return this.handleIam(p,msg);
      case "mode": if (this.hostInLobby(p) && MUNCH.MODES.includes(msg.mode)){ this.mode=msg.mode; this.lobby(); } return;
      case "digits": if (this.hostInLobby(p) && ["1","12","2"].includes(msg.d)){ this.digits=msg.d; this.lobby(); } return;
      case "qtime": if (this.hostInLobby(p)){ const s=msg.s|0; if (s>=MUNCH.T.qMin && s<=MUNCH.T.qMax){ this.qTime=s; this.lobby(); } } return;
      case "fire": if (p && this.game && this.started) this.game.chomp(p.pid); return;
      case "ans": if (p && this.game){ const r=this.game.answer(p.pid,msg.v); if (r) this.send({ t:"res", ok:r==="right" },p.cid); } return;
      case "leave": case "drop":
        if (!p) return;
        if (this.state==="playing" && msg.t==="drop") p.connected=false;
        else { this.players.delete(p.pid); if (this.game) this.game.removePlayer(p.pid); }
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
      if (this.state==="playing" && this.game){                                     // late joiner: a new hippo on the rim
        this.game.addPlayer({ id:p.pid, name }); this.send({ t:"addp", p:{ pid:p.pid, name, color:p.color, connected:true } });
      }
    }
    if (!this.host || !this.players.get(this.host)?.connected) this.host=p.pid;
    this.emptySince=0; this.saveSession(token);
    this.send({ t:"joined", code:this.code, game:"munch", pid:p.pid },cid);
    this.register(); this.lobby(); this.scheduleAuto();
    if (this.teacher && p.pid!==this.teacher) this.askIdentity(p);
    if (this.state==="playing" && this.game){
      this.send(this.startMsg(0),cid);                                            // (re)join mid-game
      const gp=this.game.players.find(q=>q.id===p.pid);
      if (gp && gp.q) this.send({ t:"q", q:{ top:gp.q.top, bottom:gp.q.bottom, op:gp.q.op, len:gp.q.len, money:!!gp.q.money }, sec:Math.max(0,gp.qLeft) },cid);
    }
  }
  scheduleAuto(){
    if (this.state!=="lobby" || this.teacher) return;
    if (this.connectedCount()>=2){
      if (!this.autoAt){ this.autoAt=Date.now()+AUTO_START_MS; this.autoTimer=setTimeout(()=>this.startGame(),AUTO_START_MS); this.lobby(); }
    } else if (this.autoAt){ clearTimeout(this.autoTimer); this.autoAt=0; this.lobby(); }
  }
  startGame(){
    if (this.state!=="lobby" || this.connectedCount()-(this.teacher?1:0)<MIN_PLAYERS) return;
    clearTimeout(this.autoTimer); this.autoAt=0;
    this.state="playing"; this.started=false; this.register(); this.lobby();
    this.game=new MUNCH.Game([...this.players.values()].filter(p=>p.pid!==this.teacher).map(p=>({ id:p.pid, name:p.name })),
      { mode:this.mode, digits:this.digits, qTime:this.qTime });
    this.send(this.startMsg(COUNTDOWN_MS));
    this.send({ t:"s", s:this.game.snapshot(), e:[] });
    this.goTimer=setTimeout(()=>{ this.started=true; this.timer=setInterval(()=>this.tick(),TICK_MS); },COUNTDOWN_MS);
  }
  tick(){
    const g=this.game; if (!g) return;
    for (let i=0;i<SUBSTEPS;i++) g.step(TICK_MS/1000/SUBSTEPS);
    const e=g.drainEvents(), pub=[];
    for (const ev of e){
      if (ev.type==="catch"){ const p=this.players.get(ev.id); if (p) this.send({ t:"q", q:ev.q, sec:ev.t },p.cid); pub.push({ type:"catch", id:ev.id }); }
      else pub.push(ev);
    }
    this.send({ t:"s", s:g.snapshot(), e:pub });
    if (g.phase==="over") this.finish();
  }
  finish(){
    clearInterval(this.timer); this.timer=null;
    const rank=this.game.ranking().map(r=>({ ...r, pid:r.id, color:this.players.get(r.id)?.color??0 }));
    this.send({ t:"results", rank });
    this.recordSession(this.mode,rank.map((e,i)=>({ pid:e.pid, place:i+1, score:e.score, stats:{ marbles:e.score, right:e.right, wrong:e.wrong, slow:e.slow } })));
    this.game=null; this.state="lobby"; this.started=false;
    for (const [pid,p] of this.players) if (!p.connected) this.players.delete(pid);
    if (!this.players.get(this.host)) this.pickHost();
    this.register(); this.lobby(); this.scheduleAuto();
  }
}
module.exports={ MunchRoom, MAX_PLAYERS };
