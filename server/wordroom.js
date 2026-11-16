// Word Rush room (live word search): up to 40 players, server-authoritative claims.
// start{} carries the whole board once; then each claim{a:[r0,c0,r1,c1]} that spells an unfound word
// is broadcast as f{i,pid,a,pts} so it shows on everyone's screen at once. Ends when every word is found (or 6 min).
"use strict";
const { RoomBase }=require("./roombase");
const WORDS=require("../shared/wordsearch.js");

const env=(k,d)=>+process.env[k]||d;
const MAX_PLAYERS=40, MIN_PLAYERS=1;
const AUTO_START_MS=env("WORDS_AUTO_MS",30000);
const COUNTDOWN_MS=env("WORDS_COUNTDOWN_MS",3000);

class WordRoom extends RoomBase {
  constructor(code, isPublic, bus, instanceId, onClose){
    super(code, isPublic, bus, instanceId, onClose, "words", MAX_PLAYERS);
    this.players=new Map(); this.nextPid=1; this.host=0; this.autoAt=0; this.game=null; this.timer=null;
  }
  humanCount(){ return this.players.size; }
  connectedCount(){ let n=0; for (const p of this.players.values()) if (p.connected) n++; return n; }
  canReconnect(){ for (const p of this.players.values()) if (!p.connected) return true; return false; }
  cleanup(){ clearInterval(this.timer); clearTimeout(this.autoTimer); clearTimeout(this.goTimer); }
  byCid(cid){ for (const p of this.players.values()) if (p.cid===cid) return p; return null; }
  freeColor(){ const used=new Set([...this.players.values()].filter(p=>p.pid!==this.teacher).map(p=>p.color)); for (let i=0;i<MAX_PLAYERS;i++) if (!used.has(i)) return i; return 0; }
  roster(){ return [...this.players.values()].map(p=>({ pid:p.pid, name:p.name, color:p.color, connected:p.connected })); }
  lobby(){
    return this.send({ t:"lobby", game:"words", code:this.code, pub:this.isPublic, state:this.state, max:MAX_PLAYERS,
      host:this.host, teacher:this.teacher, autoIn:this.autoAt?Math.max(0,this.autoAt-Date.now()):0, players:this.roster() });
  }
  handle(msg){
    const p=this.byCid(msg.cid);
    switch (msg.t){
      case "join": return this.join(msg);
      case "start": if (p && p.pid===this.host && this.state==="lobby") this.startGame(); return;
      case "teacher": this.makeTeacher(p,msg.acct); this.recolor(); return;
      case "iam": return this.handleIam(p,msg);
      case "claim": return this.claim(p,msg.a);
      case "words":                                                               // teacher's own word list (lobby only)
        if (!p || p.pid!==this.teacher || this.state!=="lobby") return;
        { const c=WORDS.cleanList(msg.text,msg.title); this.custom=c.words.length>=3?{ title:c.title, words:c.words }:null;
          this.send({ t:"wordsOk", n:this.custom?c.words.length:0, title:c.title, skipped:c.skipped },p.cid); }
        return;
      case "leave": case "drop":
        if (!p) return;
        if (this.state==="playing" && msg.t==="drop") p.connected=false;
        else this.players.delete(p.pid);
        if (p.pid===this.teacher && msg.t==="leave") this.teacher=0;
        if (p.pid===this.host) this.pickHost();
        this.register(); this.lobby(); this.scheduleAuto(); this.checkEmpty(); return;
    }
  }
  // the teacher never takes a colour, so students keep the most contrasting ones
  recolor(){ if (!this.teacher || this.state!=="lobby") return; let i=0; for (const p of this.players.values()) if (p.pid!==this.teacher) p.color=i++; this.lobby(); }
  pickHost(){ const n=[...this.players.values()].find(q=>q.connected); this.host=n?n.pid:0; }
  join({cid,name,token}){
    let p=token?[...this.players.values()].find(q=>q.token===token):null;
    if (p) Object.assign(p,{ cid,name,connected:true });
    else {
      if (this.players.size>=MAX_PLAYERS) return this.send({ t:"error", code:"full", msg:"That game is full (40 players)." },cid);
      p={ pid:this.nextPid++, cid, name, token, connected:true, color:this.freeColor(), last:0, n:0 };
      this.players.set(p.pid,p);
      if (this.state==="playing" && this.game){                                     // late joiner: into the running game from 0, or wait for the next one
        if (typeof this.game.addPlayer==="function"){ this.game.addPlayer({ id:p.pid, name }); this.send({ t:"addp", p:{ pid:p.pid, name, color:p.color, connected:true } }); }
        else p.wait=true;
      }
    }
    if (!this.host || !this.players.get(this.host)?.connected) this.host=p.pid;
    this.emptySince=0; this.saveSession(token);
    this.send({ t:"joined", code:this.code, game:"words", pid:p.pid },cid);
    this.register(); this.lobby(); this.scheduleAuto();
    if (this.teacher && p.pid!==this.teacher) this.askIdentity(p);
    if (this.state==="playing" && this.game && !p.wait) this.send(this.startMsg(0),cid);        // rejoin mid-game: board + everything found so far
  }
  scheduleAuto(){
    if (this.state!=="lobby" || this.teacher) return;
    if (this.connectedCount()>=2){
      if (!this.autoAt){ this.autoAt=Date.now()+AUTO_START_MS; this.autoTimer=setTimeout(()=>this.startGame(),AUTO_START_MS); this.lobby(); }
    } else if (this.autoAt){ clearTimeout(this.autoTimer); this.autoAt=0; this.lobby(); }
  }
  startMsg(inMs){
    const g=this.game, b=g.board;
    return { t:"start", players:this.roster().filter(p=>p.pid!==this.teacher), teacher:this.teacher, in:inMs,
      board:{ theme:b.theme, cols:b.cols, rows:b.rows, grid:b.grid, words:b.words.map(w=>w.w) }, found:g.foundList(),
      left:Math.max(0,WORDS.T.time-g.time) };
  }
  startGame(){
    if (this.state!=="lobby" || this.connectedCount()-(this.teacher?1:0)<MIN_PLAYERS) return;
    clearTimeout(this.autoTimer); this.autoAt=0;
    for (const q of this.players.values()) q.wait=false;
    this.state="playing"; this.register(); this.lobby();
    this.game=new WORDS.Game([...this.players.values()].filter(p=>p.pid!==this.teacher).map(p=>({ id:p.pid, name:p.name })),0,this.teacher?this.custom:null);
    this.send(this.startMsg(COUNTDOWN_MS));
    this.goAt=Date.now()+COUNTDOWN_MS;
    this.goTimer=setTimeout(()=>{ this.timer=setInterval(()=>this.tick(),250); },COUNTDOWN_MS);
  }
  claim(p,a){
    const g=this.game; if (!p || !g || p.pid===this.teacher || Date.now()<this.goAt) return;
    if (!Array.isArray(a) || a.length!==4) return;
    const now=Date.now(); if (now-p.last>1000){ p.last=now; p.n=0; } if (++p.n>6) return;   // at most 6 claims a second
    const i=g.claim(p.pid,a.map(v=>v|0));
    if (i<0) return this.send({ t:"miss", a },p.cid);                                     // beaten to it, or not a word
    this.flush();
  }
  flush(){
    for (const e of this.game.drainEvents()) if (e[0]==="found") this.send({ t:"f", i:e[1], pid:e[2], a:e[3], pts:e[4] });
    if (this.game.phase==="over") this.finish();
  }
  tick(){ const g=this.game; if (!g) return; g.step(0.25); this.flush(); }
  finish(){
    clearInterval(this.timer); this.timer=null;
    const rank=this.game.ranking().map(r=>({ ...r, pid:r.id, color:this.players.get(r.id)?.color??0 }));
    this.send({ t:"results", rank, total:this.game.board.words.length });
    this.recordSession(null,rank.map((e,i)=>({ pid:e.pid, place:i+1, score:e.score, stats:{ points:e.score, words:e.words, of:this.game.board.words.length } })));
    this.game=null; this.state="lobby";
    for (const [pid,p] of this.players) if (!p.connected) this.players.delete(pid);
    if (!this.players.get(this.host)) this.pickHost();
    this.register(); this.lobby(); this.scheduleAuto();
  }
}
module.exports={ WordRoom, MAX_PLAYERS };
