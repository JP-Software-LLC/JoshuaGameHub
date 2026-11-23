// Public quick play: no 30 s timer in public lobbies. The first player (host) starts it, or it starts by itself the
// moment the lobby is full. /lobbies lists open public lobbies for the hub's "Join any game". Private rooms keep the timer.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=24300+(Math.random()*300|0), BASE=`http://127.0.0.1:${PORT}`;
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, BEAR_AUTO_MS:300, MUNCH_AUTO_MS:300, BEAR_COUNTDOWN_MS:100 }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[] };
  c.send=m=>ws.readyState===1&&ws.send(JSON.stringify(m));
  c.wait=(pred,ms=8000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,10); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw))); ws.on("error",()=>{});
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}
const lobbies=async()=>(await (await fetch(BASE+"/lobbies")).json()).lobbies;
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    if ((await lobbies()).length) fail("no lobbies yet");
    // two players quick-join Bear Attack!: same public room, and it does NOT start by itself (no timer)
    const A=client("Ann"), B=client("Bo"); await A.ready; await B.ready; await A.wait(m=>m.t==="welcome"); await B.wait(m=>m.t==="welcome");
    A.send({ t:"quick", game:"bear" }); const ja=await A.wait(m=>m.t==="joined");
    B.send({ t:"quick", game:"bear" }); const jb=await B.wait(m=>m.t==="joined");
    if (ja.code!==jb.code) fail("quick join should put both in the same public lobby");
    await sleep(900);
    if (A.msgs.some(m=>m.t==="start")) fail("public lobbies must not start on a timer");
    const L=A.msgs.filter(m=>m.t==="lobby").pop(); if (L.autoIn) fail("public lobby shouldn't show a countdown");
    const ls=await lobbies(); if (ls.length!==1 || ls[0].code!==ja.code || ls[0].kind!=="bear" || ls[0].humans!==2) fail("/lobbies should list the open bear lobby: "+JSON.stringify(ls));
    // only the host can start
    B.send({ t:"start" }); await sleep(300); if (A.msgs.some(m=>m.t==="start")) fail("a non-host started the game");
    A.send({ t:"start" }); await A.wait(m=>m.t==="start"); await B.wait(m=>m.t==="start");
    await sleep(200); if ((await lobbies()).some(l=>l.code===ja.code)) fail("a started game is no longer an open lobby");
    for (const c of [A,B]){ c.send({ t:"leave" }); c.ws.close(); }
    // a full public lobby starts by itself (Bear Attack! holds 40)
    const crowd=[]; for (let i=0;i<40;i++){ const c=client("P"+i); crowd.push(c); }
    for (const c of crowd){ await c.ready; await c.wait(m=>m.t==="welcome"); c.send({ t:"quick", game:"bear" }); await c.wait(m=>m.t==="joined"); }
    if (new Set(crowd.map(c=>c.msgs.find(m=>m.t==="joined").code)).size!==1) fail("40 quick joiners should share one lobby");
    await crowd[0].wait(m=>m.t==="start",4000).catch(()=>fail("a full public lobby should start by itself"));
    for (const c of crowd){ c.send({ t:"leave" }); c.ws.close(); }
    // private rooms keep their 30 s auto-start (shortened here)
    const P=client("Pri"), Q=client("Q"); await P.ready; await Q.ready; await P.wait(m=>m.t==="welcome"); await Q.wait(m=>m.t==="welcome");
    P.send({ t:"create", game:"munch" }); const jp=await P.wait(m=>m.t==="joined"); Q.send({ t:"join", code:jp.code }); await Q.wait(m=>m.t==="joined");
    await P.wait(m=>m.t==="start",4000).catch(()=>fail("private rooms should still auto-start"));
    if ((await lobbies()).some(l=>l.code===jp.code)) fail("private rooms are never listed");
    console.log("OK: public quick play — no timer, host starts or full lobby starts itself; /lobbies lists open public lobbies only; private rooms keep auto-start");
    srv.kill(); process.exit(0);
  } catch(e){ fail(e.stack||e.message); }
});
setTimeout(()=>fail("timeout"),60000);
