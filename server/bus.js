// Message bus + small key/value store shared by game-server instances.
// RedisBus when REDIS_URL is set (Railway), MemoryBus otherwise (local dev / single process).
// Every lobby and game message goes through the bus, even on one instance, so adding
// replicas later needs no code changes.
"use strict";

class MemoryBus {
  constructor(){ this.subs=new Map(); this.kv=new Map(); this.sets=new Map(); this.kind="memory"; }
  async publish(ch,msg){ const s=JSON.stringify(msg); queueMicrotask(()=>{ for (const fn of this.subs.get(ch)||[]) fn(JSON.parse(s)); }); }
  async subscribe(ch,fn){ if(!this.subs.has(ch)) this.subs.set(ch,new Set()); this.subs.get(ch).add(fn); }
  async unsubscribe(ch,fn){ const s=this.subs.get(ch); if(!s) return; s.delete(fn); if(!s.size) this.subs.delete(ch); }
  async set(k,v,ttl){ this.kv.set(k,{v,exp:ttl?Date.now()+ttl*1000:0}); }
  async get(k){ const e=this.kv.get(k); if(!e) return null; if(e.exp&&e.exp<Date.now()){ this.kv.delete(k); return null; } return e.v; }
  async del(k){ this.kv.delete(k); }
  async sadd(k,m){ if(!this.sets.has(k)) this.sets.set(k,new Set()); this.sets.get(k).add(m); }
  async srem(k,m){ this.sets.get(k)?.delete(m); }
  async smembers(k){ return [...(this.sets.get(k)||[])]; }
  async ping(){ return true; }
}

class RedisBus {
  constructor(url){
    const Redis=require("ioredis");
    // family:0 → resolve IPv6 too; Railway private networking (redis.railway.internal) is IPv6.
    const opts={ family:0, maxRetriesPerRequest:3, lazyConnect:false };
    this.pub=new Redis(url,opts); this.sub=new Redis(url,opts); this.subs=new Map(); this.kind="redis";
    for (const c of [this.pub,this.sub]) c.on("error",e=>console.error("[redis]",e.message));
    this.sub.on("message",(ch,raw)=>{ const s=this.subs.get(ch); if(!s) return; let m; try{ m=JSON.parse(raw);}catch{return;} for (const fn of s) fn(m); });
  }
  async publish(ch,msg){ await this.pub.publish(ch,JSON.stringify(msg)); }
  async subscribe(ch,fn){ if(!this.subs.has(ch)){ this.subs.set(ch,new Set()); await this.sub.subscribe(ch); } this.subs.get(ch).add(fn); }
  async unsubscribe(ch,fn){ const s=this.subs.get(ch); if(!s) return; s.delete(fn); if(!s.size){ this.subs.delete(ch); await this.sub.unsubscribe(ch); } }
  async set(k,v,ttl){ const s=JSON.stringify(v); if (ttl) await this.pub.set(k,s,"EX",ttl); else await this.pub.set(k,s); }
  async get(k){ const s=await this.pub.get(k); return s==null?null:JSON.parse(s); }
  async del(k){ await this.pub.del(k); }
  async sadd(k,m){ await this.pub.sadd(k,m); }
  async srem(k,m){ await this.pub.srem(k,m); }
  async smembers(k){ return this.pub.smembers(k); }
  async ping(){ return (await this.pub.ping())==="PONG"; }
}

function createBus(){
  const url=process.env.REDIS_URL;
  if (url){ console.log("[bus] using Redis"); return new RedisBus(url); }
  console.log("[bus] REDIS_URL not set: using in-memory bus (single process only)");
  return new MemoryBus();
}
module.exports={ createBus, MemoryBus };
