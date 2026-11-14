// Math Race room: up to 40 players, ROUNDS × 1 min rounds.
// The server never sees questions or answers. Each round it sends a seed; every client
// generates the same questions locally, checks answers locally, and reports one number
// (how many it got right) when its timer ends. The server just ranks those numbers.
"use strict";
const crypto=require("crypto");
const { RoomBase }=require("./roombase");

const MAX_PLAYERS=40;
const ROUNDS=3;
const env=(k,d)=>+process.env[k]||d;   // overridable for tests
const COUNTDOWN_MS=env("MATH_COUNTDOWN_MS",3000);     // 3-2-1 before each round
const ROUND_MS=env("MATH_ROUND_MS",60000);        // answering time
const GRACE_MS=env("MATH_GRACE_MS",2500);         // wait for late score reports
const RESULTS_MS=env("MATH_RESULTS_MS",9000);       // round leaderboard on screen
const AUTO_START_MS=30000;   // any lobby starts on its own 30 s after a 2nd player joins (host can start sooner)

class MathRoom extends RoomBase {
  constructor(code, isPublic, bus, instanceId, onClose){
    super(code, isPublic, bus, instanceId, onClose, "math", MAX_PLAYERS);
    this.players=new Map();   // pid -> {pid,cid,name,token,connected,scores:[]}
    this.nextPid=1; this.host=0; this.round=0; this.timer=null; this.autoAt=0;
  }
  humanCount(){ return this.players.size; }
  connectedCount(){ let n=0; for (const p of this.players.values()) if (p.connected) n++; return n; }
  canReconnect(){ for (const p of this.players.values()) if (!p.connected) return true; return false; }  // leavers are removed; only drops remain
  cleanup(){ clearTimeout(this.timer); clearTimeout(this.autoTimer); }
  byCid(cid){ for (const p of this.players.values()) if (p.cid===cid) return p; return null; }

  lobby(){
    return this.send({ t:"lobby", game:"math", code:this.code, pub:this.isPublic, state:this.state, max:MAX_PLAYERS, rounds:ROUNDS,
      host:this.host, autoIn:this.autoAt?Math.max(0,this.autoAt-Date.now()):0,
      players:[...this.players.values()].map(p=>({ pid:p.pid, name:p.name, connected:p.connected })) });
  }
  handle(msg){
    const p=this.byCid(msg.cid);
    switch (msg.t){
      case "join": return this.join(msg);
      case "start": if (p && p.pid===this.host && this.state==="lobby") this.startGame(); return;
      case "score":
        // trust the client (by design): just keep it sane
        if (p && this.state==="playing" && msg.round===this.round && p.scores[this.round-1]==null)
          p.scores[this.round-1]=Math.max(0,Math.min(300,msg.n|0));
        return;
      case "leave": case "drop":
        if (!p) return;
        if (this.state==="playing" && msg.t==="drop") p.connected=false;   // keep their scores; they can reconnect
        else this.players.delete(p.pid);
        if (p.pid===this.host) this.pickHost();
        this.register(); this.lobby(); this.scheduleAuto(); this.checkEmpty(); return;
    }
  }
  pickHost(){ const next=[...this.players.values()].find(q=>q.connected); this.host=next?next.pid:0; }
  join({cid,name,token}){
    let p=token?[...this.players.values()].find(q=>q.token===token):null;
    if (p) Object.assign(p,{ cid,name,connected:true });
    else {
      if (this.players.size>=MAX_PLAYERS) return this.send({ t:"error", code:"full", msg:"That room is full (40 players)." },cid);
      if (this.state!=="lobby") return this.send({ t:"error", code:"full", msg:"That race has already started." },cid);
      p={ pid:this.nextPid++, cid, name, token, connected:true, scores:[] };
      this.players.set(p.pid,p);
    }
    if (!this.host || !this.players.get(this.host)?.connected) this.host=p.pid;
    this.emptySince=0;
    this.saveSession(token);
    this.send({ t:"joined", code:this.code, game:"math", pid:p.pid },cid);
    this.register(); this.lobby(); this.scheduleAuto();
  }
  // start automatically AUTO_START_MS after the 2nd player arrives (public and private)
  scheduleAuto(){
    if (this.state!=="lobby") return;
    if (this.connectedCount()>=2){
      if (!this.autoAt){ this.autoAt=Date.now()+AUTO_START_MS; this.autoTimer=setTimeout(()=>this.startGame(),AUTO_START_MS); this.lobby(); }
    } else if (this.autoAt){ clearTimeout(this.autoTimer); this.autoAt=0; this.lobby(); }
  }
  startGame(){
    if (this.state!=="lobby" || !this.connectedCount()) return;
    clearTimeout(this.autoTimer); this.autoAt=0;
    for (const p of this.players.values()) p.scores=[];
    this.state="playing"; this.round=0; this.register(); this.lobby();
    this.nextRound();
  }
  nextRound(){
    this.round++;
    const seed=crypto.randomInt(1,2**31-1);
    this.send({ t:"round", n:this.round, of:ROUNDS, seed, in:COUNTDOWN_MS, dur:ROUND_MS });
    this.timer=setTimeout(()=>this.endRound(), COUNTDOWN_MS+ROUND_MS+GRACE_MS);
  }
  ranking(score){
    return [...this.players.values()].map(p=>({ pid:p.pid, name:p.name, score:score(p) })).sort((a,b)=>b.score-a.score);
  }
  endRound(){
    const r=this.round-1;
    const rank=this.ranking(p=>p.scores[r]||0);
    const last=this.round>=ROUNDS;
    this.send({ t:"results", n:this.round, of:ROUNDS, rank, next:RESULTS_MS, last });
    this.timer=setTimeout(()=>last?this.finish():this.nextRound(), RESULTS_MS);
  }
  finish(){
    const rank=this.ranking(p=>p.scores.reduce((a,b)=>a+(b||0),0))
      .map(e=>({ ...e, rounds:this.players.get(e.pid).scores.map(s=>s||0) }));
    this.send({ t:"final", rank });
    this.state="lobby"; this.round=0;
    for (const [pid,p] of this.players) if (!p.connected) this.players.delete(pid);   // release no-shows
    if (!this.players.get(this.host)) this.pickHost();
    this.register(); this.lobby(); this.scheduleAuto();
  }
}
module.exports={ MathRoom, MAX_PLAYERS, ROUNDS };
