// Memory Tiles end-to-end: 3 players. Positions stay private until the reveal; the one player on a
// matching tile survives, the others are out, the game ends and ranks the survivor first.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const MEMORY=require("../shared/memory.js");
const PORT=21300+(Math.random()*300|0);
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, MEM_COUNTDOWN_MS:200 }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[], name };
  c.send=m=>ws.send(JSON.stringify(m));
  c.wait=(pred,ms=20000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,20); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}
// walk a client to a target cell using tile{dx,dy}
async function walk(c,to){ let me=c.msgs.filter(m=>m.t==="me").pop(); for (let k=0;k<12;k++){ const dx=Math.sign(to.x-me.x), dy=dx?0:Math.sign(to.y-me.y); if (!dx&&!dy) return; c.send({ t:"tile", dx, dy }); me=await c.wait(m=>m.t==="me"&&(m.x!==me.x||m.y!==me.y)&&c.msgs.indexOf(m)>c.msgs.lastIndexOf(me),3000); } }
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    const all=[]; let code;
    for (let i=0;i<3;i++){ const c=client("P"+i); await c.ready; await c.wait(m=>m.t==="welcome"); c.send(i?{ t:"join", code }:{ t:"create", game:"memory" });
      const j=await c.wait(m=>m.t==="joined"); if (j.game!=="memory") fail("game should be memory"); code=j.code; c.pid=j.pid; all.push(c); }
    all[0].send({ t:"start" });
    const rd=await all[0].wait(m=>m.t==="round");
    if (new Set(rd.tiles).size!==2) fail("round 1 should use 2 pictures");
    await Promise.all(all.map(c=>c.wait(m=>m.t==="decide")));
    const N=MEMORY.T.N, good=rd.tiles.findIndex(t=>t===rd.target), bad=rd.tiles.findIndex(t=>t!==rd.target);
    await walk(all[0],{ x:good%N, y:(good/N)|0 });
    await walk(all[1],{ x:bad%N, y:(bad/N)|0 }); await walk(all[2],{ x:bad%N, y:(bad/N)|0 });
    // privacy: before the reveal nobody has received anyone else's position
    for (const c of all) if (c.msgs.some(m=>m.t==="result")) fail("result came too early");
    for (const c of all) if (c.msgs.some(m=>m.t==="me"&&m.pid&&m.pid!==c.pid)) fail("leaked a position");
    const res=await all[1].wait(m=>m.t==="result");
    if (res.pos.length!==3) fail("reveal should show all 3 players");
    if (!(res.out.includes(all[1].pid)&&res.out.includes(all[2].pid)&&!res.out.includes(all[0].pid))) fail("wrong players out: "+JSON.stringify(res.out));
    const fin=await all[0].wait(m=>m.t==="final");
    if (fin.rank[0].name!=="P0"||!fin.rank[0].alive) fail("survivor should rank first");
    console.log("OK: memory tiles — 2 pictures in round 1, positions private until reveal, off-picture players out, survivor wins");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),45000);
