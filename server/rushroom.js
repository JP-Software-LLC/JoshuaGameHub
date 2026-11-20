// Rush Hour room: up to 40 racers. The server never simulates driving: each browser drives its
// own car on a road generated from a shared seed. The server relays everyone's position ~10×/s
// (for ghost cars and the catch-up), records finish times, and ranks the race.
"use strict";
const crypto=require("crypto");
const { RoomBase }=require("./roombase");
const cleanLog=l=>{ if (!Array.isArray(l)) return []; const out=l.slice(0,400).map(x=>{ const o={}; for (const [k,v] of Object.entries(x||{}).slice(0,8)) if (["string","number","boolean"].includes(typeof v)) o[k.slice(0,12)]=typeof v==="string"?v.slice(0,40):v; return o; }); return JSON.stringify(out).length<60000?out:[]; };

const RUSH=require("../shared/rush.js");

const env=(k,d)=>+process.env[k]||d;
const MAX_PLAYERS=40, MIN_PLAYERS=1;
const COUNTDOWN_MS=env("RUSH_COUNTDOWN_MS",3000);
const RELAY_MS=100;                                   // position broadcast rate
const AFTER_FIRST_MS=env("RUSH_AFTER_FIRST_MS",45000); // race closes this long after the winner finishes
const MAX_RACE_MS=env("RUSH_MAX_MS",6*60*1000);
const AUTO_START_MS=env("RUSH_AUTO_MS",30000);
const DIST=env("RUSH_DIST",RUSH.T.dist);

class RushRoom extends RoomBase {
  constructor(code, isPublic, bus, instanceId, onClose){
    super(code, isPublic, bus, instanceId, onClose, new.target.KIND, MAX_PLAYERS);
    this.dist=new.target.DIST; this.digits=new.target.DIGITS?"1":null;     // Hurdle Dash: how many digits in each sum
    this.mode=new.target.MODES?new.target.MODES[0]:null;                   // Mathsketball: Math Race question type
    this.players=new Map();   // pid -> {pid,cid,name,token,connected,color,d,x,fin}
    this.nextPid=1; this.host=0; this.autoAt=0; this.relay=null; this.endTimer=null;
  }
  humanCount(){ return this.players.size; }
  connectedCount(){ let n=0; for (const p of this.players.values()) if (p.connected) n++; return n; }
  canReconnect(){ for (const p of this.players.values()) if (!p.connected) return true; return false; }
  cleanup(){ clearInterval(this.relay); clearTimeout(this.endTimer); clearTimeout(this.capTimer); clearTimeout(this.autoTimer); }
  byCid(cid){ for (const p of this.players.values()) if (p.cid===cid) return p; return null; }
  freeColor(){ const used=new Set([...this.players.values()].map(p=>p.color)); for (let i=0;i<MAX_PLAYERS;i++) if (!used.has(i)) return i; return 0; }
  roster(){ return [...this.players.values()].map(p=>({ pid:p.pid, name:p.name, color:p.color, connected:p.connected })); }

  lobby(){
    return this.send({ t:"lobby", game:this.kind, code:this.code, pub:this.isPublic, state:this.state, max:MAX_PLAYERS,
      digits:this.digits, mode:this.mode, host:this.host, teacher:this.teacher, autoIn:this.autoAt?Math.max(0,this.autoAt-Date.now()):0, players:this.roster() });
  }
  handle(msg){
    const p=this.byCid(msg.cid);
    switch (msg.t){
      case "join": return this.join(msg);
      case "start": if (p && p.pid===this.host && this.state==="lobby") this.startRace(); return;
      case "teacher": return this.makeTeacher(p,msg.acct);
      case "digits":
        if (p && p.pid===this.host && this.state==="lobby" && this.digits && ["1","12","2"].includes(msg.d)){ this.digits=msg.d; this.lobby(); }
        return;
      case "mode":
        if (p && p.pid===this.host && this.state==="lobby" && this.mode && this.constructor.MODES.includes(msg.mode)){ this.mode=msg.mode; this.lobby(); }
        return;
      case "iam": return this.handleIam(p,msg);
      case "pos":
        if (!p || this.state!=="playing" || p.fin!=null) return;
        if (Number.isFinite(msg.d)) p.d=Math.max(0,Math.min(this.dist,msg.d));
        if (Number.isFinite(msg.x)) p.x=Math.max(-6,Math.min(6,msg.x));
        return;
      case "finish":
        if (!p || this.state!=="playing" || p.fin!=null) return;
        p.fin=Math.max(20,Math.min(MAX_RACE_MS/1000,+msg.time||0)); p.d=this.dist; p.extra=Math.max(0,Math.min(99,msg.extra|0)); p.log=cleanLog(msg.log);      // trust the client (by design)
        this.send({ t:"fin", pid:p.pid, time:p.fin, place:[...this.players.values()].filter(q=>q.fin!=null).length });
        if (!this.endTimer) this.endTimer=setTimeout(()=>this.finish(),this.constructor.AFTER_FIRST||AFTER_FIRST_MS);
        this.checkAllDone(); return;
      case "leave": case "drop":
        if (!p) return;
        if (this.state==="playing" && msg.t==="drop") p.connected=false;
        else this.players.delete(p.pid);
        if (p.pid===this.teacher && msg.t==="leave") this.teacher=0;
        if (p.pid===this.host) this.pickHost();
        this.register(); this.lobby(); this.scheduleAuto(); this.checkEmpty();
        if (this.state==="playing") this.checkAllDone();
        return;
    }
  }
  pickHost(){ const n=[...this.players.values()].find(q=>q.connected); this.host=n?n.pid:0; }
  join({cid,name,token}){
    let p=token?[...this.players.values()].find(q=>q.token===token):null;
    if (p) Object.assign(p,{ cid,name,connected:true });
    else {
      if (this.players.size>=MAX_PLAYERS) return this.send({ t:"error", code:"full", msg:"That race is full (40 racers)." },cid);
      p={ pid:this.nextPid++, cid, name, token, connected:true, color:this.freeColor(), d:0, x:0, fin:null };
      this.players.set(p.pid,p);
      if (this.state==="playing"){ p.late=true; this.send({ t:"addp", p:{ pid:p.pid, name:p.name, color:p.color, connected:true } }); }   // joins mid-race from the start line
    }
    if (!this.host || !this.players.get(this.host)?.connected) this.host=p.pid;
    this.emptySince=0; this.saveSession(token);
    this.send({ t:"joined", code:this.code, game:this.kind, pid:p.pid },cid);
    this.register(); this.lobby(); this.scheduleAuto();
    if (this.teacher && p.pid!==this.teacher) this.askIdentity(p);
    if (this.state==="playing"){
      if (p.late && p.d===0){ p.late=false; this.send({ ...this.goMsg(), in:COUNTDOWN_MS },cid); }   // late joiner: their own 3-2-1, then race from 0
      else this.send({ ...this.goMsg(), in:this.startAt-Date.now(), you:{ d:p.d, x:p.x, fin:p.fin } },cid);   // rejoin mid-race
    }
  }
  racers(){ return [...this.players.values()].filter(p=>p.pid!==this.teacher); }
  scheduleAuto(){
    if (this.state!=="lobby" || this.teacher) return;
    if (this.isPublic){ if (this.autoAt){ clearTimeout(this.autoTimer); this.autoAt=0; this.lobby(); } if (this.connectedCount()>=this.max) this.startRace(); return; }   // public quick play: the host starts it, or it starts by itself once the lobby is full
    if (this.connectedCount()>=2){
      if (!this.autoAt){ this.autoAt=Date.now()+AUTO_START_MS; this.autoTimer=setTimeout(()=>this.startRace(),AUTO_START_MS); this.lobby(); }
    } else if (this.autoAt){ clearTimeout(this.autoTimer); this.autoAt=0; this.lobby(); }
  }
  liveRows(){
    return this.racers().map(p=>({ pid:p.pid, name:p.name, fin:p.fin, d:p.d }))
      .sort((a,b)=>(a.fin==null)-(b.fin==null) || (a.fin!=null?a.fin-b.fin:b.d-a.d))
      .map(r=>({ pid:r.pid, name:r.name, v:r.fin!=null?`🏁 ${Math.round(r.fin)}s`:`${Math.round(100*r.d/this.dist)}%` }));
  }
  goMsg(){ return { t:"go", seed:this.seed, dist:this.dist, digits:this.digits, mode:this.mode, teacher:this.teacher, players:this.roster().filter(p=>p.pid!==this.teacher) }; }
  startRace(){
    if (this.state!=="lobby" || this.racers().filter(p=>p.connected).length<MIN_PLAYERS) return;
    clearTimeout(this.autoTimer); this.autoAt=0;
    for (const p of this.players.values()) Object.assign(p,{ d:0, x:0, fin:null });
    this.seed=crypto.randomInt(1,2**31-1); this.startAt=Date.now()+COUNTDOWN_MS;
    this.state="playing"; this.register(); this.lobby();
    this.send({ ...this.goMsg(), in:COUNTDOWN_MS });
    this.relay=setInterval(()=>this.send({ t:"ps", p:this.racers().map(q=>[q.pid,Math.round(q.d*10)/10,Math.round(q.x*100)/100,q.fin!=null?1:0]) }),RELAY_MS);
    this.capTimer=setTimeout(()=>this.finish(),COUNTDOWN_MS+MAX_RACE_MS);
  }
  checkAllDone(){
    const frac=this.constructor.END_FRAC;            // Mathsketball: the round ends once this share of the class has finished
    if (frac){ const all=this.racers(), done=all.filter(p=>p.fin!=null).length; if (done && done>=Math.ceil(frac*all.length)) return this.finish(); }
    const racing=this.racers().filter(p=>p.connected&&p.fin==null);
    if (!racing.length && this.racers().some(p=>p.fin!=null)) this.finish();
    else if (!this.racers().length) this.finish();
  }
  finish(){
    if (this.state!=="playing") return;
    clearInterval(this.relay); clearTimeout(this.endTimer); clearTimeout(this.capTimer); this.endTimer=null;
    const rank=this.racers().map(p=>({ pid:p.pid, name:p.name, color:p.color, time:p.fin, d:p.d, extra:p.extra??null }))
      .sort((a,b)=>(a.time==null)-(b.time==null) || (a.time!=null ? a.time-b.time : b.d-a.d));
    this.send({ t:"results", rank, dist:this.dist });
    this.recordSession(this.mode,rank.map((e,i)=>({ pid:e.pid, place:i+1, score:e.time, stats:{ finished:e.time!=null, time:e.time, percent:Math.round(100*(e.d||0)/this.dist), extra:e.extra },
      log:this.players.get(e.pid)?.log||[] })),{ dist:this.dist });
    this.state="lobby";
    for (const [pid,p] of this.players) if (!p.connected) this.players.delete(pid);
    if (!this.players.get(this.host)) this.pickHost();
    this.register(); this.lobby(); this.scheduleAuto();
  }
}
// Rush Hour. Other client-driven races subclass this with their own KIND and DIST.
RushRoom.KIND="rush"; RushRoom.DIST=DIST;
module.exports={ RushRoom, MAX_PLAYERS };
