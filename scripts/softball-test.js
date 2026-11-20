// Softball Smarts room end-to-end: 5 players, host picks the Math Race mode, baskets relayed, and the game ends
// for everyone as soon as 60 % of the class (3 of 5) has scored the run goal. Unfinished players ranked by baskets.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=21300+(Math.random()*300|0);
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, RUSH_COUNTDOWN_MS:300 }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[], name };
  c.send=m=>ws.send(JSON.stringify(m));
  c.wait=(pred,ms=5000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,10); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    const all=[]; let code;
    for (let i=0;i<5;i++){ const c=client("P"+i); await c.ready; await c.wait(m=>m.t==="welcome"); c.send(i?{ t:"join", code }:{ t:"create", game:"softball" });
      const j=await c.wait(m=>m.t==="joined"); if (j.game!=="softball") fail("game should be softball"); code=j.code; c.pid=j.pid; all.push(c); }
    all[1].send({ t:"mode", mode:"mul" }); await sleep(100);
    all[0].send({ t:"mode", mode:"bogus" }); all[0].send({ t:"mode", mode:"div" }); all[0].send({ t:"digits", d:"12" });
    all[2].send({ t:"goal", goal:20 }); all[0].send({ t:"goal", goal:4 }); all[0].send({ t:"goal", goal:31 }); all[0].send({ t:"goal", goal:12 }); all[2].send({ t:"pitch", s:4 }); all[0].send({ t:"pitch", s:13 }); all[0].send({ t:"pitch", s:8 });
    await all[3].wait(m=>m.t==="lobby"&&m.mode==="div"&&m.digits==="12"&&m.goal===12&&m.pitch===8);
    all[0].send({ t:"start" });
    const gos=await Promise.all(all.map(c=>c.wait(m=>m.t==="go")));
    if (new Set(gos.map(g=>g.seed)).size!==1) fail("players got different seeds");
    if (gos[0].mode!=="div" || gos[0].digits!=="12" || gos[0].dist!==12 || gos[0].pitch!==8) fail("go should carry mode div, digits 12, goal 12, pitch 8");
    all.forEach((c,i)=>c.send({ t:"pos", d:i, x:i%2 })); await sleep(250);
    const ps=all[4].msgs.filter(m=>m.t==="ps").pop();
    if (!ps || ps.p.length!==5 || ps.p.find(q=>q[0]===all[4].pid)[1]!==4) fail("relay should carry runs for all 5");
    // 2 of 5 finished → still playing; the 3rd (60 %) ends it immediately
    all[2].send({ t:"finish", time:70, extra:14 }); all[0].send({ t:"finish", time:80, extra:15 }); await sleep(300);
    if (all[0].msgs.some(m=>m.t==="results")) fail("ended before 60 % finished");
    all[1].send({ t:"pos", d:7, x:0 }); all[3].send({ t:"pos", d:3, x:0 }); await sleep(150);
    all[4].send({ t:"finish", time:95, extra:20 });
    const res=await all[1].wait(m=>m.t==="results",2000);
    const order=res.rank.map(r=>r.name).join(",");
    if (order!=="P2,P0,P4,P1,P3") fail("ranking wrong: "+order);
    if (res.rank[3].time!=null || res.rank[3].d!==7) fail("unfinished ranked by baskets");
    console.log("OK: softball — host-only mode + digits + run goal (5–30) + pitch time (3–12 s), shared seed, basket relay, ends when 60 % finish, unfinished by runs");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),20000);
