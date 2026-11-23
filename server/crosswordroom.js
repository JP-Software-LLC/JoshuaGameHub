// Vocab Crossword room: same flow as Mathsketball (each browser solves its own copy of ONE shared crossword;
// the server relays progress ~10×/s and ranks finish times). pos.d = words solved, finish{time, extra=hints used}.
// The host / teacher sends their vocab list in the lobby as xw{title, w:[[word,clue],…]} (clues looked up in the
// teacher's browser, then edited). Without one, a built-in kid-friendly puzzle is picked at start.
// The puzzle (with answers) goes out in `go`: checking is client-side by design, like every race here.
// Host / teacher can end the game early with end{}. Unfinished players are ranked by words solved.
"use strict";
const { RushRoom }=require("./rushroom");
const XW=require("../shared/crossword.js");
class CrosswordRoom extends RushRoom {
  constructor(...a){ super(...a); this.custom=null; this.puzzle=null; }
  send(m,to){ if (m && m.t==="lobby") m.xw=this.custom?{ title:this.custom.title, n:this.custom.w.length }:null; return super.send(m,to); }
  goMsg(){ return { ...super.goMsg(), xw:this.puzzle }; }
  startRace(){
    if (this.state!=="lobby") return;
    this.puzzle=this.custom||XW.PUZZLES[Math.random()*XW.PUZZLES.length|0];
    this.dist=this.puzzle.w.length;
    return super.startRace();
  }
  handle(msg){
    const p=msg.t==="xw"||msg.t==="end"?this.byCid(msg.cid):null, host=p && p.pid===this.host;
    if (msg.t==="xw"){
      if (!host || this.state!=="lobby") return;
      this.custom=msg.clear?null:XW.cleanPuzzle(msg.xw);
      this.send({ t:"xwOk", n:this.custom?this.custom.w.length:0, title:this.custom?.title||"" },p.cid); this.lobby(); return;
    }
    if (msg.t==="end"){ if (host && this.state==="playing") this.finish(); return; }
    return super.handle(msg);
  }
  liveRows(){
    return this.racers().map(p=>({ pid:p.pid, name:p.name, fin:p.fin, d:p.d }))
      .sort((a,b)=>(a.fin==null)-(b.fin==null) || (a.fin!=null?a.fin-b.fin:b.d-a.d))
      .map(r=>({ pid:r.pid, name:r.name, v:r.fin!=null?`🏆 ${Math.round(r.fin)}s`:`✏️ ${Math.round(r.d)}/${this.dist}` }));
  }
}
CrosswordRoom.KIND="crossword"; CrosswordRoom.DIST=10;
CrosswordRoom.AFTER_FIRST=+process.env.XW_AFTER_FIRST_MS||15*60*1000;     // nobody is rushed: everyone gets to finish
CrosswordRoom.MAX_MS=+process.env.XW_MAX_MS||25*60*1000;
module.exports={ CrosswordRoom };
