// Bumbling Stumbling Math room end-to-end: 5 players. Host-only time limit (lobby only, T.limits), go carries it,
// ps rows carry [pid,d,x,fin,y,a] (clamped), the race ends once 60 % (3 of 5) have finished, unfinished ranked by
// distance; then a time-limited race ends by itself; then the host ends one early with end{} (non-host can't).
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const STUMBLE=require("../shared/stumble.js");
const PORT=24700+(Math.random()*300|0);
const MINUTE_MS=400;                                     // the time limit's "minute", shrunk for the test
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, RUSH_COUNTDOWN_MS:300, STUMBLE_MINUTE_MS:MINUTE_MS }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[], name, from:0 };
  c.send=m=>ws.send(JSON.stringify(m));
  c.mark=()=>{ c.from=c.msgs.length; };
  c.wait=(pred,ms=5000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.slice(c.from).find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,10); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    const all=[]; let code;
    for (let i=0;i<5;i++){ const c=client("P"+i); await c.ready; await c.wait(m=>m.t==="welcome"); c.send(i?{ t:"join", code }:{ t:"create", game:"stumble" });
      const j=await c.wait(m=>m.t==="joined"); if (j.game!=="stumble") fail("game should be stumble"); code=j.code; c.pid=j.pid; all.push(c); }
    const mark=()=>all.forEach(c=>c.mark());
    // ---- time limit: host only, lobby only, only values in T.limits
    if (!STUMBLE.T.limits.includes(3) || !STUMBLE.T.limits.includes(0)) fail("T.limits should include 0 and 3");
    const lob=await all[4].wait(m=>m.t==="lobby"); if (lob.limit!==0) fail("lobby should carry limit 0 by default");
    all[1].send({ t:"limit", min:3 }); all[0].send({ t:"limit", min:4 }); all[0].send({ t:"limit", min:"x" }); all[0].send({ t:"limit", min:-1 }); await sleep(200);
    if (all[4].msgs.some(m=>m.t==="lobby"&&m.limit!==0)) fail("non-host / bad limit accepted");
    mark(); all[0].send({ t:"limit", min:3 }); await all[4].wait(m=>m.t==="lobby"&&m.limit===3);
    mark(); all[0].send({ t:"limit", min:0 }); await all[4].wait(m=>m.t==="lobby"&&m.limit===0);
    all[0].send({ t:"end" }); await sleep(100);                                   // end{} in the lobby does nothing
    // ---- race 1: no limit, 60 % rule
    mark(); all[0].send({ t:"start" });
    const gos=await Promise.all(all.map(c=>c.wait(m=>m.t==="go")));
    if (new Set(gos.map(g=>g.seed)).size!==1) fail("players got different seeds");
    if (gos[0].dist!==STUMBLE.T.dist || gos[0].limit!==0 || gos[0].endsIn!==0) fail("go should carry dist T.dist, limit 0: "+JSON.stringify(gos[0]));
    all[0].send({ t:"limit", min:5 }); await sleep(50);                            // limit{} while playing is refused
    all[0].send({ t:"pos", d:10, x:99, y:999, a:7 });
    all[1].send({ t:"pos", d:42.34, x:-3.456, y:2.5, a:2 });
    all[2].send({ t:"pos", d:-5, x:-99, y:-999, a:-2 });
    all[3].send({ t:"pos", d:30, x:1, y:0, a:1.4 });
    all[4].send({ t:"pos", d:999 });
    await sleep(300);
    const ps=all[4].msgs.filter(m=>m.t==="ps").pop();
    if (!ps || ps.p.length!==5 || ps.p.some(r=>r.length!==6)) fail("ps rows should have 6 fields for all 5: "+JSON.stringify(ps));
    const row=pid=>ps.p.find(r=>r[0]===pid);
    const H=STUMBLE.T.halfWidth;
    if (JSON.stringify(row(all[0].pid))!==JSON.stringify([all[0].pid,10,H,0,50,4])) fail("clamp high: "+JSON.stringify(row(all[0].pid)));
    if (JSON.stringify(row(all[1].pid))!==JSON.stringify([all[1].pid,42.3,-3.46,0,2.5,2])) fail("relay: "+JSON.stringify(row(all[1].pid)));
    if (JSON.stringify(row(all[2].pid))!==JSON.stringify([all[2].pid,0,-H,0,-50,0])) fail("clamp low: "+JSON.stringify(row(all[2].pid)));
    if (row(all[3].pid)[5]!==1) fail("anim should round to an int");
    if (row(all[4].pid)[1]!==STUMBLE.T.dist) fail("d should clamp to T.dist");
    // 2 of 5 finished → still racing; the 3rd (ceil 60 %) ends it immediately
    all[2].send({ t:"finish", time:31.5, extra:2 }); all[0].send({ t:"finish", time:3, extra:0 }); await sleep(400);
    if (all[0].msgs.slice(all[0].from).some(m=>m.t==="results")) fail("ended before 60 % finished");
    const f0=all[0].msgs.find(m=>m.t==="fin"&&m.pid===all[0].pid); if (!f0 || f0.time!==5) fail("finish time should clamp to ≥ 5 s");
    all[4].send({ t:"pos", d:60 }); await sleep(150);
    all[1].send({ t:"finish", time:40, extra:5 });
    const res=await all[3].wait(m=>m.t==="results",2000);
    const order=res.rank.map(r=>r.name).join(",");
    if (order!=="P0,P2,P1,P4,P3") fail("ranking wrong: "+order);
    if (res.rank[3].time!=null || res.rank[3].d!==60 || res.rank[1].extra!==2) fail("unfinished by distance / extra = falls");
    // ---- race 2: 2-minute limit (a "minute" = 400 ms here) ends it by itself
    mark(); all[0].send({ t:"limit", min:2 }); await all[4].wait(m=>m.t==="lobby"&&m.limit===2&&m.state==="lobby");
    mark(); const t0=Date.now(); all[0].send({ t:"start" });
    const go2=await all[1].wait(m=>m.t==="go");
    if (go2.limit!==2 || !(go2.endsIn>2*MINUTE_MS && go2.endsIn<=2*MINUTE_MS+300)) fail("go should carry limit 2 + endsIn: "+JSON.stringify({ limit:go2.limit, endsIn:go2.endsIn }));
    all[3].send({ t:"pos", d:80 }); all[2].send({ t:"pos", d:20 });
    const res2=await all[1].wait(m=>m.t==="results",4000), took=Date.now()-t0;
    if (took<2*MINUTE_MS+250) fail("time limit ended too early ("+took+" ms)");
    if (res2.rank.some(r=>r.time!=null) || res2.rank[0].name!=="P3" || res2.rank[1].name!=="P2") fail("time-limit ranking by distance: "+res2.rank.map(r=>r.name+":"+r.d).join(","));
    // ---- race 3: only the host can end it early with end{}
    mark(); all[0].send({ t:"limit", min:0 }); await all[4].wait(m=>m.t==="lobby"&&m.limit===0&&m.state==="lobby");
    mark(); all[0].send({ t:"start" }); await all[2].wait(m=>m.t==="go");
    all[3].send({ t:"end" }); await sleep(300);
    if (all[2].msgs.slice(all[2].from).some(m=>m.t==="results")) fail("non-host ended the race");
    all[0].send({ t:"end" });
    await all[2].wait(m=>m.t==="results",2000);
    await sleep(MINUTE_MS*3);                                                    // no stray limit timer from race 2
    if (all[2].msgs.slice(all[2].from).filter(m=>m.t==="results").length!==1) fail("extra results after end{}");
    console.log("OK: bumbling stumbling math — host-only limit{0|2|3|5} in lobby, go carries limit, ps rows [pid,d,x,fin,y,a] clamped, ends at 60 % finished, unfinished by distance, time limit ends it, host-only end{}");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),25000);
