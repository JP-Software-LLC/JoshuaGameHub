// Site analytics: page views / hub buttons / rooms / games are counted, only admins can read them.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=22100+(Math.random()*200|0), BASE=`http://127.0.0.1:${PORT}`;
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, DATABASE_URL:"", ALLOW_DEV_LINKS:"1",
  STATS_FLUSH_MS:200, ADMIN_EMAILS:"boss@school.test, other@x.test", MATH_COUNTDOWN_MS:200 }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,p,body,token){
  const r=await fetch(BASE+p,{ method, headers:{ "content-type":"application/json", ...(token?{ authorization:"Bearer "+token }:{}) }, body:body?JSON.stringify(body):undefined });
  return { status:r.status, ...(await r.json().catch(()=>({}))) };
}
async function signIn(email){
  const s=await api("POST","/api/auth/email",{ email });
  return (await api("POST","/api/auth/email/verify",{ token:new URL(s.devLink).searchParams.get("login") })).token;
}
function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[] };
  c.send=m=>ws.send(JSON.stringify(m));
  c.wait=pred=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>8000) return rej(new Error(name+" timeout")); setTimeout(p,15); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    await api("POST","/api/hit",{ view:"/" });
    await api("POST","/api/hit",{ view:"/math-race/", play:"practice" });
    await api("POST","/api/hit",{ view:"/math-race/", play:"practice" });
    await api("POST","/api/hit",{ view:"/../../etc/passwd" });            // not a real page: ignored
    await api("POST","/api/hit",{ mode:"student" }); await api("POST","/api/hit",{ mode:"hacker" });
    const A=client("Ann"); await A.ready; await A.wait(m=>m.t==="welcome"); A.send({ t:"create", game:"math" });
    const j=await A.wait(m=>m.t==="joined");
    const B=client("Ben"); await B.ready; await B.wait(m=>m.t==="welcome"); B.send({ t:"join", code:j.code }); await B.wait(m=>m.t==="joined");
    A.send({ t:"start" }); await A.wait(m=>m.t==="round");
    await sleep(400);
    if ((await api("GET","/api/admin/stats")).status!==401) fail("stats readable without signing in");
    if ((await api("GET","/api/admin/stats",null,await signIn("nobody@school.test"))).status!==403) fail("non-admin could read stats");
    const s=await api("GET","/api/admin/stats?days=7",null,await signIn("Boss@School.test"));
    const sum={}; for (const r of s.rows||[]) sum[r.metric]=(sum[r.metric]||0)+r.n;
    const want={ "view:/":1, "view:/math-race/?practice":2, "mode:student":1, "room:math:private":1, "join:math":2, "play:math":1 };
    for (const [k,v] of Object.entries(want)) if (sum[k]!==v) fail(`${k} = ${sum[k]}, expected ${v} · ${JSON.stringify(sum)}`);
    if (Object.keys(sum).some(k=>/passwd|hacker/.test(k))) fail("junk metric stored");
    if (!(sum.peak>=2)) fail("peak connections not recorded");
    if (s.totals.teachers!==2) fail("account totals wrong "+JSON.stringify(s.totals));
    console.log("OK: analytics — views, hub buttons, rooms, joins, games started, peak; admins only");
    // ---- admin: teacher list + read-only "view as"
    const boss=await signIn("boss@school.test"), nobodyTok=await signIn("nobody@school.test");
    await api("PATCH","/api/me",{ displayName:"Ms Nobody" },nobodyTok);
    const cls=await api("POST","/api/classes",{ name:"Room 4" },nobodyTok);
    if ((await api("GET","/api/admin/teachers",null,nobodyTok)).status!==403) fail("non-admin could list teachers");
    const tl=await api("GET","/api/admin/teachers",null,boss);
    const nb=(tl.teachers||[]).find(t=>t.email==="nobody@school.test");
    if (!nb||nb.display_name!=="Ms Nobody"||nb.classes!==1) fail("teacher list wrong "+JSON.stringify(tl));
    if ((await api("POST",`/api/admin/teachers/${nb.id}/view`,{},nobodyTok)).status!==403) fail("non-admin could view as");
    const v=await api("POST",`/api/admin/teachers/${nb.id}/view`,{},boss);
    const me=await api("GET","/api/me",null,v.token);
    if (!me.viewAs||me.teacher.email!=="nobody@school.test") fail("view-as /api/me wrong "+JSON.stringify(me));
    const cl=await api("GET","/api/classes",null,v.token);
    if (!(cl.classes||[]).some(c=>c.name==="Room 4")) fail("view-as can't see the teacher's classes");
    if ((await api("POST","/api/classes",{ name:"Sneaky" },v.token)).status!==403) fail("view-as could create a class");
    if ((await api("DELETE","/api/classes/"+(cls.class?cls.class.id:cls.id),{},v.token)).status!==403) fail("view-as could delete a class");
    if ((await api("DELETE","/api/me",{},v.token)).status!==403) fail("view-as could delete the account");
    // an admin's view-as token must not itself be an admin token
    const vb=await api("POST",`/api/admin/teachers/${tl.teachers.find(t=>t.email==="boss@school.test").id}/view`,{},boss);
    if ((await api("GET","/api/admin/teachers",null,vb.token)).status!==403) fail("view-as token acted as admin");
    if (((await api("GET","/api/classes",null,nobodyTok)).classes||[]).length!==1) fail("teacher's data changed");
    console.log("OK: admin teacher list + read-only view-as (admins only, no writes, not an admin token)");
    A.ws.close(); B.ws.close(); srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),30000);
