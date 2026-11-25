// Bumbling Stumbling Math — page logic: loading, menus, lobby, network, HUD, solo bots, results, teacher view.
// Classic script (so ClassKit can reach Net); the 3D world (Three.js + Rapier) comes from world.js via import().
"use strict";
const DEMO=/[?&]demo=1/.test(location.search);      // hub preview flag: this game has no live preview; just stay quiet
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store={ get(k){ try{return localStorage.getItem(k);}catch{return null;} }, set(k,v){ try{localStorage.setItem(k,v);}catch{} } };
const { T, COURSE }=STUMBLE;
const pcol=i=>`hsl(${(i*137.508+275)%360},78%,58%)`;           // same as world.js
const fmt=t=>t==null?"–":`${Math.floor(t/60)}:${(t%60).toFixed(1).padStart(4,"0")}`;
const fmtS=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
const topCount=n=>Math.min(n,Math.max(3,Math.ceil(n*0.15)));

// ============================================================
//  LOADING — prefetch the big vendored files with a real progress bar, then import the world
// ============================================================
let WORLD=null, readyResolve; const ready=new Promise(r=>readyResolve=r);
function setLoad(p,txt){ $("loadBar").style.width=Math.round(p*100)+"%"; $("loadTxt").textContent=(txt||"Getting ready…")+" "+Math.round(p*100)+"%"; }
async function prefetch(url,size,from,to,txt){
  try{
    const res=await fetch(url); const total=+res.headers.get("content-length")||size;
    if (!res.body || !res.body.getReader){ await res.arrayBuffer(); setLoad(to,txt); return; }
    const rd=res.body.getReader(); let got=0;
    for (;;){ const { done, value }=await rd.read(); if (done) break; got+=value.length; setLoad(from+(to-from)*Math.min(1,got/total),txt); }
  }catch{ /* import() below reports real failures */ }
  setLoad(to,txt);
}
(async function load(){
  try{
    setLoad(0.02);
    await prefetch("/assets/vendor/three/three.module.min.js",691648,0.02,0.25,"Loading 3D…");
    await prefetch("/assets/vendor/rapier/rapier.es.js",2059600,0.25,0.78,"Loading physics…");
    const mod=await import("./world.js"); setLoad(0.82,"Building the course…");
    WORLD=await mod.createWorld({ canvas:$("cv"), onProgress:p=>setLoad(Math.max(0.82,p),p<0.9?"Starting physics…":"Building the course…") });
    WORLD.onEvent=onWorldEvent;
    setLoad(1,"Ready!");
    setTimeout(()=>$("loading").classList.add("gone"),200);
    readyResolve(WORLD); requestAnimationFrame(frame);
  }catch(e){
    console.error(e);
    $("loadTxt").textContent="Oops, the 3D course couldn't load on this device. Try refreshing, or use Chrome.";
  }
})();

// ============================================================
//  STATE
// ============================================================
const G={ mode:"", me:0, players:new Map(), startAt:0, finished:new Map(), botFin:new Map(), done:false, resultShown:false, sentAt:0, limitEnd:0, teacher:false, finishT:null };
let screen="menu";
function show(id){
  document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("on",s.id===id)); screen=id;
  $("hud").classList.toggle("on",id==="race");
  const t=id==="menu"?"Back to game hub":"Leave race"; $("exitBtn").title=t; $("exitBtn").setAttribute("aria-label",t);
  if (id!=="race" && WORLD && WORLD.mode!=="menu" && id!=="results") WORLD.menu();
}
show("menu");
const err=t=>$("err").textContent=t||"";
$("nameIn").value=store.get("cg_name")||"";
const myName=()=>{ const n=$("nameIn").value.trim().slice(0,14)||"Player"; store.set("cg_name",n); return n; };
function flash(t){ const m=$("msg"); m.textContent=t; m.classList.remove("show"); void m.offsetWidth; m.classList.add("show"); }
function toast(t){ const f=$("feed"); const d=document.createElement("div"); d.textContent=t; f.prepend(d); while (f.children.length>3) f.lastChild.remove(); setTimeout(()=>d.remove(),3500); }

// ============================================================
//  INPUT — keyboard only (no touch controls in this game)
// ============================================================
const held=new Set();
const KEYMAP={ ArrowUp:"u", KeyW:"u", ArrowDown:"d", KeyS:"d", ArrowLeft:"l", KeyA:"l", ArrowRight:"r", KeyD:"r", Space:"j" };
addEventListener("keydown",e=>{
  if (e.target.tagName==="INPUT"||e.target.tagName==="SELECT"||e.target.tagName==="TEXTAREA") return;
  if (e.key==="Escape"&&screen!=="menu") return exitGame();
  if (screen!=="race") return;
  const k=KEYMAP[e.code]; if (!k) return; e.preventDefault();
  held.add(k); if (k==="j" && !e.repeat && WORLD) WORLD.input.jump=true;
  if (!G.keysHidden && performance.now()>G.startAt+4000){ G.keysHidden=true; $("keys").classList.add("hide"); }
});
addEventListener("keyup",e=>{ const k=KEYMAP[e.code]; if (k) held.delete(k); });
addEventListener("blur",()=>held.clear());
function readInput(){
  const I=WORLD.input; I.mx=(held.has("r")?1:0)-(held.has("l")?1:0); I.mz=(held.has("u")?1:0)-(held.has("d")?1:0);
  if (held.has("j")) I.jump=true;              // hold Space = hop again as soon as you land
}

// ============================================================
//  WORLD EVENTS (my bean + solo bots)
// ============================================================
function raceSecs(){ return Math.max(0,(performance.now()-G.startAt)/1000); }
function onWorldEvent(e,pid,st){
  if (pid===G.me){
    if (e==="checkpoint"){ flash("CHECKPOINT!"); }
    else if (e==="fall"){ flash("WHOOPS!"); if (navigator.vibrate) navigator.vibrate(60); }
    else if (e==="finish") onFinish();
    return;
  }
  if (G.mode==="solo" && e==="finish" && !G.botFin.has(pid)){ G.botFin.set(pid,raceSecs()); if (!DEMO) toast(`🏁 ${G.players.get(pid)?.name} finished!`); }
}

// ============================================================
//  LOOP
// ============================================================
let countShown=-1, hudAt=0;
function frame(now){
  requestAnimationFrame(frame);
  if (!WORLD) return;
  if (screen==="race"){
    const rt=(now-G.startAt)/1000;
    if (rt<0){ const c=Math.ceil(-rt); if (c!==countShown && c<=3){ countShown=c; flash(c); } }
    else if (countShown>0){ countShown=0; flash("GO!"); }
    readInput();
  }
  WORLD.frame(now);
  if (screen!=="race") return;
  const me=WORLD.me&&WORLD.me.st;
  if (G.mode==="online" && me && now>=G.startAt && !G.done && now-G.sentAt>100){
    G.sentAt=now; Net.send({ t:"pos", d:Math.round(Math.max(0,Math.min(T.dist,me.d))*100)/100, x:Math.round(me.x*100)/100, y:Math.round(me.y*100)/100, a:me.a });
  }
  if (now-hudAt>120){ hudAt=now; hud(now); }
}
function standings(){
  // every racer we know about: me, bots (solo) or relay rows (online), sorted: finished by time, then by distance
  const all=[];
  if (WORLD.me) all.push({ pid:G.me, d:WORLD.me.st.d, fin:WORLD.me.st.fin, ft:G.finishT });
  for (const b of WORLD.bots) all.push({ pid:b.pid, d:b.st.d, fin:b.st.fin, ft:G.botFin.get(b.pid) });
  for (const r of WORLD.rows||[]) all.push({ pid:r.pid, d:r.d, fin:r.fin, ft:G.finished.get(r.pid) });
  all.sort((a,b)=>(b.fin-a.fin)||(a.fin&&b.fin?(a.ft??0)-(b.ft??0):b.d-a.d));
  return all;
}
function hud(now){
  const all=standings();
  const left=G.limitEnd?Math.max(0,(G.limitEnd-now)/1000):null;
  const rt=G.finishT!=null?G.finishT:Math.max(0,(now-G.startAt)/1000);
  $("clock").innerHTML=fmt(rt)+(left!=null?`<small>⏱ ${fmtS(left)} left</small>`:"");
  if (G.teacher){ teacherBoard(all,now,left); return; }
  const place=all.findIndex(a=>a.pid===G.me)+1, suf=(place%100>10&&place%100<14)?"th":["th","st","nd","rd"][place%10]||"th";
  $("place").innerHTML=`${place}<sup style="font-size:.45em">${suf}</sup><small>/ ${all.length}</small>`;
  const f=WORLD.me?WORLD.me.st.falls:0; $("falls").textContent=`💥 ${f} fall${f===1?"":"s"}`;
  $("dots").innerHTML=all.map(a=>{ const pl=G.players.get(a.pid); return `<i class="dot ${a.pid===G.me?"me":""}" style="left:calc((100% - 22px) * ${Math.max(0,Math.min(1,a.d/T.dist)).toFixed(4)});background:${pcol(pl?.color??0)}"></i>`; }).join("");
}

// ============================================================
//  RACE START / FINISH
// ============================================================
async function beginRace({ players, me, inMs, mode, teacher=false, endsIn=0, raceMs=null }){
  G.pendingGo=true; const t0=performance.now();
  await ready; G.pendingGo=false;
  const lag=performance.now()-t0, now=performance.now();
  Object.assign(G,{ mode, me, players:new Map(players.map(p=>[p.pid,p])), startAt:now+inMs-lag, finished:new Map(), botFin:new Map(), done:false, resultShown:false,
    sentAt:0, teacher, finishT:null, limitEnd:endsIn>0?now+endsIn-lag:0, keysHidden:false });
  const moverT0=raceMs!=null?now-raceMs-lag:G.startAt;
  const mine=teacher?null:G.players.get(me)||{ pid:me, color:0, name:myName() };
  WORLD.startRace({ me:mine&&{ pid:me, color:mine.color, name:mine.name }, players, teacher, moverT0, startAt:G.startAt });
  WORLD.selfPid=me;
  countShown=-1; $("done").classList.remove("on"); $("keys").classList.toggle("hide",teacher); $("feed").innerHTML="";
  $("tBoard").classList.toggle("on",teacher); for (const id of ["place","falls","track"]) $(id).style.display=teacher?"none":"";
  $("cps").innerHTML=COURSE.CHECKPOINTS.slice(1).map(c=>`<i class="cp" style="left:calc((100% - 22px) * ${c/T.dist})"></i>`).join("");
  show("race");
}
function onFinish(){
  if (G.done) return;
  G.done=true; G.finishT=raceSecs();
  const falls=WORLD.me.st.falls;
  if (G.mode==="online") Net.send({ t:"finish", time:Math.round(G.finishT*100)/100, extra:falls });
  $("dTime").textContent=fmt(G.finishT);
  $("dNote").textContent=`💥 ${falls} fall${falls===1?"":"s"} · `+(G.mode==="solo"?"nice running!":"waiting for the others…");
  $("done").classList.add("on"); flash("FINISH!"); confetti();
  if (G.mode==="solo") setTimeout(soloResults,2600);
}

// ============================================================
//  SOLO vs 7 bots (bots run the same physics in this browser; they never exist online)
// ============================================================
$("bSolo").onclick=async ()=>{
  const name=myName(); Net.close();
  const seed=(Math.random()*2**31)|0;
  const names=["Wobbles","Jellybean","Bonk","Noodle","Sprinkles","Dizzy","Gumdrop"];
  const players=[{ pid:1, name, color:0 }, ...names.map((n,i)=>({ pid:i+2, name:n, color:i+1 }))];
  await beginRace({ players, me:1, inMs:3500, mode:"solo" });
  names.forEach((n,i)=>WORLD.addBot({ pid:i+2, color:i+1, name:n, skill:0.25+0.7*i/(names.length-1), seed:seed+i*101 }));
};
function soloResults(){
  if (G.resultShown||screen!=="race"||G.mode!=="solo") return;
  // let the stragglers finish off-screen (up to 3 race-minutes)
  WORLD.fastForwardBots(raceSecs(),180,(b,t)=>{ if (!G.botFin.has(b.pid)) G.botFin.set(b.pid,t); });
  const rank=[{ pid:G.me, name:G.players.get(G.me).name, color:0, time:G.finishT, d:T.dist, extra:WORLD.me.st.falls },
    ...WORLD.bots.map(b=>({ pid:b.pid, name:G.players.get(b.pid).name, color:G.players.get(b.pid).color, time:G.botFin.get(b.pid)??null, d:b.st.d, extra:b.st.falls }))]
    .sort((a,b)=>(a.time==null)-(b.time==null)||(a.time!=null?a.time-b.time:b.d-a.d));
  showResults(rank);
}

// ============================================================
//  RESULTS — top 3 or top 15 % (whichever is more) + your place
// ============================================================
function showResults(rank){
  G.resultShown=true; endTeacher();
  if (!rank.length){ show(G.mode==="solo"?"menu":"lobby"); return; }
  const w=rank[0], n=topCount(rank.length), best=w.time;
  $("champ").innerHTML=`<div style="font-size:64px;line-height:1">🏆</div><div class="t">${w.pid===G.me?"You won the race!":"Race champion!"}</div><h2>${esc(w.name)}</h2>`;
  const line=(e,i)=>`<div class="line ${i===0?"p1":""} ${e.pid===G.me?"me":""}" style="animation-delay:${i*60}ms"><span class="pos">${i+1}</span><i style="background:${pcol(e.color)}">${e.color+1}</i>
    <span class="nm">${esc(e.name)}${e.pid===G.me?" (you)":""}</span><span class="cl">${e.extra!=null?`💥 ${e.extra} fall${e.extra===1?"":"s"}`:""}</span><span class="tm">${e.time!=null?fmt(e.time):Math.round(100*Math.max(0,e.d||0)/T.dist)+"%"}</span></div>`;
  $("rBoard").innerHTML=rank.slice(0,n).map(line).join("");
  const mi=rank.findIndex(e=>e.pid===G.me);
  $("rYou").innerHTML=mi>=n?`<span>You · ${mi+1} of ${rank.length}</span><span>${rank[mi].time!=null?fmt(rank[mi].time)+" (+"+(rank[mi].time-best).toFixed(1)+"s)":"didn't finish"}</span>`:"";
  $("bAgain").textContent=G.mode==="solo"?"Race again":"Back to lobby";
  show("results"); if (!G.done) confetti();
}
$("bAgain").onclick=()=>{ if (G.mode==="solo") $("bSolo").click(); else { show("lobby"); renderLobby(); } };
function confetti(){
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c=$("confetti"), x=c.getContext("2d"); c.width=innerWidth; c.height=innerHeight;
  const P=Array.from({length:140},(_,i)=>({ x:Math.random()*innerWidth, y:-20-Math.random()*innerHeight*0.5, v:2+Math.random()*4, s:5+Math.random()*7, r:Math.random()*6, c:i%3?pcol(i):"#ffcf33" }));
  const t0=performance.now();
  (function f(now){ const age=(now-t0)/1000; x.clearRect(0,0,c.width,c.height);
    for (const p of P){ p.y+=p.v; p.r+=0.08; x.save(); x.globalAlpha=Math.max(0,1-Math.max(0,age-2.8)/1.4); x.translate(p.x+Math.sin(p.r)*14,p.y); x.rotate(p.r); x.fillStyle=p.c; x.fillRect(-p.s/2,-p.s/3,p.s,p.s*0.66); x.restore(); }
    if (age<4.2) requestAnimationFrame(f); else x.clearRect(0,0,c.width,c.height); })(t0);
}

// ============================================================
//  NETWORK
// ============================================================
const Net={
  ws:null, want:false, retry:0, queue:[], pid:0, code:null, lobby:null, token:store.get("cg_token"),
  url(){ const s=(window.CG_CONFIG&&CG_CONFIG.server)||""; if (s) return s; if (!location.host) return null; return (location.protocol==="https:"?"wss://":"ws://")+location.host; },
  open(){
    this.want=true; if (this.ws&&this.ws.readyState<=1) return;
    const url=this.url(); if (!url) return err("Online play needs the game server.");
    const ws=this.ws=new WebSocket(url);
    ws.onopen=()=>{ this.retry=0; ws.send(JSON.stringify({ t:"hello", name:myName(), token:this.token, auth:window.ClassKit?ClassKit.auth():undefined })); for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m)); };
    ws.onmessage=e=>{ let m; try{ m=JSON.parse(e.data); }catch{ return; } onNet(m); };
    ws.onclose=()=>{ if (!this.want) return; if (screen==="menu") err("Can't reach the game server. Retrying…"); setTimeout(()=>this.want&&this.open(),Math.min(5000,500*2**this.retry++)); };
  },
  send(m){ if (this.ws&&this.ws.readyState===1) this.ws.send(JSON.stringify(m)); else if (this.want){ this.queue.push(m); this.open(); } },
  close(){ this.want=false; if (this.ws) this.ws.close(); this.ws=null; },
};
window.Net=Net;
function onNet(m){
  if (window.ClassKit&&ClassKit.onNet(m)) return;
  if (m.t==="joined" && Net.wantTeacher && m.game==="stumble"){ Net.wantTeacher=false; Net.send(window.ClassKit?ClassKit.teacherMsg():{ t:"teacher" }); }
  switch (m.t){
    case "welcome": Net.token=m.token; store.set("cg_token",m.token); break;
    case "joined":
      if (m.game!=="stumble"){ Net.send({ t:"leave" }); Net.close(); show("menu"); return err("That code is for a different game."); }
      Net.pid=m.pid; Net.code=m.code; if (screen==="menu") show("lobby"); break;
    case "lobby": Net.lobby=m; m.at=performance.now(); if (screen==="lobby") renderLobby(); break;
    case "go": {
      const iTeach=!!m.teacher && m.teacher===Net.pid;
      beginRace({ players:m.players, me:Net.pid, inMs:m.in, mode:"online", teacher:iTeach, endsIn:m.endsIn||0, raceMs:m.raceMs??m.elapsed??null }).then(()=>{
        if (m.you && !iTeach){ if (m.you.fin!=null){ G.done=true; G.finishT=m.you.fin; $("dTime").textContent=fmt(m.you.fin); $("dNote").textContent="waiting for the others…"; $("done").classList.add("on"); WORLD.placeMe(T.dist,true); }
          else if (m.you.d>0) WORLD.placeMe(m.you.d); } });
      break; }
    case "addp": if (m.p){ G.players.set(m.p.pid,m.p); if (WORLD) WORLD.setPlayer(m.p); } break;   // a classmate joined mid-race
    case "ps": if (G.mode==="online" && WORLD && WORLD.mode==="race") WORLD.pushSnap(m.p); break;
    case "fin": if (m.pid!==Net.pid){ G.finished.set(m.pid,m.time); const pl=G.players.get(m.pid); if (pl && screen==="race" && !G.teacher) toast(`🏁 ${pl.name} finished!`); } break;
    case "results": if (G.mode==="online") showResults(m.rank); break;
    case "error": Net.code=null; show("menu"); err(m.msg||"Something went wrong."); break;
  }
}
let lobbyTimer=0;
function renderLobby(){
  const L=Net.lobby; if (!L) return;
  $("lKind").textContent=L.pub?"Online race":"Private race";
  $("lCode").textContent=L.code;
  $("lCount").textContent=`${L.players.length} / ${L.max} racers`;
  $("lGrid").innerHTML=L.players.filter(p=>p.pid!==L.teacher).map(p=>`<span class="chip ${p.pid===Net.pid?"me":""} ${p.connected?"":"away"}"><i style="background:${pcol(p.color)}">${p.color+1}</i>${esc(p.name)}${p.pid===L.host?" ★":""}</span>`).join("");
  const host=L.host===Net.pid;
  $("bStart").style.display=host?"":"none";
  limitUI(L);
  clearInterval(lobbyTimer);
  const note=()=>{
    let t=L.state==="playing"?"A race is going on…":host?"You're the host. Start when everyone's in!":"Waiting for the host to start…";
    if (L.autoIn&&L.state==="lobby"){ const s=Math.max(0,Math.ceil((L.autoIn-(performance.now()-L.at))/1000)); t=`Starting by itself in ${s}s`+(host?". Or start now!":""); }
    $("lNote").textContent=(L.pub?"":"Share the code with friends. ")+t;
  };
  const note2=()=>{ note(); teacherLobby(L); }; note2(); lobbyTimer=setInterval(note2,500);
}
// time limit (host/teacher picks in the lobby; ClassKit moves #lLimit's box into the teacher's lobby card)
function limitUI(L){
  const host=L.host===Net.pid&&L.state==="lobby", sel=$("lLimit");
  if (document.activeElement!==sel) sel.value=String(L.limit||0);
  sel.disabled=!host; $("lLimitLbl").textContent=host?"Time limit (you choose)":"Time limit";
}
$("lLimit").addEventListener("change",e=>Net.send({ t:"limit", min:+e.target.value }));
function goOnline(msg){ err(""); myName(); Net.open(); Net.send(msg); }
$("bPublic").onclick=()=>goOnline({ t:"quick", game:"stumble" });
$("bPrivate").onclick=()=>goOnline({ t:"create", game:"stumble" });
$("bJoin").onclick=()=>{ const c=$("codeIn").value.trim().toUpperCase(); if (c.length!==4) return err("Race codes are 4 letters."); goOnline({ t:"join", code:c }); };
$("codeIn").addEventListener("keydown",e=>{ if (e.key==="Enter") $("bJoin").click(); });
$("bStart").onclick=()=>Net.send({ t:"start" });
$("bLeave").onclick=()=>{ Net.send({ t:"leave" }); Net.close(); Net.code=null; show("menu"); };

// ============================================================
//  TEACHER MODE — the teacher runs a private room without playing: a drone camera over the course + live board
// ============================================================
function teacherLobby(L){
  if (!L || !L.teacher) return;
  const iTeach=L.teacher===Net.pid, kids=L.players.filter(p=>p.pid!==L.teacher), t=L.players.find(p=>p.pid===L.teacher);
  $("lCount").textContent=`${kids.length} / ${L.max-1} students`;
  $("lKind").textContent="🍎 Teacher mode · private game";
  $("bStart").textContent="Start for the class"; $("bStart").style.display=iTeach?"":"none";
  $("lNote").textContent=iTeach?"Share this code with your class. You won't play. The race ends when 60% of the class has finished (or at the time limit).":`🍎 ${t?t.name:"Your teacher"} will start the game.`;
}
$("bTeacher").onclick=()=>(window.ClassKit?ClassKit.beginTeacher:(go=>go()))(()=>{ Net.wantTeacher=true; goOnline({ t:"create", game:"stumble" }); });
function teacherBoard(all,now,left){
  const tb=$("tBoard");
  if (!tb.dataset.init){ tb.dataset.init=1;       // built once so the End button never re-renders under the mouse
    tb.innerHTML=`<h3>🍎 CLASS VIEW · LIVE</h3><div class="tt" id="tbT"></div><ol id="tbList"></ol><div class="more" id="tbMore"></div><button class="btn" type="button" id="bEnd">End game</button>`;
    $("bEnd").onclick=()=>{ if (confirm("End the race now? Everyone gets their results.")) Net.send({ t:"end" }); }; }
  const pre=now<G.startAt, n=topCount(all.length), done=all.filter(a=>a.fin).length, need=Math.ceil(T.endFrac*all.length);
  const rest=all.length-Math.min(n,all.length);
  $("tbT").innerHTML=`${pre?"Get ready… "+Math.ceil((G.startAt-now)/1000):fmt(Math.max(0,(now-G.startAt)/1000))}<small>${done} of ${all.length} finished${all.length?` · ends at ${need}`:""}${left!=null?` · ⏱ ${fmtS(left)} left`:""}</small>`;
  $("tbList").innerHTML=all.slice(0,n).map((a,i)=>{ const p=G.players.get(a.pid); return `<li><span style="color:var(--ink2)">${i+1}</span><span class="n"><i style="background:${pcol(p?.color??0)}"></i>${esc(p?.name||"…")}</span><span class="v">${a.fin&&a.ft!=null?fmt(a.ft).replace(/\.\d$/,""):Math.round(100*Math.max(0,a.d)/T.dist)+"%"}</span></li>`; }).join("");
  $("tbMore").textContent=rest>0?`+ ${rest} more running`:""; $("tbMore").style.display=rest>0?"":"none";
}
function endTeacher(){ $("tBoard").classList.remove("on"); }

function exitGame(){
  if (screen==="menu"){ location.href="../"; return; }
  if (Net.ws && Net.ws.readyState===1) Net.ws.send(JSON.stringify({ t:"leave" }));
  Net.close(); Net.code=null; Net.lobby=null; clearInterval(lobbyTimer); G.mode=""; endTeacher();
  if (WORLD) WORLD.menu();
  show("menu");
}
$("exitBtn").onclick=exitGame;
if (!DEMO){
  addEventListener("DOMContentLoaded",()=>{ const q=new URLSearchParams(location.search).get("play"); if (!q) return; history.replaceState(null,"",location.pathname);
    if (q==="public") $("bPublic").click(); else if (q==="private") $("bPrivate").click(); else if (q==="teacher") $("bTeacher").click(); else if (q==="solo"||q==="bots") $("bSolo").click(); });
  // hub "Have a code?" deep link: ?join=CODE
  addEventListener("DOMContentLoaded",()=>{ const j=new URLSearchParams(location.search).get("join"); if (!j) return; history.replaceState(null,"",location.pathname);
    $("codeIn").value=j.toUpperCase(); $("bJoin").click(); });
}
window.__SBM={ G, get world(){ return WORLD; } };      // for automated tests
