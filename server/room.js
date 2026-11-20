// Clean Getaway room: up to 5 humans (bots fill the rest), authoritative sim at 30 Hz.
"use strict";
const CG=require("../shared/sim.js");
const { RoomBase }=require("./roombase");

const TICK_HZ=30;                 // sim + snapshot rate

class Room extends RoomBase {
  constructor(code, isPublic, bus, instanceId, onClose){
    super(code, isPublic, bus, instanceId, onClose, "cg", 5);
    this.slots=[null,null,null,null];   // {cid,name,token,ready,connected}
    this.game=null; this.timer=null;
  }
  humans(){ return this.slots.filter(Boolean); }
  connected(){ return this.slots.filter(s=>s&&s.connected); }
  humanCount(){ return this.humans().length; }
  connectedCount(){ return this.connected().length; }
  canReconnect(){ return this.slots.some(s=>s&&!s.connected&&s.token); }   // dropped, not left
  cleanup(){ clearInterval(this.timer); }
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
      if (slot<0) return this.send({ t:"error", code:"full", msg:"That room is full." },cid);      // mid-game: an empty seat is a bot, the newcomer takes it over
      this.slots[slot]={ cid,name,token,ready:false,connected:true };
    } else Object.assign(this.slots[slot],{ cid,name,connected:true });
    this.emptySince=0;
    this.saveSession(token);
    this.send({ t:"joined", code:this.code, game:"cg", slot },cid);
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
}
module.exports={ Room, TICK_HZ };
