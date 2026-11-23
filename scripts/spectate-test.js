// Admin "Live now" + spectator mode: admins (only) see every open game with its teacher and students, and can
// watch a player's or the teacher's screen. A watcher is invisible: never in the roster, never counted online,
// can't send anything into the game, and leaving never drops anyone.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=22400+(Math.random()*300|0), BASE=`http://127.0.0.1:${PORT}`;
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT, DATABASE_URL:"", ALLOW_DEV_LINKS:"1",
  ADMIN_EMAILS:"boss@school.test", CLASS_CLOSE_MS:200 }, stdio:["ignore","pipe","inherit"] });
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
function client(name,first){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[] };
  c.send=m=>ws.readyState===1&&ws.send(JSON.stringify(m));
  c.wait=(pred,ms=8000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,15); })(); });
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw)));
  c.ready=new Promise(r=>ws.on("open",()=>{ if (first) c.send(first); r(); }));
  return c;
}
const health=async()=>(await (await fetch(BASE+"/health")).json());
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    const boss=await signIn("boss@school.test"), teach=await signIn("teach@school.test"), nobody=await signIn("nobody@school.test");
    // a signed-in teacher opens a Bear Attack! class; a student joins and gives a name
    const T=client("Teach",{ t:"hello", name:"MrsT", auth:teach }); await T.ready; await T.wait(m=>m.t==="welcome");
    T.send({ t:"create", game:"bear" }); const tj=await T.wait(m=>m.t==="joined"); T.send({ t:"teacher" });
    await T.wait(m=>m.t==="lobby"&&m.teacher===tj.pid);
    const S=client("Kid",{ t:"hello", name:"Kid" }); await S.ready; await S.wait(m=>m.t==="welcome");
    S.send({ t:"join", code:tj.code }); const sj=await S.wait(m=>m.t==="joined");
    await S.wait(m=>m.t==="whoareyou"); S.send({ t:"iam", first:"ada", last:"Lovelace", nick:"Ace" }); await S.wait(m=>m.t==="iamok");

    // ---- live list: admins only
    if ((await api("GET","/api/admin/live")).status!==401) fail("live list readable without signing in");
    if ((await api("GET","/api/admin/live",null,nobody)).status!==403) fail("non-admin could read the live list");
    const live=await api("GET","/api/admin/live",null,boss);
    const g=live.games.find(x=>x.code===tj.code);
    if (!g || g.kind!=="bear" || g.state!=="lobby" || g.teacher!==tj.pid) fail("live list should show the bear class: "+JSON.stringify(live));
    if (!g.account || g.account.email!=="teach@school.test") fail("live list should name the signed-in teacher");
    const kid=g.players.find(p=>p.pid===sj.pid);
    if (!kid || !kid.student || kid.student.first!=="Ada" || kid.student.last!=="L" || kid.name!=="Ace" || !kid.connected) fail("live list should show the student: "+JSON.stringify(g.players));
    console.log("OK: admin live list — games, teacher account, students (admins only)");

    // ---- spectators: non-admins are refused
    const X=client("Nosy",{ t:"spectate", code:tj.code, pid:sj.pid, auth:nobody }); await X.ready;
    await X.wait(m=>m.t==="error"&&m.code==="spectate"); if (X.msgs.some(m=>m.t==="lobby")) fail("non-admin spectator got game data");
    // the game starts, THEN the admin starts watching the student mid-game
    T.send({ t:"start" }); await sleep(50); T.send({ t:"start" });
    await S.wait(m=>m.t==="start"); await S.wait(m=>m.t==="s");
    const before=(await health()).connections;
    const W=client("Boss",{ t:"spectate", code:tj.code, pid:sj.pid, auth:boss }); await W.ready;
    const wj=await W.wait(m=>m.t==="joined"); if (wj.pid!==sj.pid) fail("spectator should mirror the student's screen (their joined msg)");
    await W.wait(m=>m.t==="start"); await W.wait(m=>m.t==="s");
    if (W.msgs.some(m=>m.t==="welcome"||m.t==="whoareyou")) fail("spectator must not get private setup messages");
    if ((await health()).connections!==before) fail("a spectator must not count as online");
    // anything a watcher sends is ignored
    const nIn=S.msgs.length; W.send({ t:"in", x:1, y:0 }); W.send({ t:"start" }); W.send({ t:"join", code:tj.code }); W.send({ t:"create", game:"math" }); await sleep(300);
    const g2=(await api("GET","/api/admin/live",null,boss)).games.find(x=>x.code===tj.code);
    if (g2.players.length!==2) fail("spectator must never join the roster: "+JSON.stringify(g2.players));
    if (g2.watchers!==1) fail("live list should count watchers");
    if (S.msgs.slice(nIn).some(m=>m.t==="addp"||m.t==="lobby"&&m.players.length!==2)) fail("players must not see the watcher");
    // watching the teacher's screen works too
    const W2=client("Boss2",{ t:"spectate", code:tj.code, pid:tj.pid, auth:boss }); await W2.ready;
    if ((await W2.wait(m=>m.t==="joined")).pid!==tj.pid) fail("spectator should mirror the teacher");
    // watchers leaving never drops a player
    W.ws.close(); W2.ws.close(); await sleep(300);
    const g3=(await api("GET","/api/admin/live",null,boss)).games.find(x=>x.code===tj.code);
    if (!g3 || g3.players.some(p=>!p.connected) || g3.watchers!==0) fail("closing a watcher must not drop anyone: "+JSON.stringify(g3));
    console.log("OK: spectators — admins only, mirror a student or the teacher mid-game, invisible, read only, never drop anyone");
    srv.kill(); process.exit(0);
  } catch(e){ fail(e.stack||e.message); }
});
setTimeout(()=>fail("timeout"),30000);
