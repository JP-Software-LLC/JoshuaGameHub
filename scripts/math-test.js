// Math Race end-to-end (fast timings): 8 players join a private room, the host starts,
// everyone gets the same seed each round, reports a score, and receives round + final rankings.
// Also checks: non-host can't start, wrong-game codes are flagged, the 41st player is refused.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=19000+(Math.random()*900|0);
const env={ ...process.env, PORT, MATH_COUNTDOWN_MS:200, MATH_ROUND_MS:300, MATH_GRACE_MS:300, MATH_RESULTS_MS:300 };
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[], name };
  c.send=m=>ws.send(JSON.stringify(m));
  c.wait=(pred,ms=4000)=>new Promise((res,rej)=>{
    const hit=c.msgs.find(pred); if (hit) return res(hit);
    const t=setTimeout(()=>rej(new Error(`${name}: timeout`)),ms);
    c.waiters.push(m=>{ if (pred(m)){ clearTimeout(t); res(m); return true; } });
  });
  c.waiters=[];
  ws.on("message",raw=>{ const m=JSON.parse(raw); c.msgs.push(m); c.waiters=c.waiters.filter(w=>!w(m)); });
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}

srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    const host=client("Host"); await host.ready; await host.wait(m=>m.t==="welcome");
    host.send({ t:"create", game:"math" });
    const j=await host.wait(m=>m.t==="joined");
    if (j.game!=="math") fail("joined.game should be math");
    const others=[];
    for (let i=1;i<8;i++){ const c=client("P"+i); await c.ready; await c.wait(m=>m.t==="welcome"); c.send({ t:"join", code:j.code }); others.push(c); }
    await Promise.all(others.map(c=>c.wait(m=>m.t==="joined")));
    const all=[host,...others];
    await host.wait(m=>m.t==="lobby"&&m.players.length===8);

    others[0].send({ t:"start" });                          // non-host: ignored
    await sleep(300);
    if (host.msgs.some(m=>m.t==="round")) fail("non-host started the race");

    host.send({ t:"start" });
    for (let r=1;r<=3;r++){
      const rounds=await Promise.all(all.map(c=>c.wait(m=>m.t==="round"&&m.n===r)));
      if (new Set(rounds.map(m=>m.seed)).size!==1) fail("players got different seeds");
      all.forEach((c,i)=>c.send({ t:"score", round:r, n:(i*3+r)%11 }));
      const res=await host.wait(m=>m.t==="results"&&m.n===r);
      if (res.rank.length!==8) fail("results should rank all 8");
      for (let i=1;i<res.rank.length;i++) if (res.rank[i].score>res.rank[i-1].score) fail("results not sorted");
    }
    const fin=await host.wait(m=>m.t==="final");
    const total=i=>[1,2,3].reduce((a,r)=>a+(i*3+r)%11,0);
    const expectTop=Math.max(...all.map((_,i)=>total(i)));
    if (fin.rank[0].score!==expectTop) fail(`final winner score ${fin.rank[0].score} != ${expectTop}`);
    if (!fin.rank[0].rounds || fin.rank[0].rounds.length!==3) fail("final should include per-round scores");
    await host.wait(m=>m.t==="lobby"&&m.state==="lobby");

    // wrong-game join is flagged to the client
    const cg=client("CG"); await cg.ready; await cg.wait(m=>m.t==="welcome"); cg.send({ t:"create" });
    const cj=await cg.wait(m=>m.t==="joined");
    const x=client("X"); await x.ready; await x.wait(m=>m.t==="welcome"); x.send({ t:"join", code:cj.code });
    if ((await x.wait(m=>m.t==="joined")).game!=="cg") fail("cg room should report game cg");

    // capacity: 40 max
    const fill=[];
    for (let i=0;i<32;i++){ const c=client("F"+i); fill.push(c); }
    await Promise.all(fill.map(async c=>{ await c.ready; await c.wait(m=>m.t==="welcome"); c.send({ t:"join", code:j.code }); await c.wait(m=>m.t==="joined"); }));
    const extra=client("Extra"); await extra.ready; await extra.wait(m=>m.t==="welcome"); extra.send({ t:"join", code:j.code });
    const e=await extra.wait(m=>m.t==="error"||m.t==="joined");
    if (e.t!=="error") fail("41st player should be refused");

    // public matchmaking keeps games apart
    const p1=client("Pub1"); await p1.ready; await p1.wait(m=>m.t==="welcome"); p1.send({ t:"quick", game:"math" });
    const p2=client("Pub2"); await p2.ready; await p2.wait(m=>m.t==="welcome"); p2.send({ t:"quick", game:"cg" });
    const [a,b]=await Promise.all([p1.wait(m=>m.t==="joined"),p2.wait(m=>m.t==="joined")]);
    if (a.code===b.code||a.game!=="math"||b.game!=="cg") fail("public math/cg rooms got mixed");

    console.log(`OK: math race — 8 players × 3 rounds, shared seeds, rankings, final, host-only start, 40 cap, game separation`);
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),30000);
