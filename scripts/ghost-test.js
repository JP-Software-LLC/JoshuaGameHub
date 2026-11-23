// Rooms must never be held open by "ghost" players. A ghost was a player the room thinks is connected but whose
// socket is gone: the browser closed WHILE its join was still on the way (the drop reached the room before the
// join did, so it was ignored). The bus here is slowed to network-Redis speed (BUS_TEST_DELAY_MS) to hit that window.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=23600+(Math.random()*300|0);
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, BUS_TEST_DELAY_MS:15, GHOST_SWEEP_MS:500 }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const health=async()=>(await fetch(`http://127.0.0.1:${PORT}/health`)).json();
function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[] };
  c.send=m=>ws.readyState===1&&ws.send(JSON.stringify(m));
  c.wait=(pred,ms=8000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,10); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw))); ws.on("error",()=>{});
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    for (const kind of ["hoops","bear","words","typing"]){
      // a host makes a room; 6 classmates join and slam their laptops shut mid-join, at slightly different moments
      const H=client("Host"); await H.ready; await H.wait(m=>m.t==="welcome"); H.send({ t:"create", game:kind });
      const j=await H.wait(m=>m.t==="joined");
      const ks=[];
      for (let i=0;i<6;i++){ const k=client("Kid"+i); await k.ready; await k.wait(m=>m.t==="welcome"); ks.push(k); }
      ks.forEach((k,i)=>{ k.send({ t:"join", code:j.code }); setTimeout(()=>k.ws.terminate(),i*7); });
      await sleep(1500);
      // only the host is really here
      const g=(await health()).games[kind]||0;
      if (g!==1) fail(`${kind}: ${g} players "connected" but only the host is (ghosts)`);
      // and when the host leaves the room closes
      H.send({ t:"leave" }); H.ws.close(); await sleep(1500);
      const h=await health();
      if ((h.games[kind]||0)!==0) fail(kind+": room kept open after everyone left");
    }
    if ((await health()).rooms!==0) fail("rooms left open: "+(await health()).rooms);
    console.log("OK: no ghost players — closing mid-join never leaves a 'connected' player behind; rooms close when everyone is gone");
    srv.kill(); process.exit(0);
  } catch(e){ fail(e.stack||e.message); }
});
setTimeout(()=>fail("timeout"),60000);
