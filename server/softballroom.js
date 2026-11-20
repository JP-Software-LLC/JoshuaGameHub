// Softball Smarts room: same flow as Mathsketball (each browser plays its own game from a shared seed; the server relays
// progress ~10×/s and ranks finish times). pos.d = runs (0–goal), pos.x = phase (0 waiting · 1 pitch live).
// finish.extra = home runs. Host picks mode + digits + run goal (goal{goal}, 5–30) + pitch time (pitch{s}, 3–12 s).
"use strict";
const { RushRoom }=require("./rushroom");
const SB=require("../shared/softball.js");
class SoftballRoom extends RushRoom {
  constructor(...a){ super(...a); this.pitch=SB.T.pitch; }
  send(m,to){ if (m && m.t==="lobby"){ m.goal=this.dist; m.pitch=this.pitch; } return super.send(m,to); }
  goMsg(){ return { ...super.goMsg(), pitch:this.pitch }; }
  handle(msg){
    const p=msg.t==="goal"||msg.t==="pitch"?this.byCid(msg.cid):null, host=p && p.pid===this.host && this.state==="lobby";
    if (msg.t==="goal"){ const g=Math.round(+msg.goal); if (host && g>=SB.T.goalMin && g<=SB.T.goalMax){ this.dist=g; this.lobby(); } return; }
    if (msg.t==="pitch"){ const s=Math.round(+msg.s); if (host && s>=SB.T.pitchMin && s<=SB.T.pitchMax){ this.pitch=s; this.lobby(); } return; }
    return super.handle(msg);
  }
  liveRows(){
    return this.racers().map(p=>({ pid:p.pid, name:p.name, fin:p.fin, d:p.d }))
      .sort((a,b)=>(a.fin==null)-(b.fin==null) || (a.fin!=null?a.fin-b.fin:b.d-a.d))
      .map(r=>({ pid:r.pid, name:r.name, v:r.fin!=null?`🏆 ${Math.round(r.fin)}s`:`🥎 ${Math.round(r.d)}/${this.dist}` }));
  }
}
SoftballRoom.KIND="softball"; SoftballRoom.DIST=SB.T.runs; SoftballRoom.DIGITS=true; SoftballRoom.MODES=SB.MODES;
SoftballRoom.END_FRAC=SB.T.endFrac; SoftballRoom.AFTER_FIRST=+process.env.SOFTBALL_AFTER_FIRST_MS||10*60*1000;
module.exports={ SoftballRoom };
