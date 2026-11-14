// End-to-end: boots the game server, connects two players, forms a private room,
// readies up, checks floor + snapshots stream, drops a player (bot takes over),
// reconnects with the same token, and checks they get their slot back.
// Uses REDIS_URL if set, otherwise the in-memory bus.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=18000+(Math.random()*1000|0);
const URL=`ws://127.0.0.1:${PORT}`;
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT }, stdio:["ignore","pipe","inherit"] });

function client(name,token){
  const ws=new WebSocket(URL), c={ ws, msgs:[], name };
  c.wait=(pred,ms=5000)=>new Promise((res,rej)=>{
    const hit=c.msgs.find(pred); if (hit) return res(hit);
    const t=setTimeout(()=>rej(new Error(`${name}: timeout`)),ms);
    c.onMsg=m=>{ if (pred(m)){ clearTimeout(t); c.onMsg=null; res(m); } };
  });
  c.send=m=>ws.send(JSON.stringify(m));
  ws.on("message",raw=>{ const m=JSON.parse(raw); c.msgs.push(m); c.onMsg&&c.onMsg(m); });
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name, token }); r(); }));
  return c;
}

srv.stdout.on("data",async d=>{
  process.stdout.write(d);
  if (!/listening/.test(d)) return;
  try {
    const a=client("Alice"); await a.ready;
    const welcomeA=await a.wait(m=>m.t==="welcome");
    a.send({ t:"create" });
    const ja=await a.wait(m=>m.t==="joined");
    const b=client("Bob"); await b.ready; await b.wait(m=>m.t==="welcome");
    b.send({ t:"join", code:ja.code });
    const jb=await b.wait(m=>m.t==="joined");
    if (jb.slot===ja.slot) fail("same slot");
    await a.wait(m=>m.t==="lobby"&&m.slots.filter(Boolean).length===2);
    a.send({ t:"ready", v:true }); b.send({ t:"ready", v:true });
    await a.wait(m=>m.t==="start");
    const fl=await b.wait(m=>m.t==="floor");
    if (fl.grid.length!==23||fl.grid[0].length!==27) fail("bad grid");
    await new Promise(r=>setTimeout(r,1000));
    const snaps=a.msgs.filter(m=>m.t==="s").length;
    if (snaps<20) fail(`too few snapshots in 1s: ${snaps}`);
    a.send({ t:"input", d:"left" });
    console.log(`room ${ja.code}: ${snaps} snapshots/s, last state=${a.msgs.filter(m=>m.t==="s").pop().s.st}`);

    // drop Alice → bot takes her slot; reconnect with token → slot returns
    a.ws.terminate();
    await new Promise(r=>setTimeout(r,400));
    let s=b.msgs.filter(m=>m.t==="s").pop().s;
    if (!s.p[ja.slot][5]) fail("bot did not take over dropped player");
    const a2=client("Alice",welcomeA.token); await a2.ready;
    const rj=await a2.wait(m=>m.t==="joined");
    if (rj.slot!==ja.slot) fail("reconnect got a different slot");
    await a2.wait(m=>m.t==="floor");
    await new Promise(r=>setTimeout(r,300));
    s=a2.msgs.filter(m=>m.t==="s").pop().s;
    if (s.p[ja.slot][5]) fail("still a bot after reconnect");

    // public matchmaking puts two quick-players in the same room
    const c=client("Cy"); await c.ready; await c.wait(m=>m.t==="welcome"); c.send({ t:"quick" });
    const d=client("Di"); await d.ready; await d.wait(m=>m.t==="welcome");
    const jc=await c.wait(m=>m.t==="joined"); d.send({ t:"quick" });
    const jd=await d.wait(m=>m.t==="joined");
    if (jc.code!==jd.code) fail("public matchmaking split players");

    const h=await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
    const cfg=await (await fetch(`http://127.0.0.1:${PORT}/config.js`)).text();
    const page=await fetch(`http://127.0.0.1:${PORT}/`), sim=await fetch(`http://127.0.0.1:${PORT}/sim.js`);
    if (!h.ok||page.status!==200||sim.status!==200||!cfg.includes("CG_CONFIG")) fail("http endpoints");
    console.log("health:",JSON.stringify(h));
    console.log("OK: lobby, start, snapshots, bot takeover, reconnect, matchmaking, static");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),20000);
