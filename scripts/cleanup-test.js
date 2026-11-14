// Room cleanup: rooms close as soon as everyone LEAVES (lobby or mid-game, both games),
// but a mid-game room survives a dropped connection so the player can reconnect.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=19500+(Math.random()*400|0);
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rooms=async()=>(await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()).rooms;
function client(name,token){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[] };
  c.send=m=>ws.send(JSON.stringify(m));
  c.wait=(pred,ms=4000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,20); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name, token }); r(); }));
  return c;
}
async function pair(game){
  const a=client("A"); await a.ready; await a.wait(m=>m.t==="welcome"); a.send({ t:"create", game });
  const j=await a.wait(m=>m.t==="joined");
  const b=client("B"); await b.ready; await b.wait(m=>m.t==="welcome"); b.send({ t:"join", code:j.code }); await b.wait(m=>m.t==="joined");
  return [a,b];
}
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    // 1. Clean Getaway mid-match, both leave → closed at once
    let [a,b]=await pair("cg"); a.send({ t:"ready", v:true }); b.send({ t:"ready", v:true }); await a.wait(m=>m.t==="start");
    a.send({ t:"leave" }); b.send({ t:"leave" }); await sleep(300);
    if (await rooms()!==0) fail("CG room should close when everyone leaves mid-match");
    // 2. Math Race mid-round, both leave → closed at once
    [a,b]=await pair("math"); a.send({ t:"start" }); await a.wait(m=>m.t==="round");
    a.send({ t:"leave" }); b.send({ t:"leave" }); await sleep(300);
    if (await rooms()!==0) fail("Math room should close when everyone leaves mid-round");
    // 3. Lobby, one leaves then the other → closed
    [a,b]=await pair("math"); a.send({ t:"leave" }); await sleep(200);
    if (await rooms()!==1) fail("room should stay while someone is still in it");
    b.send({ t:"leave" }); await sleep(300);
    if (await rooms()!==0) fail("empty lobby should close");
    // 4. Mid-match DROP (connection lost) → room kept for reconnect
    [a,b]=await pair("cg"); a.send({ t:"ready", v:true }); b.send({ t:"ready", v:true }); await a.wait(m=>m.t==="start");
    const tok=a.msgs.find(m=>m.t==="welcome").token;
    b.send({ t:"leave" }); a.ws.terminate(); await sleep(400);
    if (await rooms()!==1) fail("mid-match drop should keep the room for reconnecting");
    const a2=client("A",tok); await a2.ready; await a2.wait(m=>m.t==="joined");
    a2.send({ t:"leave" }); await sleep(300);
    if (await rooms()!==0) fail("room should close once the reconnected player leaves");
    console.log("OK: rooms close when everyone leaves (lobby + mid-game, both games); drops keep the room for reconnect");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),20000);
