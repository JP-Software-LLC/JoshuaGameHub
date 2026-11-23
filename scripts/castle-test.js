// Castles, schools and tournaments.
//  1. in-process: raw scores → bricks (races turned "higher is better"; an average result ≈ 100 bricks in ANY game)
//  2. server: admins edit the school list; saved Teacher Mode games add bricks to the teacher's castle;
//     the public school page; a tournament is won by the first castle to the goal.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const C=require("../server/classdata");
const fail=m=>{ console.error("FAIL:",m); if (typeof srv!=="undefined"&&srv) srv.kill(); process.exit(1); };
let srv=null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function unit(){
  const r=C.rawValues("rush",[{ stats:{ finished:true, time:60 } },{ stats:{ finished:true, time:120 } },{ stats:{ finished:false, percent:40 } }]);
  if (r[0]!==200||r[1]!==150||r[2]!==40) fail("race raw values "+r);
  // simulate many games: very different raw scales must end up at ~100 bricks for an average student
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const avgBricks={};
  for (const [game,lo,hi] of [["math",10,70],["cannons",500,6000],["memory",1,9]]){
    let sum=0,cnt=0;
    for (let g=0;g<60;g++){ const raws=Array.from({ length:25 },()=>rnd(lo,hi)); const b=await C.bricksFor(game,raws); if (g>=30){ sum+=b.reduce((x,y)=>x+y,0); cnt+=b.length; } }
    avgBricks[game]=sum/cnt;
  }
  for (const [g,v] of Object.entries(avgBricks)) if (Math.abs(v-100)>12) fail(`average ${g} student got ${v.toFixed(1)} bricks, expected ~100 `+JSON.stringify(avgBricks));
  console.log("OK: bricks — races scored by speed, every game's average student ≈ 100 bricks "+JSON.stringify(Object.fromEntries(Object.entries(avgBricks).map(([k,v])=>[k,Math.round(v)]))));
}

const PORT=22400+(Math.random()*300|0), BASE=`http://127.0.0.1:${PORT}`;
async function api(method,p,body,token){
  const r=await fetch(BASE+p,{ method, headers:{ "content-type":"application/json", ...(token?{ authorization:"Bearer "+token }:{}) }, body:body?JSON.stringify(body):undefined });
  return { status:r.status, ...(await r.json()) };
}
async function login(email){
  const s=await api("POST","/api/auth/email",{ email }); if (!s.devLink) fail("no login link");
  const v=await api("POST","/api/auth/email/verify",{ token:new URL(s.devLink).searchParams.get("login") }); if (!v.token) fail("verify failed: "+v.error);
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
    c.send({ t:"iam", first:k.first, last:k.last, nick:k.nick, school:k.school }); await c.wait(m=>m.t==="iamok"); out.push(c); }
  T.send({ t:"start" });
  for (let r=1;r<=3;r++){ await out[0].wait(m=>m.t==="round"&&m.n===r);
    out.forEach((c,i)=>c.send({ t:"score", round:r, n:4+i, log:[{ q:"7+5", a:12, g:i?"12":"13", ok:!!i, ms:900 },{ q:"20+30", a:50, g:"50", ok:true, ms:700 }] })); }
  const cr=await T.wait(m=>m.t==="classresults",10000);
  [T,...out].forEach(c=>c.ws.close());
  return { cr, kids:out };
}

async function e2e(){
  srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, DATABASE_URL:"", ALLOW_DEV_LINKS:"1", CLASS_CLOSE_MS:200, ADMIN_EMAILS:"boss@school.test",
    MATH_COUNTDOWN_MS:150, MATH_ROUND_MS:300, MATH_GRACE_MS:200, MATH_RESULTS_MS:150 }, stdio:["ignore","pipe","inherit"] });
  await new Promise(res=>srv.stdout.on("data",d=>{ if (/listening/.test(d)) res(); }));
  const boss=await login("boss@school.test"), A=await login("ms.a@school.test"), B=await login("mr.b@school.test");
  // ---- schools: admins only
  if ((await api("POST","/api/admin/schools",{ name:"Sneaky School", state:"TX" },A)).status!==403) fail("non-admin added a school");
  const sc=(await api("POST","/api/admin/schools",{ name:"Maple Grove Elementary", state:"or" },boss)).school;
  if (!sc||sc.state!=="OR") fail("school not added "+JSON.stringify(sc));
  if (!(await api("GET","/api/schools")).schools.some(s=>s.id===sc.id)) fail("new school not in the public list");
  // student sign-in by school email: name + school come from the email
  if ((await api("POST","/api/student/email",{ email:"maria.lopez27@student.maplegrove.org" })).status!==400) fail("unknown domain accepted");
  await api("PATCH","/api/admin/schools/"+sc.id,{ name:sc.name, state:"OR", domains:"@maplegrove.org, junk" },boss);
  const em=await api("POST","/api/student/email",{ email:" Maria.Lopez27@Student.MapleGrove.org " });
  if (em.first!=="Maria"||em.last!=="L"||em.school!==sc.id) fail("email sign-in "+JSON.stringify(em));
  const em1=await api("POST","/api/student/email",{ email:"jsmith@maplegrove.org" });
  if (em1.first!=="Jsmith"||em1.last!==""||em1.school!==sc.id) fail("one-word email "+JSON.stringify(em1));
  if ((await api("POST","/api/student/email",{ email:"kid@maplegrove.org.evil.com" })).status!==400) fail("look-alike domain accepted");
  if ((await api("PATCH","/api/admin/schools/"+sc.id,{ name:"Maple Grove Elem", state:"OR" },boss)).school.name!=="Maple Grove Elem") fail("rename failed");
  for (const [t,name] of [[A,"Ms A"],[B,"Mr B"]]) await api("PATCH","/api/me",{ displayName:name, schoolId:sc.id },t);
  if ((await api("DELETE","/api/admin/schools/"+sc.id,{},boss)).status!==409) fail("removed a school teachers use");
  const cls=(await api("POST","/api/classes",{ name:"Room 1" },A)).class;
  // ---- tournament
  if ((await api("POST",`/api/admin/schools/${sc.id}/tournament`,{ name:"Castle Cup", goal:150 },A)).status!==403) fail("non-admin started a tournament");
  const tn=await api("POST",`/api/admin/schools/${sc.id}/tournament`,{ name:"Castle Cup", goal:150 },boss); if (!tn.id) fail("tournament not started "+JSON.stringify(tn));
  if ((await api("POST",`/api/admin/schools/${sc.id}/tournament`,{ name:"Second", goal:500 },boss)).status!==409) fail("two tournaments at once");
  const kids=[{ first:"Ann", last:"B", nick:"Rocket", device:"dev-ann", school:sc.id },{ first:"Cal", last:"D", nick:"Comet", device:"dev-cal", school:sc.id }];
  const g1=await playMath(A,cls.id,kids);
  if (!(g1.cr.bricks>0)) fail("no bricks in classresults "+JSON.stringify(g1.cr));
  if (g1.kids[1].who.school!==sc.id) fail("whoareyou didn't carry the teacher's school");
  const me=await api("GET","/api/me",null,A); if (me.castle.bricks!==g1.cr.bricks||me.castle.games!==1) fail("castle not updated "+JSON.stringify(me.castle));
  let page=await api("GET","/api/school/"+sc.id);
  if (page.castles.length!==2||page.castles[0].name!=="Ms A"||page.castles[0].bricks!==g1.cr.bricks) fail("school page castles "+JSON.stringify(page.castles));
  if (JSON.stringify(page).includes("@")) fail("school page leaks emails");
  if (!page.tournament||page.tournament.standings[0].bricks!==g1.cr.bricks) fail("tournament standings "+JSON.stringify(page.tournament));
  let won=g1.cr.won, games=1;
  while (!won && games<6){ won=(await playMath(A,cls.id,kids)).cr.won; games++; }
  if (won!=="Castle Cup") fail("tournament never won");
  page=await api("GET","/api/school/"+sc.id);
  if (page.tournament||page.past[0].winner!=="Ms A") fail("winner not recorded "+JSON.stringify(page));
  const total=(await api("GET","/api/me",null,A)).castle;
  if (total.games!==games) fail("castle game count");
  // ---- ending a tournament by hand: no winner
  const t2=await api("POST",`/api/admin/schools/${sc.id}/tournament`,{ name:"Spring Siege", goal:100000 },boss);
  await api("POST",`/api/admin/tournaments/${t2.id}/end`,{},boss);
  page=await api("GET","/api/school/"+sc.id); if (page.tournament||page.past.length!==2) fail("ended tournament still live");
  const adm=(await api("GET","/api/admin/schools",null,boss)).schools.find(s=>s.id===sc.id);
  if (adm.teachers!==2||adm.students!==2||adm.bricks!==total.bricks) fail("admin school counts "+JSON.stringify(adm));
  console.log(`OK: castles — admin school list, bricks saved to the teacher's castle, public school page (no emails), student sign-in by school email, tournament won after ${games} games, manual end`);
  srv.kill(); setTimeout(()=>process.exit(0),200);
}
unit().then(e2e).catch(e=>fail(e.stack||e.message));
setTimeout(()=>fail("overall timeout"),60000);
