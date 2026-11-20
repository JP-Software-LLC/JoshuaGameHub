// Marble Munch end to end: rules (marbles always reach the rim, everyone can catch, right = keep, wrong/slow = spit),
// then a Teacher Mode room: host-only settings (mode, digits, 2–10 s question timer), the teacher never plays,
// questions go only to the catcher, the game ends when every marble is kept, results rank by marbles.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const M=require("../shared/munch.js");
const fail=m=>{ console.error("FAIL:",m); try{ srv.kill(); }catch{} process.exit(1); };

// ---------- rules
for (const n of [2,8,40]){
  const g=new M.Game(Array.from({length:n},(_,i)=>({ id:i+1, name:"b"+i })),{ seed:n*13 });
  if (g.total!==Math.max(12,n*3)) fail("marbles should be 3 per player (min 12)");
  const bots=g.players.map((p,i)=>M.makeBot(i+1,i/(n-1))), dt=1/40; let maxR=0;
  while (g.phase==="play"){ g.players.forEach((p,i)=>M.botThink(g,p,bots[i],dt)); g.step(dt); g.drainEvents(); for (const m of g.marbles) maxR=Math.max(maxR,Math.hypot(m.x,m.y)); }
  if (g.time>=M.T.maxT-1) fail(n+" bots: game never finished (marbles stuck out of reach?)");
  if (g.eaten!==g.total || g.ranking().reduce((a,r)=>a+r.score,0)!==g.total) fail(n+": every marble should be kept exactly once");
  if (n===40 && (g.time<60 || g.time>180)) fail("40 players should take ~1–3 min, took "+g.time.toFixed(0)+" s");
}
{ // nobody chomping: every marble keeps rolling out to the rim (ellipses never shrink into a circle in the middle)
  const g=new M.Game(Array.from({length:8},(_,i)=>({ id:i+1, name:"b"+i })),{ seed:9 }), far=new Map();
  for (let i=0;i<40*60;i++){ g.step(1/40); for (const m of g.marbles) far.set(m.id,Math.max(far.get(m.id)||0,Math.hypot(m.x,m.y))); }
  if (far.size<6 || [...far.values()].some(r=>r<M.T.R-M.T.reach)) fail("every marble should reach the hippos' jaws: "+[...far.values()].map(r=>r.toFixed(1)));
}
{ // right keeps it, wrong spits it back, too slow spits it back
  const g=new M.Game([{ id:1, name:"A" },{ id:2, name:"B" }],{ seed:3, qTime:3 });
  const catchOne=()=>{ for (let i=0;i<4000;i++){ g.chomp(1); g.step(1/40); const e=g.drainEvents().find(x=>x.type==="catch"&&x.id===1); if (e) return e; } fail("never caught a marble"); };
  let e=catchOne(); if (e.t!==3) fail("question timer should be the teacher's setting");
  if (g.chomp(1)) fail("can't chomp while answering");
  const inBowl=g.marbles.length; g.answer(1,g.players[0].q.s); if (g.players[0].score!==1 || g.eaten!==1) fail("right answer should keep it");
  if (g.marbles.length!==inBowl) fail("a kept marble doesn't go back");
  catchOne(); const before=g.marbles.length; g.answer(1,g.players[0].q.s+1);
  if (g.players[0].score!==1 || g.marbles.length!==before+1 || g.players[0].q) fail("wrong answer should spit it back");
  catchOne(); const b2=g.marbles.length; for (let i=0;i<3.2*40;i++) g.step(1/40);
  if (g.players[0].q || g.players[0].slow!==1 || g.marbles.length<b2+1) fail("too slow should spit it back");
}
console.log("OK: marble munch rules — every marble reaches the rim, 3 per player, right = keep, wrong/slow = spit, 40 players ≈ 1–2 min");

// ---------- online, Teacher Mode
const PORT=22800+(Math.random()*300|0);
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, MUNCH_COUNTDOWN_MS:200, CLASS_CLOSE_MS:200 }, stdio:["ignore","pipe","inherit"] });
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[], name };
  c.send=m=>ws.readyState===1&&ws.send(JSON.stringify(m));
  c.wait=(pred,ms=8000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,15); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}
const toN=v=>typeof v==="string"?Math.round(parseFloat(v.slice(1))*100):v;
const solve=q=>{ const a=toN(q.top), b=toN(q.bottom); return q.op==="+"?a+b:q.op==="−"?a-b:q.op==="×"?a*b:a/b; };
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    const T=client("Teach"); await T.ready; await T.wait(m=>m.t==="welcome"); T.send({ t:"create", game:"munch" });
    const tj=await T.wait(m=>m.t==="joined"); T.send({ t:"teacher" }); await T.wait(m=>m.t==="lobby"&&m.teacher===tj.pid);
    const kids=[client("Ann"),client("Bo")];
    for (const k of kids){ await k.ready; await k.wait(m=>m.t==="welcome"); k.send({ t:"join", code:tj.code }); k.pid=(await k.wait(m=>m.t==="joined")).pid; }
    // settings: host only, within 2–10 s
    kids[0].send({ t:"qtime", s:9 }); kids[0].send({ t:"mode", mode:"mul" });
    T.send({ t:"qtime", s:1 }); T.send({ t:"qtime", s:11 }); T.send({ t:"qtime", s:6 }); T.send({ t:"mode", mode:"money" });
    await sleep(300);
    const L=T.msgs.filter(m=>m.t==="lobby").pop();
    if (L.qtime!==6 || L.mode!=="money") fail("host settings: qtime 6 + money expected, got "+L.qtime+" "+L.mode);
    T.send({ t:"start" }); await sleep(30); T.send({ t:"start" });
    const st=await T.wait(m=>m.t==="start");
    if (st.teacher!==tj.pid || st.players.some(p=>p.pid===tj.pid) || st.players.length!==2 || st.qtime!==6) fail("teacher listed as a player / qtime not sent");
    const s0=await T.wait(m=>m.t==="s"); if (s0.s.p.length!==2 || s0.s.total!==12) fail("2 hippos and 12 marbles expected");
    // students mash Space and answer every question right (Ann) or wrong once first (Bo)
    let boWrong=false;
    const spam=setInterval(()=>{ for (const k of kids) k.send({ t:"fire" }); },60);
    for (const k of kids) k.seen=0;
    const answerLoop=setInterval(()=>{ for (const k of kids){ const qs=k.msgs.filter(m=>m.t==="q"); if (qs.length>k.seen){ const q=qs[qs.length-1].q; k.seen=qs.length;
      if (!q.money) fail("questions should be money questions");
      const right=solve(q); if (k===kids[1] && !boWrong){ boWrong=true; k.send({ t:"ans", v:right+1 }); } else k.send({ t:"ans", v:right }); } } },40);
    const res=await T.wait(m=>m.t==="results",170000).catch(e=>{ const s=T.msgs.filter(m=>m.t==="s").pop(); fail("no results: "+JSON.stringify(s&&s.s.left)+" "+JSON.stringify(kids.map(k=>k.msgs.filter(m=>m.t!=="s").map(m=>m.t)))); });
    clearInterval(spam); clearInterval(answerLoop);
    if (T.msgs.some(m=>m.t==="q")) fail("the teacher should never get a question");
    for (const k of kids) for (const q of k.msgs.filter(m=>m.t==="q")) if (q.q.s!=null) fail("questions must not include the answer");
    if (!kids[1].msgs.some(m=>m.t==="res"&&m.ok===false)) fail("a wrong answer should be told");
    if (res.rank.length!==2 || res.rank.some(e=>e.pid===tj.pid)) fail("teacher in the results");
    if (res.rank[0].score+res.rank[1].score!==12 || res.rank[0].score<res.rank[1].score) fail("results should rank by marbles kept: "+JSON.stringify(res.rank));
    console.log("OK: marble munch online — host-only mode + 2–10 s timer, teacher never plays, questions only to the catcher, ends when every marble is kept, ranked by marbles");
    srv.kill(); process.exit(0);
  } catch(e){ fail(e.stack||e.message); }
});
setTimeout(()=>fail("timeout"),200000);
