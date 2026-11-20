// Teacher Mode across every 40-player game: the teacher's room has auto-start off, the teacher is
// never in the game or the rankings, students can't become the teacher, and public rooms refuse it.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=21700+(Math.random()*200|0);
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT,
  MATH_COUNTDOWN_MS:200, MATH_ROUND_MS:400, MATH_GRACE_MS:200, MATH_RESULTS_MS:200, ARROW_ROUND_MS:400,
  RUSH_COUNTDOWN_MS:200, RUSH_AFTER_FIRST_MS:400, BEAR_COUNTDOWN_MS:200, MEM_COUNTDOWN_MS:200, WORDS_COUNTDOWN_MS:200, CLASS_CLOSE_MS:200 }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[], name };
  c.send=m=>ws.send(JSON.stringify(m));
  c.wait=(pred,ms=8000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,15); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}
async function room(kind,before){
  const T=client("Teacher"); await T.ready; await T.wait(m=>m.t==="welcome"); T.send({ t:"create", game:kind });
  const j=await T.wait(m=>m.t==="joined"); T.pid=j.pid; T.send({ t:"teacher" });
  const kids=[];
  for (const n of ["Ann","Ben"]){ const c=client(n); await c.ready; await c.wait(m=>m.t==="welcome"); c.send({ t:"join", code:j.code }); c.pid=(await c.wait(m=>m.t==="joined")).pid; kids.push(c); }
  kids[0].send({ t:"teacher" });                                   // a student can't take over
  await sleep(300);
  const L=T.msgs.filter(m=>m.t==="lobby").pop();
  if (L.teacher!==T.pid) fail(kind+": teacher not set (or a student took it)");
  if (L.autoIn) fail(kind+": auto-start should be off in Teacher Mode");
  kids[0].send({ t:"start" }); await sleep(250);
  if (T.msgs.some(m=>["round","go","start"].includes(m.t)&&m.t!=="lobby")) fail(kind+": a student was able to start");
  if (before) await before(T,kids);
  T.send({ t:"start" });
  return { T, kids, code:j.code };
}
const close=all=>all.forEach(c=>c.ws.close());
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    // Math Race + Arrow Blitz: final ranking never includes the teacher
    for (const kind of ["math","arrows"]){
      const { T, kids }=await room(kind);
      const rounds=kind==="math"?3:1;
      for (let r=1;r<=rounds;r++){ await kids[0].wait(m=>m.t==="round"&&m.n===r); kids.forEach((c,i)=>c.send({ t:"score", round:r, n:3+i })); }
      const fin=await T.wait(m=>m.t==="final",10000);
      if (fin.rank.length!==2||fin.rank.some(e=>e.pid===T.pid)) fail(kind+": teacher in the ranking");
      close([T,...kids]);
    }
    // Rush Hour + Hurdle Dash: teacher not a racer; race ends when the students finish
    for (const kind of ["rush","hurdle","typing","hoops"]){
      const { T, kids }=await room(kind);
      const go=await T.wait(m=>m.t==="go");
      if (kind==="typing"&&go.dist!==22) fail("typing: race should be 22 words");
      if (go.teacher!==T.pid||go.players.some(p=>p.pid===T.pid)||go.players.length!==2) fail(kind+": teacher listed as a racer");
      await sleep(400); kids.forEach((c,i)=>c.send({ t:"finish", time:30+i, extra:2 }));
      const res=await T.wait(m=>m.t==="results",5000);
      if (res.rank.length!==2||res.rank.some(e=>e.pid===T.pid)) fail(kind+": teacher in the results");
      close([T,...kids]);
    }
    // Bear Attack! + Memory Tiles: teacher is not in the game state
    { const { T, kids }=await room("bear");
      const st=await T.wait(m=>m.t==="start"); if (st.teacher!==T.pid||st.players.some(p=>p.pid===T.pid)) fail("bear: teacher listed as a player");
      const s=await T.wait(m=>m.t==="s"&&m.s.p); if (s.s.p.length!==2||s.s.p.some(q=>q[0]===T.pid)) fail("bear: teacher on the ice");
      close([T,...kids]); }
    { const { T, kids }=await room("sky");
      const st=await T.wait(m=>m.t==="start"); if (st.teacher!==T.pid||st.players.some(p=>p.pid===T.pid)||!st.seed) fail("sky: teacher listed as a player / no seed");
      const s=await T.wait(m=>m.t==="s"&&m.s.p); if (s.s.p.length!==2||s.s.p.some(q=>q[0]===T.pid)) fail("sky: teacher is flying");
      close([T,...kids]); }
    { const { T, kids }=await room("words",async (T,kids)=>{
        kids[0].send({ t:"words", text:"cat,dog" });                                     // students can't set the list
        T.send({ t:"words", title:"Week 5", text:"photosynthesis\nchlorophyll, sunlight;  oxygen\nx\nwaytoolongwordforthegrid\nOXYGEN" });
        const ok=await T.wait(m=>m.t==="wordsOk"); if (ok.n!==4||ok.skipped.length!==2) fail("words: list not cleaned "+JSON.stringify(ok));
        if (kids[0].msgs.some(m=>m.t==="wordsOk")) fail("words: student set the list"); });
      const st=await T.wait(m=>m.t==="start"); if (st.teacher!==T.pid||st.players.some(p=>p.pid===T.pid)||!st.board||st.board.words.length!==4||st.board.theme!=="Week 5") fail("words: teacher listed as a player / custom list not used");
      if (st.players.map(p=>p.color).sort().join()!=="0,1") fail("words: students should get the first two colours");
      const W=require("../shared/wordsearch.js");   // claim a real word: find it in the sent grid
      const B={ ...st.board }, word=B.words[0]; let hit=null;
      for (let r=0;r<B.rows&&!hit;r++) for (let c=0;c<B.cols&&!hit;c++) for (const [dr,dc] of W.DIRS){ const a=[r,c,r+dr*(word.length-1),c+dc*(word.length-1)]; if (W.readLine(B,a)===word){ hit=a; break; } }
      await sleep(300); T.send({ t:"claim", a:hit }); kids[0].send({ t:"claim", a:hit }); kids[1].send({ t:"claim", a:hit });
      const f=await T.wait(m=>m.t==="f"); if (f.pid!==kids[0].pid) fail("words: first claimer should get the word (teacher can't claim)");
      await sleep(200); if (T.msgs.filter(m=>m.t==="f").length!==1) fail("words: a word was claimed twice");
      if (!kids[1].msgs.some(m=>m.t==="miss")) fail("words: second claimer not told they missed");
      close([T,...kids]); }
    { const { T, kids }=await room("darts");
      const st=await T.wait(m=>m.t==="start"); if (st.teacher!==T.pid||st.players.some(p=>p.pid===T.pid)) fail("darts: teacher listed as a player");
      const s=await T.wait(m=>m.t==="s"&&m.s.p); if (s.s.p.length!==2||s.s.p.some(q=>q[0]===T.pid)) fail("darts: teacher on the field");
      close([T,...kids]); }
    { const { T, kids }=await room("cannons");
      const st=await T.wait(m=>m.t==="start"); if (st.teacher!==T.pid||st.players.some(p=>p.pid===T.pid)) fail("cannons: teacher listed as a player");
      const s=await T.wait(m=>m.t==="s"&&m.s.p); if (s.s.p.length!==2||s.s.p.some(q=>q[0]===T.pid)) fail("cannons: teacher has a cannon");
      close([T,...kids]); }
    { const { T, kids }=await room("memory");
      const st=await T.wait(m=>m.t==="start"); if (st.teacher!==T.pid||st.players.some(p=>p.pid===T.pid)) fail("memory: teacher listed as a player");
      if (T.msgs.some(m=>m.t==="me")) fail("memory: teacher was given a tile");
      close([T,...kids]); }
    // students still typing their names show as pending · Start counts down first · digits filter · late joiners · live leaderboard
    { const { T, kids, code }=await room("math",async (T,kids)=>{
        const L=T.msgs.filter(m=>m.t==="lobby").pop();
        if (L.players.filter(p=>p.pending).length!==2) fail("pending: students without a name should show as pending");
        kids[0].send({ t:"iam", first:"Ann", last:"B", nick:"Rocket" }); await sleep(150);
        const L2=T.msgs.filter(m=>m.t==="lobby").pop(); if (L2.players.find(p=>p.pid===kids[0].pid).pending) fail("pending: named student still pending");
        kids[0].send({ t:"digits", d:"2" }); T.send({ t:"digits", d:"2" }); await sleep(100); });
      await T.wait(m=>m.t==="lobby"&&m.closeIn>0);                                 // countdown shown before the race
      const r1=await kids[0].wait(m=>m.t==="round"&&m.n===1); if (r1.digits!=="2") fail("digits: teacher's choice not sent");
      const late=client("Late"); await late.ready; await late.wait(m=>m.t==="welcome"); late.send({ t:"join", code });
      await late.wait(m=>m.t==="joined"); const lr=await late.wait(m=>m.t==="round"); if (lr.n!==1||lr.dur>400||lr.dur<=0) fail("late join: should jump into the current round "+JSON.stringify(lr));
      kids[0].send({ t:"prog", round:1, n:5 }); kids[1].send({ t:"prog", round:1, n:2 });
      const b=await T.wait(m=>m.t==="board"&&m.rows.length===3&&m.rows[0].v==="5 correct"); if (b.code!==code||b.rows[0].pid!==kids[0].pid) fail("board: wrong live leaderboard");
      close([T,...kids,late]); }
    // public rooms refuse Teacher Mode
    { const P=client("Pub"); await P.ready; await P.wait(m=>m.t==="welcome"); P.send({ t:"quick", game:"memory" }); await P.wait(m=>m.t==="joined");
      P.send({ t:"teacher" }); await sleep(250); if (P.msgs.filter(m=>m.t==="lobby").pop().teacher) fail("public room accepted a teacher"); P.ws.close(); }
    console.log("OK: teacher mode — math, arrows, rush, hurdle, typing, bear, cannons, darts, sky, words, memory: teacher runs it, never plays or ranks, auto-start off, students can't take over, public rooms refuse");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),60000);
