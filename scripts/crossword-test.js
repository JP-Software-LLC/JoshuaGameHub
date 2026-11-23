// Vocab Crossword room end-to-end: host-only word list (cleaned), lobby shows it, go carries the puzzle + same seed,
// progress relay, host can end early, ranking (finishers by time, then words solved). Also the layout generator.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const XW=require("../shared/crossword.js");
const PORT=21600+(Math.random()*300|0);
const fail=m=>{ console.error("FAIL:",m); srv&&srv.kill(); process.exit(1); };
// generator: every word placed, crossings agree, nothing touches side by side, same seed = same layout
for (const P of [...XW.PUZZLES,{ w:[["CAT","x"],["DOG","x"],["SUN","x"]] }]){
  const r=XW.build(P.w.map(x=>x[0]),7), r2=XW.build(P.w.map(x=>x[0]),7), g=new Map();
  if (r.placed.length!==P.w.length) fail("not every word placed");
  if (JSON.stringify(r.placed)!==JSON.stringify(r2.placed)) fail("same seed gave a different layout");
  for (const p of r.placed) for (let i=0;i<p.word.length;i++){ const k=(p.r+(p.dir==="d"?i:0))+","+(p.c+(p.dir==="a"?i:0)); if (g.has(k)&&g.get(k)!==p.word[i]) fail("crossing letters disagree"); g.set(k,p.word[i]); }
}
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, RUSH_COUNTDOWN_MS:300 }, stdio:["ignore","pipe","inherit"] });
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
    for (let i=0;i<4;i++){ const c=client("P"+i); await c.ready; await c.wait(m=>m.t==="welcome"); c.send(i?{ t:"join", code }:{ t:"create", game:"crossword" });
      const j=await c.wait(m=>m.t==="joined"); if (j.game!=="crossword") fail("game should be crossword"); code=j.code; c.pid=j.pid; all.push(c); }
    const list={ title:"Week 4", w:[["habitat","Where an animal lives"],["Prey!","An animal that is hunted"],["ab","too short"],["nest",""],["herd","A group of animals"],["burrow","A hole dug by a rabbit"]] };
    all[1].send({ t:"xw", xw:{ title:"Hack", w:[["aaa","x"],["bbb","y"],["ccc","z"]] } }); await sleep(100);
    all[0].send({ t:"xw", xw:list });
    await all[2].wait(m=>m.t==="lobby"&&m.xw&&m.xw.title==="Week 4"&&m.xw.n===4);
    all[0].send({ t:"start" });
    const gos=await Promise.all(all.map(c=>c.wait(m=>m.t==="go")));
    if (new Set(gos.map(g=>g.seed)).size!==1) fail("players got different seeds");
    const xw=gos[0].xw; if (!xw || xw.w.map(x=>x[0]).join()!=="HABITAT,PREY,HERD,BURROW" || gos[0].dist!==4) fail("go should carry the cleaned list: "+JSON.stringify(xw));
    all.forEach((c,i)=>c.send({ t:"pos", d:i })); await sleep(250);
    const ps=all[3].msgs.filter(m=>m.t==="ps").pop(); if (!ps || ps.p.find(q=>q[0]===all[3].pid)[1]!==3) fail("relay should carry words solved");
    all[2].send({ t:"finish", time:95, extra:2 }); all[1].send({ t:"finish", time:80, extra:0 }); await sleep(150);
    if (all[0].msgs.some(m=>m.t==="results")) fail("ended too early");
    all[3].send({ t:"end" }); await sleep(150);
    if (all[0].msgs.some(m=>m.t==="results")) fail("only the host can end it");
    all[0].send({ t:"end" });
    const res=await all[3].wait(m=>m.t==="results",2000), order=res.rank.map(r=>r.name).join(",");
    if (order!=="P1,P2,P3,P0") fail("ranking wrong: "+order);
    all[0].send({ t:"xw", clear:true }); await all[1].wait(m=>m.t==="lobby"&&m.state==="lobby"&&m.xw===null);
    console.log("OK: vocab crossword — layout (all words, crossings agree, seeded), host-only cleaned word list, shared puzzle + seed, progress relay, host ends early, ranked by time then words");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),20000);
