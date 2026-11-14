// Hurdle Dash room end-to-end (same race room as Rush Hour): 4 racers, positions relayed ~10/s, finish times ranked,
// an unfinished racer is ranked by distance after the winner's grace period.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=20900+(Math.random()*300|0);
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, RUSH_COUNTDOWN_MS:300, RUSH_AFTER_FIRST_MS:1500 }, stdio:["ignore","pipe","inherit"] });
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
    for (let i=0;i<4;i++){ const c=client("R"+i); await c.ready; await c.wait(m=>m.t==="welcome"); c.send(i?{ t:"join", code }:{ t:"create", game:"hurdle" });
      const j=await c.wait(m=>m.t==="joined"); if (j.game!=="hurdle") fail("game should be hurdle"); code=j.code; c.pid=j.pid; all.push(c); }
    all[1].send({ t:"start" }); await sleep(200);
    if (all[0].msgs.some(m=>m.t==="go")) fail("non-host started the race");
    all[0].send({ t:"start" });
    const gos=await Promise.all(all.map(c=>c.wait(m=>m.t==="go")));
    if (new Set(gos.map(g=>g.seed)).size!==1) fail("racers got different seeds");
    if (gos[0].players.length!==4) fail("go should list 4 racers");
    // drive: positions every 100 ms
    for (let k=1;k<=6;k++){ all.forEach((c,i)=>c.send({ t:"pos", d:k*100*(i+1), x:(i-1)*3.6 })); await sleep(100); }
    const ps=all[3].msgs.filter(m=>m.t==="ps").pop();
    if (!ps || ps.p.length!==4) fail("position relay should include all 4");
    if (ps.p.find(q=>q[0]===all[3].pid)[1]<Math.min(2000,gos[0].dist*0.5)) fail("relay should carry latest distance");
    // finishes: R2 first, then R0, R1; R3 never finishes
    all[2].send({ t:"finish", time:38.4, extra:5 }); await sleep(50);
    all[0].send({ t:"finish", time:41.0, extra:3 }); await sleep(50);
    all[1].send({ t:"finish", time:44.2, extra:2 });
    const partD=Math.round(gos[0].dist*0.8);
    all[3].send({ t:"pos", d:partD, x:0 });
    const res=await all[0].wait(m=>m.t==="results",5000);
    const order=res.rank.map(r=>r.name).join(",");
    if (order!=="R2,R0,R1,R3") fail("ranking wrong: "+order);
    if (res.rank[0].extra!==5) fail("clean jumps should be reported");
    if (gos[0].dist!==100) fail("hurdle track should be 100 m");
    if (res.rank[3].time!=null || res.rank[3].d!==partD) fail("unfinished racer should be ranked by distance");
    await all[0].wait(m=>m.t==="lobby"&&m.state==="lobby");
    console.log("OK: hurdle dash — shared seed, host start, position relay, finish ranking, unfinished by distance");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),20000);
