// Game server entry (Railway "game"): WebSocket gateway + room host.
// Also serves the client at / so `npm run dev` is a complete one-process setup.
//
// Client → server:  hello{name,token?} quick{game} create{game} join{code} leave{}
//   Clean Getaway:   ready{v} input{d}        Math Race: start{} score{round,n}
//   Rush Hour:       start{} pos{d,x} (~10/s) finish{time}
//   Bear Attack!:    start{} in{x,y} (stick direction, on change)
//   Math Race extras: mode{mode} (host, lobby) · teacher{} (private host becomes a non-playing teacher)
//   Memory Tiles:    start{} tile{dx,dy} (server replies me{x,y} only to you)
//   Arrow Blitz:     start{} score{round:1,n}   (Math Race room, one round)
//   Hurdle Dash:     start{} pos{d,x=state} finish{time,extra=clean jumps}
//   Typing Cowboys:  start{} pos{d=words,x=0} finish{time,extra=words missed}
//   Star Cannons:    start{} in{x=-1|0|1} (move direction, on change)
//   Dart Party:      start{} in{x,y} (move stick, on change) fire{}
//   Sky Climb:       start{} in{x=-1|0|1} (steer, on change) fire{} (flap)
//   Teacher Mode:    digits{d="1"|"12"|"2"} (Math Race, Hurdle Dash) · prog{round,n} (live score) · start{} twice = skip the 10 s countdown
//                    server sends board{code,rows:[{pid,name,v}]} each second while playing; lobby carries closeIn + pending players
// Server → client:  welcome{token,name} joined{code,slot} lobby{...} start{players,tick}
//                   floor{grid,theme} s{s:snapshot,e:events} error{code,msg}
"use strict";
const http=require("http"), crypto=require("crypto");
const { WebSocketServer }=require("ws");
const { createBus }=require("./bus");
const { Room }=require("./room");
const { MathRoom }=require("./mathroom");
const { RushRoom }=require("./rushroom");
const { BearRoom }=require("./bearroom");
const { HurdleRoom }=require("./hurdleroom");
const { ArrowRoom }=require("./arrowroom");
const { MemoryRoom }=require("./memoryroom");
const { TypingRoom }=require("./typingroom");
const { CannonRoom }=require("./cannonroom");
const { DartRoom }=require("./dartroom");
const { SkyRoom }=require("./skyroom");
const { WordRoom }=require("./wordroom");
const { K }=require("./roombase");
const KINDS={ cg:Room, math:MathRoom, rush:RushRoom, bear:BearRoom, hurdle:HurdleRoom, arrows:ArrowRoom, memory:MemoryRoom, typing:TypingRoom, cannons:CannonRoom, darts:DartRoom, sky:SkyRoom, words:WordRoom };          // game id -> room class
const { serveStatic }=require("./static");

const PORT=process.env.PORT||8080;
const INSTANCE=process.env.RAILWAY_REPLICA_ID||crypto.randomUUID();
const MAX_CONN=+process.env.MAX_CONNECTIONS||200;
const bus=createBus();
const rooms=new Map();           // rooms OWNED by this instance
const relays=new Map();          // code -> {conns:Set, fn}  (out-channel subscriptions on this instance)
const conns=new Set();

const id=n=>crypto.randomBytes(n).toString("base64url");
const { CODE_CHARS, codeOK }=require("./codes");
const { makeApi }=require("./api");
const AUTH=require("./auth");
const CD=require("./classdata");
const DB=require("./db");
const STATS=require("./stats");      // kid-safe room codes
const cleanName=s=>String(s||"").replace(/[^\p{L}\p{N} _.\-!?']/gu,"").trim().slice(0,14)||"Player";
const cleanCode=s=>String(s||"").toUpperCase().replace(/[^A-Z]/g,"").slice(0,4);

async function createRoom(isPublic,kind,fixed){
  const Cls=KINDS[kind]||Room;
  let code=fixed;
  if (!code) for (let i=0;i<200;i++){ code=Array.from({length:4},()=>CODE_CHARS[Math.random()*CODE_CHARS.length|0]).join(""); if (codeOK(code) && !await bus.get(K.room(code))) break; }
  const r=new Cls(code,isPublic,bus,INSTANCE,c=>rooms.delete(c));
  rooms.set(code,r); await r.open();
  return code;
}
async function findPublic(kind){
  for (const code of await bus.smembers(K.open(kind))){
    const r=await bus.get(K.room(code));
    if (!r){ await bus.srem(K.open(kind),code); continue; }
    if (r.state==="lobby" && r.humans<(r.max||4)) return code;
  }
  return createRoom(true,kind);
}

// ---- relay: one out-channel subscription per room per instance, fanned out to local sockets
async function attach(c,code){
  if (c.code===code) return;
  await detach(c);
  c.code=code;
  let r=relays.get(code);
  if (!r){
    r={ conns:new Set(), fn:({to,m})=>{ const s=JSON.stringify(m); for (const x of r.conns) if (!to||to===x.id) x.send(s); } };
    relays.set(code,r); await bus.subscribe(K.out(code),r.fn);
  }
  r.conns.add(c);
}
async function detach(c){
  const code=c.code; if (!code) return; c.code=null;
  const r=relays.get(code); if (!r) return;
  r.conns.delete(c);
  if (!r.conns.size){ relays.delete(code); await bus.unsubscribe(K.out(code),r.fn); }
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function joinRoom(c,code){
  code=cleanCode(code);
  // a teacher is moving this lobby to another game: wait (≤ 15 s) for the new room to open under the same code
  if (code && !await bus.get(K.room(code)) && await bus.get(K.move(code))) for (let i=0;i<60 && !await bus.get(K.room(code));i++) await wait(250);
  if (!code || !await bus.get(K.room(code))) return c.send(JSON.stringify({ t:"error", code:"noroom", msg:"No room with that code." }));
  await attach(c,code);
  { const r=await bus.get(K.room(code)); if (r) STATS.add("join:"+(r.kind||"cg")); }
  await bus.publish(K.in(code),{ t:"join", cid:c.id, name:c.name, token:c.token });
}
const gameOf=m=>KINDS[m.game]?m.game:"cg";
const toRoom=(c,m)=>c.code&&bus.publish(K.in(c.code),Object.assign(m,{cid:c.id}));

async function onMessage(c,m){
  switch (m.t){
    case "hello": {
      c.teacherId=null;
      if (typeof m.auth==="string" && m.auth){ try{ const t=await AUTH.teacherFromToken(m.auth); if (t && !t.viewed_by) c.teacherId=+t.id; }catch(e){ console.error("[auth]",e.message); } }
      c.name=cleanName(m.name);
      c.token=typeof m.token==="string"&&m.token.length<40?m.token:id(16);
      c.send(JSON.stringify({ t:"welcome", token:c.token, name:c.name }));
      const sess=await bus.get(K.sess(c.token));           // reconnect into a live room
      if (sess && await bus.get(K.room(sess.code))) await joinRoom(c,sess.code);
      return;
    }
    case "quick":  if (!c.name) return; await leave(c); return joinRoom(c,await findPublic(gameOf(m)));
    case "create": { if (!c.name) return; await leave(c);
      // teacher arriving after "move lobby": reopen the same code for the new game (once the old room is gone)
      const mv=c.token&&await bus.get(K.moveBy(c.token));
      if (mv && mv.kind===gameOf(m)){
        await bus.del(K.moveBy(c.token)); c.movedClass=mv.classId||null;
        for (let i=0;i<20 && await bus.get(K.room(mv.code));i++) await wait(250);
        if (!await bus.get(K.room(mv.code))){ const code=await createRoom(false,mv.kind,mv.code); setTimeout(()=>bus.del(K.move(code)),20000); return joinRoom(c,code); }
      }
      return joinRoom(c,await createRoom(false,gameOf(m))); }
    case "close":  return toRoom(c,{ t:"close" });
    case "move":   if (!KINDS[m.game] || m.game==="cg") return; return toRoom(c,{ t:"move", game:m.game });
    case "join":   if (!c.name) return; await leave(c); return joinRoom(c,m.code);
    case "ready":  return toRoom(c,{ t:"ready", v:!!m.v });
    case "input":  return toRoom(c,{ t:"input", d:String(m.d) });
    case "start":  return toRoom(c,{ t:"start" });
    case "mode":   return toRoom(c,{ t:"mode", mode:String(m.mode||"").slice(0,12) });
    case "digits": return toRoom(c,{ t:"digits", d:String(m.d||"").slice(0,3) });
    case "prog":   return toRoom(c,{ t:"prog", round:m.round|0, n:Math.max(0,Math.min(99999,m.n|0)) });
    case "teacher": {                                   // optionally linked to one of the signed-in teacher's classes
      let acct=null;
      if (c.teacherId){ acct={ teacherId:c.teacherId, classId:null };
        const cls=m.classId||c.movedClass; c.movedClass=null;
        if (cls && await CD.roleIn(c.teacherId,cls)) acct.classId=+cls; }
      return toRoom(c,{ t:"teacher", acct }); }
    case "iam":    return toRoom(c,{ t:"iam", first:String(m.first||"").slice(0,30), last:String(m.last||"").slice(0,5), nick:String(m.nick||"").slice(0,20), school:String(m.school||"").slice(0,48) });
    case "tile":   return toRoom(c,{ t:"tile", dx:m.dx|0, dy:m.dy|0 });
    case "score":  return toRoom(c,{ t:"score", round:m.round|0, n:Math.max(0,Math.min(99999,m.n|0)), log:Array.isArray(m.log)?m.log.slice(0,400):undefined });
    case "pick":   return toRoom(c,{ t:"pick", b:m.b|0 });
    case "throw":  return toRoom(c,{ t:"throw", b:m.b|0 });
    case "pos":    return toRoom(c,{ t:"pos", d:+m.d, x:+m.x });
    case "finish": return toRoom(c,{ t:"finish", time:+m.time, extra:m.extra|0, log:Array.isArray(m.log)?m.log.slice(0,400):undefined });
    case "in":     return toRoom(c,{ t:"in", x:+m.x, y:+m.y });
    case "fire":   return toRoom(c,{ t:"fire" });
    case "words":  return toRoom(c,{ t:"words", text:String(m.text||"").slice(0,1200), title:String(m.title||"").slice(0,40) });
    case "claim":  return toRoom(c,{ t:"claim", a:Array.isArray(m.a)?m.a.slice(0,4).map(v=>v|0):[] });
    case "leave":  return leave(c);
    case "ping":   return c.send(JSON.stringify({ t:"pong", ts:m.ts }));
  }
}
async function leave(c){
  if (!c.code) return;
  await toRoom(c,{ t:"leave" });
  if (c.token) await bus.del(K.sess(c.token));
  await detach(c);
}

// ---- HTTP + WebSocket
const api=makeApi(bus);
if (process.env.DATABASE_URL) DB.connect().catch(e=>console.error("[db] connect failed:",e.message));   // real Postgres: connect now. PGlite (dev) starts lazily on first use so it never stalls a game
const server=http.createServer(async (req,res)=>{
  if (req.url.startsWith("/api/")) return api.handle(req,res);
  if (req.url==="/health"){
    let redis=true; try{ redis=await bus.ping(); }catch{ redis=false; }
    res.writeHead(redis?200:503,{"content-type":"application/json","access-control-allow-origin":"*","cache-control":"no-store"}); // hub reads the online count
    const games={};                                   // players per game (rooms hosted on this instance)
    for (const r of rooms.values()) games[r.kind]=(games[r.kind]||0)+r.connectedCount();
    return res.end(JSON.stringify({ ok:redis, bus:bus.kind, rooms:rooms.size, connections:conns.size, games }));
  }
  // hub "Have a code?" box: which game does this room code belong to?
  if (req.url.startsWith("/room?")){
    const code=cleanCode(new URL(req.url,"http://x").searchParams.get("code"));
    const r=code?await bus.get(K.room(code)):null;
    res.writeHead(r?200:404,{"content-type":"application/json","access-control-allow-origin":"*","cache-control":"no-store"});
    return res.end(JSON.stringify(r?{ code, kind:r.kind||"cg", state:r.state, humans:r.humans, max:r.max }:{ error:"No room with that code." }));
  }
  serveStatic(req,res);
});
const wss=new WebSocketServer({ server, maxPayload:64*1024 });   // score/finish messages may carry a per-question log
wss.on("connection",ws=>{
  if (conns.size>=MAX_CONN){ ws.close(1013,"server full"); return; }
  const c={ id:id(9), ws, name:null, token:null, code:null, alive:true,
    send:s=>{ if (ws.readyState===1) ws.send(s); } };
  conns.add(c); STATS.conns(conns.size);
  ws.on("pong",()=>{ c.alive=true; });
  ws.on("message",raw=>{ let m; try{ m=JSON.parse(raw); }catch{ return; } onMessage(c,m).catch(e=>console.error("[msg]",e)); });
  ws.on("close",async ()=>{
    conns.delete(c);
    if (c.code){ await toRoom(c,{ t:"drop" }); await detach(c); }   // session kept → reconnect possible
  });
});
// drop dead sockets (mobile sleep, network loss) so bots take over quickly
setInterval(()=>{ for (const c of conns){ if (!c.alive){ c.ws.terminate(); continue; } c.alive=false; c.ws.ping(); } },10000);

server.listen(PORT,()=>console.log(`[game] listening on :${PORT} · instance ${INSTANCE.slice(0,8)} · bus=${bus.kind}`));
const shutdown=()=>{ console.log("[game] shutting down"); STATS.flush(); for (const r of rooms.values()) r.close(); server.close(); setTimeout(()=>process.exit(0),500); };
process.on("SIGTERM",shutdown); process.on("SIGINT",shutdown);
