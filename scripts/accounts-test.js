// Teacher accounts end-to-end (in-memory PGlite): email login, classes, a signed-in teacher's Math Race
// saving automatically (with per-question logs), students recognised next time by device, an anonymous
// teacher's game claimed later via "See class results", and secure co-teacher sharing.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=22100+(Math.random()*300|0), BASE=`http://127.0.0.1:${PORT}`;
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, DATABASE_URL:"", ALLOW_DEV_LINKS:"1",
  MATH_COUNTDOWN_MS:150, MATH_ROUND_MS:300, MATH_GRACE_MS:200, MATH_RESULTS_MS:150 }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,p,body,token){
  const r=await fetch(BASE+p,{ method, headers:{ "content-type":"application/json", ...(token?{ authorization:"Bearer "+token }:{}) }, body:body?JSON.stringify(body):undefined });
  return { status:r.status, ...(await r.json()) };
}
async function login(email){
  const s=await api("POST","/api/auth/email",{ email }); if (!s.devLink) fail("no login link");
  const v=await api("POST","/api/auth/email/verify",{ token:new URL(s.devLink).searchParams.get("login") }); if (!v.token) fail("verify failed: "+v.error);
  const again=await api("POST","/api/auth/email/verify",{ token:new URL(s.devLink).searchParams.get("login") }); if (again.status!==400) fail("login link worked twice");
  return v.token;
}
function client(name,token,auth){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[], name };
  c.send=m=>ws.send(JSON.stringify(m));
  c.wait=(pred,ms=8000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,15); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name, token, auth }); r(); }));
  return c;
}
// one Teacher Mode Math Race: teacher (optionally signed in + class) + 2 students who answer "who are you?"
async function playMath(auth,classId,kids){
  const T=client("Teacher",undefined,auth); await T.ready; await T.wait(m=>m.t==="welcome"); T.send({ t:"create", game:"math" });
  const j=await T.wait(m=>m.t==="joined"); T.send({ t:"teacher", classId }); await sleep(150);
  const out=[];
  for (const k of kids){ const c=client(k.nick,k.device); await c.ready; await c.wait(m=>m.t==="welcome"); c.send({ t:"join", code:j.code });
    await c.wait(m=>m.t==="joined"); const w=await c.wait(m=>m.t==="whoareyou"); c.who=w;
    c.send({ t:"iam", first:k.first, last:k.last, nick:k.nick }); await c.wait(m=>m.t==="iamok"); out.push(c); }
  T.send({ t:"start" });
  for (let r=1;r<=3;r++){ await out[0].wait(m=>m.t==="round"&&m.n===r);
    out.forEach((c,i)=>c.send({ t:"score", round:r, n:4+i, log:[{ q:"7+5", a:12, g:i?"12":"13", ok:!!i, ms:900 },{ q:"20+30", a:50, g:"50", ok:true, ms:700 }] })); }
  const cr=await T.wait(m=>m.t==="classresults",10000);
  [T,...out].forEach(c=>c.ws.close());
  return { cr, kids:out };
}
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    // 1. sign in, set school, make a class
    const A=await login("Teacher.One@School.org");
    const sch=await api("GET","/api/schools"); if (!sch.schools.length) fail("no schools");
    const me=await api("PATCH","/api/me",{ displayName:"Ms One", schoolId:sch.schools[0].id },A); if (me.teacher.schoolId!==sch.schools[0].id) fail("school not saved");
    if ((await api("PATCH","/api/me",{ schoolId:"not-a-school" },A)).teacher.schoolId!==null) fail("unknown school accepted");
    const cls=(await api("POST","/api/classes",{ name:"5B" },A)).class;
    // 2. signed-in teacher + class → saved automatically
    const kids=[{ first:"sam", last:"b", nick:"Rocket", device:"dev-sam" },{ first:"Sam", last:"K", nick:"Zoom", device:"dev-samk" }];
    const g1=await playMath(A,cls.id,kids);
    if (!g1.cr.sessionId) fail("signed-in game should save straight away");
    const det=await api("GET","/api/sessions/"+g1.cr.sessionId,null,A);
    if (det.results.length!==2) fail("expected 2 results");
    const names=det.results.map(r=>`${r.first_name} ${r.last_initial}. (${r.nickname})`).sort().join(" | ");
    if (names!=="Sam B. (Rocket) | Sam K. (Zoom)") fail("names wrong: "+names);
    if (!det.results.every(r=>Array.isArray(r.log)&&r.log.length===6)) fail("per-question logs missing");
    // 3. next game: devices are recognised
    const g2=await playMath(A,cls.id,kids);
    if (!g2.kids[0].who.known||g2.kids[0].who.known.first!=="Sam"||g2.kids[0].who.known.last!=="B") fail("returning student not recognised");
    const studs=await api("GET",`/api/classes/${cls.id}/students`,null,A);
    if (studs.students.length!==2||studs.students.some(s=>s.games!==2)) fail("students should be 2, each with 2 games: "+JSON.stringify(studs.students));
    // 4. anonymous teacher → claim later
    const g3=await playMath(undefined,undefined,[{ first:"Ana", last:"P", nick:"Star", device:"dev-ana" }]);
    if (!g3.cr.claim) fail("anonymous game should give a claim");
    if ((await api("GET","/api/pending/"+g3.cr.claim)).players!==1) fail("pending game not found");
    const saved=await api("POST",`/api/pending/${g3.cr.claim}/save`,{ classId:cls.id },A); if (!saved.sessionId) fail("claim failed: "+saved.error);
    if ((await api("GET","/api/pending/"+g3.cr.claim)).status!==404) fail("claim should be used up");
    // 5. sharing
    const B=await login("coteacher@school.org"), X=await login("someone.else@school.org");
    if ((await api("GET","/api/sessions/"+g1.cr.sessionId,null,B)).status!==404) fail("non-member could read results");
    const inv=await api("POST",`/api/classes/${cls.id}/invites`,{ email:"coteacher@school.org" },A);
    const tok=new URL(inv.devLink).searchParams.get("invite");
    if ((await api("POST","/api/invites/accept",{ token:tok },X)).status!==403) fail("wrong email accepted an invite");
    const acc=await api("POST","/api/invites/accept",{ token:tok },B); if (acc.classId!==cls.id) fail("invite accept failed: "+acc.error);
    if ((await api("POST","/api/invites/accept",{ token:tok },B)).status!==400) fail("invite worked twice");
    if ((await api("GET","/api/sessions/"+g1.cr.sessionId,null,B)).results.length!==2) fail("co-teacher can't see results");
    if ((await api("DELETE","/api/sessions/"+g1.cr.sessionId,null,B)).status!==403) fail("co-teacher deleted a game");
    if ((await api("POST",`/api/classes/${cls.id}/invites`,{ email:"x@y.org" },B)).status!==403) fail("co-teacher could invite");
    const members=await api("GET",`/api/classes/${cls.id}/members`,null,A); const bId=members.members.find(m=>m.email==="coteacher@school.org").id;
    await api("DELETE",`/api/classes/${cls.id}/members/${bId}`,null,A);
    if ((await api("GET","/api/sessions/"+g1.cr.sessionId,null,B)).status!==404) fail("removed co-teacher still has access");
    if ((await api("GET","/api/me")).status!==401) fail("no token should be 401");
    console.log("OK: accounts — email login (single use), school, class, auto-save with logs, returning students, claim later, secure co-teacher sharing");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),60000);
