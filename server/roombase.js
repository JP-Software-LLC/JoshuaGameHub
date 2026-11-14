// Shared room plumbing for every game type.
// A room is owned by exactly one game-server instance. It listens on cg:room:<CODE>:in
// (joins, inputs, drops from any instance) and publishes cg:room:<CODE>:out
// (`to` = a single connection, otherwise everyone in the room).
"use strict";

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
