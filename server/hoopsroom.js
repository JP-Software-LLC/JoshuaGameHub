// Mathsketball room: same flow as Rush Hour (each browser plays its own game from a shared seed; the server relays
// progress ~10×/s and ranks finish times). pos.d = baskets made (0–10), pos.x = phase (0 quiz · 1 shooting).
// finish.extra = shots taken. Host picks the Math Race mode + digits. The round ends for everyone once 60 % of
// the class has made 10 baskets (END_FRAC), or at the 6-minute cap.
"use strict";
const { RushRoom }=require("./rushroom");
const HOOPS=require("../shared/hoops.js");
class HoopsRoom extends RushRoom {
  send(m,to){ if (m && m.t==="lobby") m.goal=this.dist; return super.send(m,to); }
  handle(msg){
    if (msg.t==="goal"){                                         // host picks how many baskets finish (6–50), lobby only
      const p=this.byCid(msg.cid), g=Math.round(+msg.goal);
      if (p && p.pid===this.host && this.state==="lobby" && g>=HOOPS.T.goalMin && g<=HOOPS.T.goalMax){ this.dist=g; this.lobby(); }
      return;
    }
    return super.handle(msg);
  }
  liveRows(){
    return this.racers().map(p=>({ pid:p.pid, name:p.name, fin:p.fin, d:p.d }))
      .sort((a,b)=>(a.fin==null)-(b.fin==null) || (a.fin!=null?a.fin-b.fin:b.d-a.d))
      .map(r=>({ pid:r.pid, name:r.name, v:r.fin!=null?`🏆 ${Math.round(r.fin)}s`:`🏀 ${Math.round(r.d)}/${this.dist}` }));
  }
}
HoopsRoom.KIND="hoops"; HoopsRoom.DIST=HOOPS.T.baskets; HoopsRoom.DIGITS=true; HoopsRoom.MODES=HOOPS.MODES;
HoopsRoom.END_FRAC=HOOPS.T.endFrac; HoopsRoom.AFTER_FIRST=+process.env.HOOPS_AFTER_FIRST_MS||10*60*1000;
module.exports={ HoopsRoom };
