// Every online game can be joined mid-game: 2 players start a private room, a 3rd joins by code
// while it's playing and must be put straight into the game (no "full / already playing" error).
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=21700+(Math.random()*300|0);
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, RUSH_COUNTDOWN_MS:300 }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[], name };
  c.send=m=>ws.send(JSON.stringify(m));
  c.wait=(pred,ms=6000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,10); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}
// game id → the message that puts a player into a running game
const KINDS={ cg:"start", math:"round", arrows:"round", rush:"go", hurdle:"go", hoops:"go", softball:"go", crossword:"go", stumble:"go", typing:"go", munch:"start",
  bear:"start", memory:"start", cannons:"start", darts:"start", sky:"start", words:"start" };
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  const done=[];
  try {
    for (const [kind,goT] of Object.entries(KINDS)){
      const a=client(kind+"A"), b=client(kind+"B"); await a.ready; await b.ready;
      await a.wait(m=>m.t==="welcome"); a.send({ t:"create", game:kind });
      const j=await a.wait(m=>m.t==="joined"); await b.wait(m=>m.t==="welcome"); b.send({ t:"join", code:j.code }); await b.wait(m=>m.t==="joined");
      if (kind==="cg"){ a.send({ t:"ready", v:true }); b.send({ t:"ready", v:true }); } else a.send({ t:"start" });
      await a.wait(m=>m.t===goT,8000); await sleep(700);
      const c=client(kind+"Late"); await c.ready; await c.wait(m=>m.t==="welcome"); c.send({ t:"join", code:j.code });
      const r=await c.wait(m=>m.t==="error"||m.t===goT,6000).catch(()=>null);
      if (!r) fail(kind+": late joiner never got into the game");
      if (r.t==="error") fail(kind+": late joiner refused: "+r.msg);
      done.push(kind);
      for (const x of [a,b,c]){ try{ x.send({ t:"leave" }); x.ws.close(); }catch{} }
    }
    console.log("OK: mid-game join — "+done.join(", "));
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),120000);
