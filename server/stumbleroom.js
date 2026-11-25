// Bumbling Stumbling Math room: same flow as Rush Hour / Hurdle Dash. Every browser runs its own 3D physics on a
// course built from the shared seed; the server NEVER simulates — it relays positions ~10×/s and ranks finish times.
// pos{d,x,y,a}: d = metres along the course, x = sideways (±T.halfWidth), y = height (±50), a = anim 0 idle · 1 run ·
// 2 air · 3 fallen. Relayed as ps{p:[[pid,d,x,fin,y,a],…]} (first 4 fields = RushRoom's). finish{time, extra=falls}.
// Ends when ceil(60 %) of the class has finished (END_FRAC), when the host/teacher sends end{}, or at the optional
// teacher time limit (limit{min}, min ∈ T.limits, 0 = off, the default). Hidden safety close at T.safetyMin minutes.
"use strict";
const { RushRoom }=require("./rushroom");
const STUMBLE=require("../shared/stumble.js");
const T=STUMBLE.T;
const MINUTE_MS=+process.env.STUMBLE_MINUTE_MS||60*1000;      // tests shrink "a minute" to make the time limit quick
const COUNTDOWN_MS=+process.env.RUSH_COUNTDOWN_MS||3000;       // same countdown RushRoom uses
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

class StumbleRoom extends RushRoom {
  constructor(...a){ super(...a); this.limit=0; this.limitAt=0; this.limitTimer=null; }
  send(m,to){ if (m && m.t==="lobby") m.limit=this.limit; return super.send(m,to); }
  goMsg(){ return { ...super.goMsg(), limit:this.limit, endsIn:this.limitAt?Math.max(0,this.limitAt-Date.now()):0,
    raceMs:this.startAt?Date.now()-this.startAt:null }; }      // race clock (negative during the countdown) so late joiners see moving platforms in step
  takePos(p,msg){
    super.takePos(p,msg);
    if (Number.isFinite(msg.x)) p.x=clamp(msg.x,-T.halfWidth,T.halfWidth);
    if (Number.isFinite(msg.y)) p.y=clamp(msg.y,-50,50);
    if (Number.isFinite(msg.a)) p.a=clamp(Math.round(msg.a),0,3);
  }
  psRow(q){ return [...super.psRow(q),Math.round((q.y||0)*100)/100,q.a|0]; }
  startRace(){
    if (this.state!=="lobby") return;
    for (const p of this.players.values()) Object.assign(p,{ y:0, a:0 });
    this.limitAt=this.limit?Date.now()+COUNTDOWN_MS+this.limit*MINUTE_MS:0;
    super.startRace();
    if (this.state!=="playing"){ this.limitAt=0; return; }
    if (this.limitAt) this.limitTimer=setTimeout(()=>this.finish(),this.limitAt-Date.now());
  }
  finish(){
    if (this.state!=="playing") return;
    clearTimeout(this.limitTimer); this.limitTimer=null; this.limitAt=0;
    return super.finish();
  }
  cleanup(){ clearTimeout(this.limitTimer); return super.cleanup(); }
  handle(msg){
    if (msg.t==="limit" || msg.t==="end"){
      const p=this.byCid(msg.cid), host=p && p.pid===this.host;
      if (msg.t==="limit"){ const m=+msg.min; if (host && this.state==="lobby" && T.limits.includes(m)){ this.limit=m; this.lobby(); } return; }
      if (host && this.state==="playing") this.finish();
      return;
    }
    return super.handle(msg);
  }
}
StumbleRoom.KIND="stumble"; StumbleRoom.DIST=T.dist; StumbleRoom.END_FRAC=T.endFrac;
StumbleRoom.MAX_MS=+process.env.STUMBLE_MAX_MS||T.safetyMin*60*1000;       // hidden safety close
StumbleRoom.AFTER_FIRST=StumbleRoom.MAX_MS;                                  // no default timer after the winner
StumbleRoom.MIN_TIME=5;                                                      // the course is short: don't round fast runs up to 20 s
module.exports={ StumbleRoom };
