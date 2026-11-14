// Bear Attack! end-to-end: 3 players, ~20 snapshots/s, two skate off the ice (FROZEN),
// the one left on the ice wins; ranking puts the last to fall second.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=20600+(Math.random()*300|0);
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, BEAR_COUNTDOWN_MS:200 }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[], name };
  c.send=m=>ws.send(JSON.stringify(m));
  c.wait=(pred,ms=8000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,10); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    const all=[]; let code;
    for (let i=0;i<3;i++){ const c=client("P"+i); await c.ready; await c.wait(m=>m.t==="welcome"); c.send(i?{ t:"join", code }:{ t:"create", game:"bear" });
      const j=await c.wait(m=>m.t==="joined"); if (j.game!=="bear") fail("game should be bear"); code=j.code; c.pid=j.pid; all.push(c); }
    all[0].send({ t:"start" });
    await Promise.all(all.map(c=>c.wait(m=>m.t==="start")));
    await sleep(1200);
    const snaps=all[0].msgs.filter(m=>m.t==="s");
    if (snaps.length<15) fail("expected ~20 snapshots/s, got "+snaps.length);
    const s0=snaps[snaps.length-1].s;
    if (s0.p.length!==3 || s0.ph!=="wake") fail("should be 3 skaters with the bear still asleep");
    // P1 then P2 skate straight off the ice (away from the centre)
    const away=(c)=>{ const me=all[0].msgs.filter(m=>m.t==="s").pop().s.p.find(q=>q[0]===c.pid); const d=Math.hypot(me[1],me[2])||1; c.send({ t:"in", x:me[1]/d, y:me[2]/d }); };
    away(all[1]);
    await all[0].wait(m=>m.t==="s"&&m.e.some(e=>e.type==="frozen"&&e.id===all[1].pid),10000);
    away(all[2]);
    await all[0].wait(m=>m.t==="s"&&m.e.some(e=>e.type==="frozen"&&e.id===all[2].pid),10000);
    const res=await all[0].wait(m=>m.t==="results",5000);
    const order=res.rank.map(r=>r.name).join(",");
    if (order!=="P0,P2,P1") fail("ranking wrong: "+order);
    if (!res.rank[0].alive) fail("winner should still be on the ice");
    await all[0].wait(m=>m.t==="lobby"&&m.state==="lobby");
    console.log("OK: bear attack — 20 Hz snapshots, skating off = FROZEN, last on the ice wins, ranking by time on ice");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),30000);
