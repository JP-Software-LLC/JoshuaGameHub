// Bumbling Stumbling Math room: same flow as Rush Hour / Hurdle Dash. Every browser runs its own 3D physics on a
// course built from the shared seed; the server NEVER simulates — it relays positions ~10×/s and ranks finish times.
// pos{d,x,y,a}: d = metres along the course, x = sideways (±T.halfWidth), y = height (±50), a = anim 0 idle · 1 run ·
// 2 air · 3 fallen · 4 diving · 5 solving a math veil. Relayed as ps{p:[[pid,d,x,fin,y,a],…]} (first 4 fields = RushRoom's). finish{time, extra=falls}.
// Ends when ceil(60 %) of the class has finished (END_FRAC), when the host/teacher sends end{}, or at the optional
// teacher time limit (limit{min}, min ∈ T.limits, 0 = off, the default). Hidden safety close at T.safetyMin minutes.
// Math veils: host picks the Math Race mode{mode} + digits{d} (RushRoom MODES/DIGITS) and qpv{n} (questions per veil,
// T.qpvMin..T.qpvMax, default T.qpv). Map picker: host sends map{id} (lobby only, id must be in STUMBLE_MAPS.PICKABLE;
// default STUMBLE_MAPS.DEFAULT); this.dist = that map's length (ps clamp, results, liveRows).
// lobby + go carry map, qpv, mode, digits. Questions are made in each browser (HOOPS.questionStream from the race seed).
"use strict";
const { RushRoom }=require("./rushroom");
const STUMBLE=require("../shared/stumble.js");
const MAPS=require("../shared/stumble-maps.js");
const HOOPS=require("../shared/hoops.js");
const T=STUMBLE.T;
const MINUTE_MS=+process.env.STUMBLE_MINUTE_MS||60*1000;      // tests shrink "a minute" to make the time limit quick
const COUNTDOWN_MS=+process.env.RUSH_COUNTDOWN_MS||3000;       // same countdown RushRoom uses
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

class StumbleRoom extends RushRoom {
  constructor(...a){ super(...a); this.limit=0; this.limitAt=0; this.limitTimer=null; this.qpv=T.qpv; this.setMap(MAPS.DEFAULT); }
  setMap(id){ const m=MAPS.get(id); this.map=m.id; this.dist=m.length; }
  send(m,to){ if (m && m.t==="lobby") Object.assign(m,{ limit:this.limit, qpv:this.qpv, map:this.map }); return super.send(m,to); }
  goMsg(){ return { ...super.goMsg(), map:this.map, qpv:this.qpv, limit:this.limit, endsIn:this.limitAt?Math.max(0,this.limitAt-Date.now()):0,
    raceMs:this.startAt?Date.now()-this.startAt:null }; }      // race clock (negative during the countdown) so late joiners see moving platforms in step
  takePos(p,msg){
    super.takePos(p,msg);
    if (Number.isFinite(msg.x)) p.x=clamp(msg.x,-T.halfWidth,T.halfWidth);
    if (Number.isFinite(msg.y)) p.y=clamp(msg.y,-50,50);
    if (Number.isFinite(msg.a)) p.a=clamp(Math.round(msg.a),0,5);
  }
  psRow(q){ return [...super.psRow(q),Math.round((q.y||0)*100)/100,q.a|0]; }
  startRace(){
    if (this.state!=="lobby") return;
    this.setMap(this.map);                                                     // dist = the picked map's length
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
    if (msg.t==="limit" || msg.t==="end" || msg.t==="qpv" || msg.t==="map"){
      const p=this.byCid(msg.cid), host=p && p.pid===this.host;
      if (msg.t==="map"){ if (host && this.state==="lobby" && MAPS.pickable && MAPS.pickable(msg.id)){ this.setMap(msg.id); this.lobby(); } return; }
      if (msg.t==="qpv"){ const n=+msg.n; if (host && this.state==="lobby" && Number.isInteger(n) && n>=T.qpvMin && n<=T.qpvMax){ this.qpv=n; this.lobby(); } return; }
      if (msg.t==="limit"){ const m=+msg.min; if (host && this.state==="lobby" && T.limits.includes(m)){ this.limit=m; this.lobby(); } return; }
      if (host && this.state==="playing") this.finish();
      return;
    }
    return super.handle(msg);
  }
}
StumbleRoom.KIND="stumble"; StumbleRoom.DIST=MAPS.get(MAPS.DEFAULT).length;
StumbleRoom.MODES=HOOPS.MODES; StumbleRoom.DIGITS=true;                     // Math Race question type + teacher digits
StumbleRoom.END_FRAC=T.endFrac;
StumbleRoom.MAX_MS=+process.env.STUMBLE_MAX_MS||T.safetyMin*60*1000;       // hidden safety close
StumbleRoom.AFTER_FIRST=StumbleRoom.MAX_MS;                                  // no default timer after the winner
StumbleRoom.MIN_TIME=5;                                                      // the course is short: don't round fast runs up to 20 s
module.exports={ StumbleRoom };
