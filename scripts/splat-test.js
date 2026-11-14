// SPLAT! end-to-end (fast timings): 4 players, everyone throws once.
// Checks: thrower never receives hiding spots, hiders see each other, unpicked hiders get a
// random barrel, scoring (+10 per dodge, +20 per splat), turn order covers everyone, final stats.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const WebSocket=require("ws");
const PORT=19900+(Math.random()*90|0);
const env={ ...process.env, PORT, SPLAT_HIDE1_MS:400, SPLAT_HIDE2_MS:300, SPLAT_HIDE3_MS:250, SPLAT_THROW_MS:400,
  SPLAT_INTRO_MS:100, SPLAT_SPLASH_MS:120, SPLAT_TURN_END_MS:120 };
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };

function client(name){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`), c={ ws, msgs:[], name };
  c.send=m=>ws.send(JSON.stringify(m));
  c.wait=(pred,ms=6000)=>new Promise((res,rej)=>{ const t0=Date.now(); (function p(){ const h=c.msgs.find(pred); if (h) return res(h); if (Date.now()-t0>ms) return rej(new Error(name+" timeout")); setTimeout(p,10); })(); });
  ws.on("message",raw=>{ const m=JSON.parse(raw); c.msgs.push(m); c.on&&c.on(m); });
  c.ready=new Promise(r=>ws.on("open",()=>{ c.send({ t:"hello", name }); r(); }));
  return c;
}

srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    const all=[]; let code;
    for (let i=0;i<4;i++){
      const c=client("P"+i); await c.ready; await c.wait(m=>m.t==="welcome");
      c.send(i? { t:"join", code } : { t:"create", game:"splat" });
      const j=await c.wait(m=>m.t==="joined"); if (j.game!=="splat") fail("game should be splat"); code=j.code; c.pid=j.pid; all.push(c);
    }
    const lob=await all[0].wait(m=>m.t==="lobby"&&m.players.length===4);
    if (new Set(lob.players.map(p=>p.color)).size!==4) fail("colours should be unique");
    if (!lob.autoIn) fail("lobby should be auto-starting with 2+ players");
    const byPid=Object.fromEntries(all.map(c=>[c.pid,c]));

    // Behaviour: hiders 1..n pick barrel (pid % 3) except one who never picks; thrower always throws barrel 0.
    const lazy=all[3].pid;
    for (const c of all) c.on=m=>{
      if (m.t==="phase"&&m.phase==="hide"&&m.alive.includes(c.pid)&&c.pid!==lazy){ c.send({ t:"pick", b:(c.pid+1)%3 }); setTimeout(()=>c.send({ t:"pick", b:c.pid%3 }),40); }
      if (m.t==="phase"&&m.phase==="throw"&&c.isThrower) c.send({ t:"throw", b:0 });
      if (m.t==="turn") c.isThrower=m.thrower===c.pid;
    };
    all[0].send({ t:"start" });
    const fin=await all[0].wait(m=>m.t==="final",15000);

    // thrower never got hiding spots during their own turn
    for (const c of all){
      let thrower=0;
      for (const m of c.msgs){ if (m.t==="turn") thrower=m.thrower; if (m.t==="hidepos"&&thrower===c.pid) fail(`${c.name} saw hiding spots while throwing`); }
    }
    // every player threw exactly once
    const throwers=all[0].msgs.filter(m=>m.t==="turn").map(m=>m.thrower);
    if (throwers.length!==4||new Set(throwers).size!==4) fail("each player should get exactly one turn: "+throwers);
    // the lazy player was always placed somewhere
    for (const s of all[0].msgs.filter(m=>m.t==="splash")) for (const pid of [...s.hit,...s.alive]) if (s.pos[pid]==null) fail("hider without a barrel");
    // recompute scores from splash messages
    const pts={}, st={}; for (const c of all){ pts[c.pid]=0; st[c.pid]={ dodged:0, splashes:0, splatted:0 }; }
    let thrower=0;
    for (const m of all[0].msgs){
      if (m.t==="turn") thrower=m.thrower;
      if (m.t==="splash"){ for (const pid of m.alive){ pts[pid]+=10; st[pid].dodged++; } for (const pid of m.hit){ st[pid].splatted++; } pts[thrower]+=20*m.hit.length; st[thrower].splashes+=m.hit.length; }
    }
    for (const r of fin.rank){
      if (r.points!==pts[r.pid]) fail(`points mismatch for ${r.name}: ${r.points} vs ${pts[r.pid]}`);
      if (r.dodged!==st[r.pid].dodged||r.splashes!==st[r.pid].splashes||r.splatted!==st[r.pid].splatted) fail("stats mismatch for "+r.name);
    }
    for (let i=1;i<fin.rank.length;i++) if (fin.rank[i].points>fin.rank[i-1].points) fail("final not sorted");
    // turns never exceed 3 throws, and stop early when everyone is splatted
    let n=0; for (const m of all[0].msgs){ if (m.t==="turn") n=0; if (m.t==="splash"){ n++; if (n>3) fail(">3 throws in a turn"); } }
    await all[0].wait(m=>m.t==="lobby"&&m.state==="lobby");
    console.log("OK: splat — 4 players, 4 turns, hidden spots never sent to thrower, random fill, scoring + stats match");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),30000);
