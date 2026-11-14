// Shared room plumbing for every game type.
// A room is owned by exactly one game-server instance. It listens on cg:room:<CODE>:in
// (joins, inputs, drops from any instance) and publishes cg:room:<CODE>:out
// (`to` = a single connection, otherwise everyone in the room).
"use strict";
const crypto=require("crypto");
const CD=require("./classdata");

const ROOM_TTL=60;              // registry key expiry, refreshed while the room lives
const EMPTY_GRACE_MS=45000;     // keep a mid-game room with nobody connected this long (reconnects)
const K={
  room:c=>`cg:room:${c}`, open:kind=>`cg:open:${kind}`,
  in:c=>`cg:room:${c}:in`, out:c=>`cg:room:${c}:out`, sess:t=>`cg:sess:${t}`,
};

class RoomBase {
  constructor(code, isPublic, bus, instanceId, onClose, kind, max){
    Object.assign(this,{ code, isPublic, bus, instanceId, onClose, kind, max });
    this.state="lobby"; this.emptySince=Date.now(); this.closed=false;
    this.teacher=0;          // Teacher Mode: pid of a private room's host who runs it without playing
    this.onIn=m=>{ try{ this.handle(m); }catch(e){ console.error(`[${kind}:${code}]`,e); } };
  }
  // subclasses implement: handle(msg), humanCount(), connectedCount(), canReconnect(), cleanup()
  async open(){
    await this.bus.subscribe(K.in(this.code), this.onIn);
    await this.register();
    this.keepAlive=setInterval(()=>{ this.register(); this.checkEmpty(); }, 5000);
  }
  async register(){
    if (this.closed) return;
    const humans=this.humanCount();
    await this.bus.set(K.room(this.code),{ owner:this.instanceId, kind:this.kind, pub:this.isPublic, state:this.state, humans, max:this.max }, ROOM_TTL);
    if (this.isPublic && this.state==="lobby" && humans<this.max) await this.bus.sadd(K.open(this.kind),this.code);
    else await this.bus.srem(K.open(this.kind),this.code);
  }
  // Teacher Mode (all 40-player games): the host of a private room can run it without playing.
  // The teacher is left out of the game, the rankings and the player counts, and auto-start is off.
  makeTeacher(p,acct){
    if (!p || p.pid!==this.host || this.state!=="lobby" || this.isPublic) return;
    this.teacher=p.pid; clearTimeout(this.autoTimer); this.autoAt=0;
    this.teacherAcct={ teacherId:acct&&acct.teacherId||null, classId:acct&&acct.classId||null };   // signed-in teacher + class, if any
    this.startedAt=Date.now();
    for (const q of this.players.values()) if (q.pid!==this.teacher && !q.student) this.askIdentity(q);
    this.lobby();
  }
  // ---- students in a teacher's room: first name + last initial + nickname (classmates only see the nickname)
  async askIdentity(p){
    if (!this.teacher || p.pid===this.teacher || p.student) return;
    let known=null;
    try{ known=await CD.knownStudent(this.teacherAcct&&this.teacherAcct.classId, p.token); }catch(e){ console.error("[identity]",e.message); }
    this.send({ t:"whoareyou", known },p.cid);
  }
  handleIam(p,msg){
    if (!p || !this.teacher || p.pid===this.teacher) return;
    const st=CD.cleanStudent(msg); if (!st) return this.send({ t:"whoareyou", known:null, error:"Please type your first name." },p.cid);
    p.student=st; p.name=st.nick;
    this.send({ t:"iamok", student:st },p.cid);
    this.lobby();
  }
  // rows: [{ pid, place, score, stats, log }] → saved to the teacher's class, or held 24 h for "See class results"
  async recordSession(mode,rows,summary={}){
    if (!this.teacher) return;
    const teacher=this.players.get(this.teacher);
    const rec={ game:this.kind, mode:mode||null, code:this.code, startedAt:this.startedAt||Date.now(), endedAt:Date.now(), summary,
      results:rows.map(r=>{ const p=this.players.get(r.pid)||{}; return { student:p.student||{ first:p.name||"Student", last:"", nick:p.name||"" },
        device:p.token||null, place:r.place, score:r.score, stats:r.stats||{}, log:Array.isArray(r.log)?r.log.slice(0,400):[] }; }) };
    if (!rec.results.length || !teacher) return;
    try{
      const a=this.teacherAcct||{};
      if (a.teacherId && a.classId){ const id=await CD.saveSession(a.classId,a.teacherId,rec); this.send({ t:"classresults", sessionId:id },teacher.cid); return; }
      const claim=crypto.randomBytes(18).toString("base64url");
      await this.bus.set(`cg:pending:${claim}`,rec,24*3600);
      this.send({ t:"classresults", claim },teacher.cid);
    }catch(e){ console.error("[results]",e); }
    this.startedAt=Date.now();
  }
  send(m,to){ return this.bus.publish(K.out(this.code), to?{to,m}:{m}); }
  saveSession(token){ if (token) this.bus.set(K.sess(token),{ code:this.code },3*3600); }
  // Close as soon as nobody is connected, unless someone only DROPPED (lost connection) mid-game
  // and may reconnect: then wait EMPTY_GRACE_MS. Explicit leaves never hold a room open.
  checkEmpty(){
    if (this.connectedCount()){ this.emptySince=0; return; }
    if (!this.emptySince) this.emptySince=Date.now();
    if (this.state==="lobby" || !this.canReconnect() || Date.now()-this.emptySince>EMPTY_GRACE_MS) this.close();
  }
  async close(){
    if (this.closed) return; this.closed=true;
    clearInterval(this.keepAlive); this.cleanup();
    await this.bus.unsubscribe(K.in(this.code),this.onIn);
    await this.bus.srem(K.open(this.kind),this.code); await this.bus.del(K.room(this.code));
    this.onClose(this.code);
  }
}
module.exports={ RoomBase, K };
