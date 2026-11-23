// Admin Students board: same first name + last initial = one student (any capitals), nicknames collected,
// rooms joined + games played counted from teacher rooms, admins only.
"use strict";
const PORT=23900+(Math.random()*300|0), BASE=`http://127.0.0.1:${PORT}`;
Object.assign(process.env,{ PORT:String(PORT), DATABASE_URL:"", ALLOW_DEV_LINKS:"1", ADMIN_EMAILS:"boss@school.test", CLASS_CLOSE_MS:"100", BEAR_COUNTDOWN_MS:"100" });
delete process.env.EMAIL_VERIFY;
const WebSocket=require("ws");
const fail=m=>{ console.error("FAIL:",m); process.exit(1); };
const origLog=console.log; console.log=(...a)=>{ if (!/^\[(game|bus|db|mail)/.test(String(a[0]))) origLog(...a); };
require("../server/index.js");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,p,body,token){
  const r=await fetch(BASE+p,{ method, headers:{ "content-type":"application/json", ...(token?{ authorization:"Bearer "+token }:{}) }, body:body?JSON.stringify(body):undefined });
  return { status:r.status, ...(await r.json().catch(()=>({}))) };
}
function client(hello){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[] };
  c.send=m=>ws.readyState===1&&ws.send(JSON.stringify(m));
  c.wait=(pred,ms=8000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error("timeout")); setTimeout(p,10); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send(hello); r(); }));
  return c;
}
async function classGame(teachTok,kids){
  const T=client({ t:"hello", name:"Teach", auth:teachTok }); await T.ready; await T.wait(m=>m.t==="welcome");
  T.send({ t:"create", game:"bear" }); const tj=await T.wait(m=>m.t==="joined"); T.send({ t:"teacher" }); await T.wait(m=>m.t==="lobby"&&m.teacher===tj.pid);
  const cs=[];
  for (const k of kids){ const c=client({ t:"hello", name:k.nick }); await c.ready; await c.wait(m=>m.t==="welcome");
    c.send({ t:"join", code:tj.code }); await c.wait(m=>m.t==="whoareyou"); c.send({ t:"iam", ...k, school:"" }); await c.wait(m=>m.t==="iamok"); cs.push(c); }
  T.send({ t:"start" }); await sleep(30); T.send({ t:"start" }); await T.wait(m=>m.t==="start"); await sleep(300);
  for (const c of [T,...cs]){ c.send({ t:"leave" }); c.ws.close(); }
}
setTimeout(async()=>{
  try {
    await api("POST","/api/auth/register",{ email:"boss@school.test", password:"Head-Strong-71", question:"pet", answer:"Rex" });
    const boss=(await api("POST","/api/auth/password",{ email:"boss@school.test", password:"Head-Strong-71" })).token;
    const teach=(await api("POST","/api/auth/register",{ email:"t@school.test", password:"Teach-Good-55", question:"pet", answer:"Rex", displayName:"Ms T" })).token;
    await classGame(teach,[{ first:"Ada", last:"L", nick:"Ace" },{ first:"Bo", last:"M", nick:"Bolt" }]);
    await classGame(teach,[{ first:"ADA", last:"l", nick:"Rocket" }]);                  // same child, other capitals + nickname
    await sleep(300);
    if ((await api("GET","/api/admin/students",null,teach)).status!==403) fail("non-admin could read the students board");
    const d=await api("GET","/api/admin/students?days=7",null,boss);
    if (d.status!==200) fail("admin read failed: "+d.error);
    if (d.totals.students!==2) fail("Ada L. twice + Bo M. = 2 unique students, got "+d.totals.students+" "+JSON.stringify(d.students.map(s=>s.key)));
    const ada=d.students.find(s=>s.key==="ada|L"), bo=d.students.find(s=>s.key==="bo|M");
    if (!ada || ada.joins!==2 || ada.plays!==2 || ada.games.bear!==2 || ada.favorite!=="bear") fail("Ada: 2 rooms, 2 bear games expected: "+JSON.stringify(ada));
    if (!ada.nicknames.includes("Ace") || !ada.nicknames.includes("Rocket")) fail("Ada's nicknames should be collected");
    if (!ada.teachers.includes("Ms T")) fail("teacher name should be shown");
    if (!bo || bo.joins!==1 || bo.plays!==1) fail("Bo: 1 room, 1 game");
    if (d.totals.joins!==3 || d.totals.plays!==3) fail("totals: 3 joins, 3 plays");
    console.log("OK: admin students board — first name + last initial = one student (any capitals), nicknames, teachers, rooms joined, games played, favourite game; admins only");
    process.exit(0);
  } catch(e){ fail(e.stack||e.message); }
},800);
setTimeout(()=>fail("timeout"),60000);
