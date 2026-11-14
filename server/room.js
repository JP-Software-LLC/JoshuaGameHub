// A room is owned by exactly one game-server instance, which runs the authoritative sim.
// It listens on  cg:room:<CODE>:in   (joins, ready, inputs, drops from any instance)
// and publishes  cg:room:<CODE>:out  (lobby state, floors, snapshots; `to` = one connection).
"use strict";
const CG=require("../shared/sim.js");

const TICK_HZ=30;                 // sim + snapshot rate
const ROOM_TTL=60;                // registry key expiry, refreshed while the room lives
const EMPTY_GRACE_MS=45000;       // keep a room with no connected humans this long (reconnects)
const K={ room:c=>`cg:room:${c}`, open:"cg:open", in:c=>`cg:room:${c}:in`, out:c=>`cg:room:${c}:out`, sess:t=>`cg:sess:${t}` };

class Room {
  constructor(code, isPublic, bus, instanceId, onClose){
    Object.assign(this,{ code, isPublic, bus, instanceId, onClose });
    this.slots=[null,null,null,null];   // {cid,name,token,ready,connected}
    this.state="lobby"; this.game=null; this.timer=null; this.emptySince=Date.now();
    this.onIn=m=>this.handle(m);
  }
  async open(){
    await this.bus.subscribe(K.in(this.code), this.onIn);
    await this.register();
    this.keepAlive=setInterval(()=>{ this.register(); this.checkEmpty(); }, 5000);
  }
  humans(){ return this.slots.filter(Boolean); }
  connected(){ return this.slots.filter(s=>s&&s.connected); }
  async register(){
    const humans=this.humans().length;
    await this.bus.set(K.room(this.code),{ owner:this.instanceId, pub:this.isPublic, state:this.state, humans }, ROOM_TTL);
    if (this.isPublic && this.state==="lobby" && humans<4) await this.bus.sadd(K.open,this.code);
    else await this.bus.srem(K.open,this.code);
  }
  send(m,to){ return this.bus.publish(K.out(this.code), to?{to,m}:{m}); }
  lobby(){
    return this.send({ t:"lobby", code:this.code, pub:this.isPublic, state:this.state,
      slots:this.slots.map(s=>s&&{ name:s.name, ready:s.ready, connected:s.connected }) });
  }
  handle(msg){
    const slot=this.slots.findIndex(s=>s&&s.cid===msg.cid);
    switch (msg.t){
      case "join": return this.join(msg);
      case "ready":
        if (slot<0||this.state!=="lobby") return;
        this.slots[slot].ready=!!msg.v; this.lobby(); this.maybeStart(); return;
      case "input": {
        if (slot<0||this.state!=="playing") return;
        const d=CG.DIRS[msg.d]; if (d) this.game.setWant(slot,d); return; }
      case "leave": case "drop":
        if (slot<0) return;
        if (this.state==="playing"){
          this.slots[slot].connected=false;
          this.game.players[slot].bot=true;            // bot takes over until they reconnect
          if (msg.t==="leave") this.slots[slot].token=null;
        } else this.slots[slot]=null;
        this.register(); this.lobby(); this.maybeStart(); this.checkEmpty(); return;
    }
  }
  join({cid,name,token}){
    // reconnect: same token gets the same slot back
    let slot=token?this.slots.findIndex(s=>s&&s.token===token):-1;
    if (slot<0){
      slot=this.slots.findIndex(s=>!s);
      if (slot<0||this.state!=="lobby") return this.send({ t:"error", code:"full", msg:"That room is full or already playing." },cid);
      this.slots[slot]={ cid,name,token,ready:false,connected:true };
    } else Object.assign(this.slots[slot],{ cid,name,connected:true });
    this.emptySince=0;
    if (token) this.bus.set(K.sess(token),{ code:this.code },3*3600);
    this.send({ t:"joined", code:this.code, slot },cid);
    if (this.state==="playing"){
      this.game.players[slot].bot=false;
      this.game.players[slot].name=name;
      this.send(this.startMsg(),cid);
      this.send(this.floorMsg(),cid);
    }
    this.register(); this.lobby();
  }
  maybeStart(){
    const h=this.humans();
    if (this.state!=="lobby"||!h.length||!h.every(s=>s.ready)) return;
    const bots=CG.BOT_NAMES.slice().sort(()=>Math.random()-0.5);
    this.game=new CG.Game(this.slots.map((s,i)=>({ id:i, name:s?s.name:bots[i], bot:!s })));
    this.game.start();
    this.state="playing"; this.register();
    this.send(this.startMsg());
    this.flushEvents();
    this.timer=setInterval(()=>this.tick(),1000/TICK_HZ);
  }
  startMsg(){ return { t:"start", players:this.game.players.map(p=>({ id:p.id, name:p.name })), tick:TICK_HZ }; }
  floorMsg(){ return { t:"floor", grid:this.game.grid.map(r=>r.join("")), theme:this.game.themeIdx, stage:this.game.stage }; }
  flushEvents(){
    const evs=this.game.drainEvents();
    // a new floor must reach clients before the snapshot that refers to it
    if (evs.some(e=>e.type==="floor")) this.send(this.floorMsg());
    this.send({ t:"s", s:this.game.snapshot(), e:evs.filter(e=>e.type!=="floor") });
    return evs;
  }
  tick(){
    this.game.update(1/TICK_HZ);
    const evs=this.flushEvents();
    if (evs.some(e=>e.type==="results")) this.endGame();
  }
  endGame(){
    clearInterval(this.timer); this.timer=null;
    this.state="lobby";
    this.slots=this.slots.map(s=>s&&s.connected?Object.assign(s,{ready:false}):null); // disconnected players are released
    this.register(); this.lobby();
  }
  checkEmpty(){
    if (this.connected().length){ this.emptySince=0; return; }
    if (!this.emptySince) this.emptySince=Date.now();
    if (this.state==="lobby"||Date.now()-this.emptySince>EMPTY_GRACE_MS) this.close();
  }
  async close(){
    if (this.closed) return; this.closed=true;
    clearInterval(this.timer); clearInterval(this.keepAlive);
    await this.bus.unsubscribe(K.in(this.code),this.onIn);
    await this.bus.srem(K.open,this.code); await this.bus.del(K.room(this.code));
    this.onClose(this.code);
  }
}
module.exports={ Room, K, TICK_HZ };
