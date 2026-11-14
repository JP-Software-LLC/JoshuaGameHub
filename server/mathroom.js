// Math Race room: up to 40 players, ROUNDS × 1 min rounds.
// The server never sees questions or answers. Each round it sends a seed; every client
// generates the same questions locally, checks answers locally, and reports one number
// (how many it got right) when its timer ends. The server just ranks those numbers.
"use strict";
const crypto=require("crypto");
const { RoomBase }=require("./roombase");
const cleanLog=l=>{ if (!Array.isArray(l)) return []; const out=l.slice(0,400).map(x=>{ const o={}; for (const [k,v] of Object.entries(x||{}).slice(0,8)) if (["string","number","boolean"].includes(typeof v)) o[k.slice(0,12)]=typeof v==="string"?v.slice(0,40):v; return o; }); return JSON.stringify(out).length<60000?out:[]; };


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
    super(code, isPublic, bus, instanceId, onClose, new.target.KIND, MAX_PLAYERS);
    this.rounds=new.target.ROUNDS; this.roundMs=new.target.ROUND_MS; this.maxScore=new.target.MAX_SCORE;
    this.players=new Map();   // pid -> {pid,cid,name,token,connected,scores:[]}
    this.nextPid=1; this.host=0; this.round=0; this.timer=null; this.autoAt=0;
    this.mode=new.target.MODES[0];   // question type, picked by the host (Math Race: add · sub · mul · div · money)
    this.teacher=0;                  // Teacher Mode: pid of a host who runs the room but does not play
  }
  humanCount(){ return this.players.size; }
  connectedCount(){ let n=0; for (const p of this.players.values()) if (p.connected) n++; return n; }
  canReconnect(){ for (const p of this.players.values()) if (!p.connected) return true; return false; }  // leavers are removed; only drops remain
  cleanup(){ clearTimeout(this.timer); clearTimeout(this.autoTimer); }
  byCid(cid){ for (const p of this.players.values()) if (p.cid===cid) return p; return null; }

  lobby(){
    return this.send({ t:"lobby", game:this.kind, code:this.code, pub:this.isPublic, state:this.state, max:MAX_PLAYERS, rounds:this.rounds, mode:this.mode, teacher:this.teacher,
      host:this.host, autoIn:this.autoAt?Math.max(0,this.autoAt-Date.now()):0,
      players:[...this.players.values()].map(p=>({ pid:p.pid, name:p.name, connected:p.connected })) });
  }
  handle(msg){
    const p=this.byCid(msg.cid);
    switch (msg.t){
      case "join": return this.join(msg);
      case "start": if (p && p.pid===this.host && this.state==="lobby") this.startGame(); return;
      case "mode":
        if (p && p.pid===this.host && this.state==="lobby" && this.constructor.MODES.includes(msg.mode)){ this.mode=msg.mode; this.lobby(); }
        return;
      case "teacher": return this.makeTeacher(p,msg.acct);
      case "iam": return this.handleIam(p,msg);
      case "score":
        // trust the client (by design): just keep it sane
        if (p && this.state==="playing" && msg.round===this.round && p.scores[this.round-1]==null)
          { p.scores[this.round-1]=Math.max(0,Math.min(this.maxScore,msg.n|0)); (p.logs||(p.logs=[]))[this.round-1]=cleanLog(msg.log); }
        return;
      case "leave": case "drop":
        if (!p) return;
        if (this.state==="playing" && msg.t==="drop") p.connected=false;   // keep their scores; they can reconnect
        else this.players.delete(p.pid);
        if (p.pid===this.teacher && msg.t==="leave") this.teacher=0;
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
    this.send({ t:"joined", code:this.code, game:this.kind, pid:p.pid },cid);
    this.register(); this.lobby(); this.scheduleAuto();
    if (this.teacher && p.pid!==this.teacher) this.askIdentity(p);
  }
  // start automatically AUTO_START_MS after the 2nd player arrives (public and private)
  scheduleAuto(){
    if (this.state!=="lobby" || this.teacher) return;          // in Teacher Mode the teacher decides when to start
    if (this.connectedCount()>=2){
      if (!this.autoAt){ this.autoAt=Date.now()+AUTO_START_MS; this.autoTimer=setTimeout(()=>this.startGame(),AUTO_START_MS); this.lobby(); }
    } else if (this.autoAt){ clearTimeout(this.autoTimer); this.autoAt=0; this.lobby(); }
  }
  startGame(){
    if (this.state!=="lobby" || this.connectedCount()-(this.teacher?1:0)<1) return;   // need at least one player; the teacher does not count
    clearTimeout(this.autoTimer); this.autoAt=0;
    for (const p of this.players.values()) p.scores=[];
    this.state="playing"; this.round=0; this.register(); this.lobby();
    this.nextRound();
  }
  nextRound(){
    this.round++;
    const seed=crypto.randomInt(1,2**31-1);
    this.send({ t:"round", n:this.round, of:this.rounds, seed, mode:this.mode, in:COUNTDOWN_MS, dur:this.roundMs });
    this.timer=setTimeout(()=>this.endRound(), COUNTDOWN_MS+this.roundMs+GRACE_MS);
  }
  ranking(score){
    return [...this.players.values()].filter(p=>p.pid!==this.teacher).map(p=>({ pid:p.pid, name:p.name, score:score(p) })).sort((a,b)=>b.score-a.score);
  }
  endRound(){
    const r=this.round-1;
    const rank=this.ranking(p=>p.scores[r]||0);
    const last=this.round>=this.rounds;
    if (last && this.rounds===1) return this.finish();                 // single-round games go straight to the final board
    this.send({ t:"results", n:this.round, of:this.rounds, rank, next:RESULTS_MS, last });
    this.timer=setTimeout(()=>last?this.finish():this.nextRound(), RESULTS_MS);
  }
  finish(){
    const rank=this.ranking(p=>p.scores.reduce((a,b)=>a+(b||0),0))
      .map(e=>({ ...e, rounds:this.players.get(e.pid).scores.map(s=>s||0) }));
    this.send({ t:"final", rank });
    let pl=0; this.recordSession(this.mode,rank.map((e,i)=>({ pid:e.pid, place:(i&&e.score===rank[i-1].score)?pl:(pl=i+1), score:e.score, stats:{ rounds:e.rounds },
      log:(this.players.get(e.pid).logs||[]).flatMap((l,ri)=>(l||[]).map(x=>({ r:ri+1, ...x }))) })),{ rounds:this.rounds });
    this.state="lobby"; this.round=0;
    for (const [pid,p] of this.players) if (!p.connected) this.players.delete(pid);   // release no-shows
    if (!this.players.get(this.host)) this.pickHost();
    this.register(); this.lobby(); this.scheduleAuto();
  }
}
// Math Race. Other "everyone plays locally, report one score" games subclass this.
MathRoom.KIND="math"; MathRoom.ROUNDS=ROUNDS; MathRoom.ROUND_MS=ROUND_MS; MathRoom.MAX_SCORE=300;
MathRoom.MODES=["add","sub","mul","div","money"];
module.exports={ MathRoom, MAX_PLAYERS, ROUNDS };
