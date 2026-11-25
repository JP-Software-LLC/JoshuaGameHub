// Bumbling Stumbling Math — page logic: loading, menus, lobby, network, HUD, solo bots, results, teacher view.
// Classic script (so ClassKit can reach Net); the 3D world (Three.js + Rapier) comes from world.js via import().
"use strict";
const DEMO=/[?&]demo=1/.test(location.search);      // hub preview flag: this game has no live preview; just stay quiet
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store={ get(k){ try{return localStorage.getItem(k);}catch{return null;} }, set(k,v){ try{localStorage.setItem(k,v);}catch{} } };
const { T, COURSE }=STUMBLE;
// map registry (shared/stumble-maps.js): veil depths, checkpoints, length. Falls back to the old slice course.
const MAPS=window.STUMBLE_MAPS||{ DEFAULT:"", get:()=>({ id:"", name:"", length:T.dist, veils:[], checkpoints:[] }) };
// ?map=<id> picks a map for SOLO play (testing, e.g. ?play=bots&map=hazard-lab). Read now: the ?play deep link clears the URL.
const URL_MAP=(()=>{ const m=new URLSearchParams(location.search).get("map"); return m&&MAPS.MAPS&&MAPS.MAPS[m]?m:null; })();
// map picker: only the registry's PICKABLE maps (never test rooms like hazard-lab), "Name — blurb"
const PICK_IDS=(MAPS.PICKABLE&&MAPS.PICKABLE.length?MAPS.PICKABLE:[MAPS.DEFAULT]).filter(id=>id&&MAPS.MAPS&&MAPS.MAPS[id]);
const MAP_OPTS=PICK_IDS.map(id=>[id,MAPS.get(id).name+(MAPS.BLURB&&MAPS.BLURB[id]?" — "+MAPS.BLURB[id]:"")]);
const QMODES=[["add","+ Add"],["sub","− Subtract"],["mul","× Multiply"],["div","÷ Divide"],["money","$ Money"]];
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
const G={ mode:"", me:0, dist:T.dist, map:MAPS.get(MAPS.DEFAULT), qpv:T.qpv, qmode:"add", digits:"1", nextQ:null, veils:new Set(), right:0, wrong:0, players:new Map(), startAt:0, finished:new Map(), botFin:new Map(), done:false, resultShown:false, sentAt:0, limitEnd:0, teacher:false, finishT:null };
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
function flash(t,cls){ const m=$("msg"); m.textContent=t; m.classList.remove("show","hit"); void m.offsetWidth; m.classList.add("show"); if (cls) m.classList.add(cls); }
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
  if (Q.on){                                  // a math veil is up: number keys + Backspace answer, movement keys do nothing
    quizKey(e);
    const k=KEYMAP[e.code]; if (k){ e.preventDefault(); if (k!=="j") held.add(k); }   // remember arrows (you run on once it opens), never Space
    return;
  }
  const k=KEYMAP[e.code]; if (!k) return; e.preventDefault();
  held.add(k); if (k==="j" && !e.repeat && WORLD){ WORLD.input.jump=true; WORLD.input.press=true; }
  if (!G.keysHidden && performance.now()>G.startAt+4000){ G.keysHidden=true; $("keys").classList.add("hide"); }
});
addEventListener("keyup",e=>{ const k=KEYMAP[e.code]; if (k) held.delete(k); });
addEventListener("blur",()=>held.clear());
function readInput(){
  const I=WORLD.input;
  if (Q.on){ I.mx=I.mz=0; I.jump=I.press=false; return; } I.mx=(held.has("r")?1:0)-(held.has("l")?1:0); I.mz=(held.has("u")?1:0)-(held.has("d")?1:0);
  I.jump=held.has("j")||I.press;              // hold Space = hop again as soon as you land; a fresh press in the air dives
}

// ============================================================
//  WORLD EVENTS (my bean + solo bots)
// ============================================================
const HIT_WORDS=["BONK!","WHOA!","OOF!","BOING!"];
function raceSecs(){ return Math.max(0,(performance.now()-G.startAt)/1000); }
function onWorldEvent(e,pid,st){
  if (pid===G.me){
    if (e==="veil"){ openQuiz(st&&st.quiz!=null?st.quiz:0); }
    else if (e==="flag"){ toast("🚩 Checkpoint"); }
    else if (e==="checkpoint"){ flash("CHECKPOINT!"); }
    else if (e==="fall"){ flash("WHOOPS!"); if (navigator.vibrate) navigator.vibrate(60); }
    else if (e==="hit"){ flash(HIT_WORDS[(G.hitN=(G.hitN||0)+1)%HIT_WORDS.length],"hit"); if (navigator.vibrate) navigator.vibrate(40); }
    else if (e==="bump"){ flash("BOING!","hit"); if (navigator.vibrate) navigator.vibrate(30); }
    else if (e==="chute"){ flash("SHORTCUT!"); }
    else if (e==="finish") onFinish();
    return;
  }
  if (G.mode==="solo" && e==="finish" && !G.botFin.has(pid)){ G.botFin.set(pid,raceSecs()); if (!DEMO) toast(`🏁 ${G.players.get(pid)?.name} finished!`); }
}

// ============================================================
//  MATH VEILS — touching a veil freezes my bean (world.js) and opens this card. Same rules as Hurdle Dash:
//  Math Race questions (HOOPS.questionStream from the race seed), checked the moment the answer has enough digits,
//  Backspace works, no Enter. Wrong = shake + the right answer, then a NEW question. G.qpv right answers open it.
// ============================================================
const Q={ on:false, k:-1, got:0, need:2, q:null, typed:"", state:"ask", timer:0 };
const WRONG_MS=1700, RIGHT_MS=650, PASS_MS=900;
const cents=v=>{ const c=Math.round(+v); return "$"+Math.floor(c/100)+"."+String(c%100).padStart(2,"0"); };
const qNum=v=>typeof v==="string"?Math.round(parseFloat(v.replace(/[^0-9.]/g,""))*100):v;
function openQuiz(k){
  if (Q.on) return;
  if (G.done || G.teacher || !G.nextQ){ if (WORLD && WORLD.passVeil) WORLD.passVeil(); return; }   // (no question generator: never get stuck)
  clearTimeout(Q.timer);
  Object.assign(Q,{ on:true, k, got:0, need:G.qpv });
  for (const h of ["u","d","l","r","j"]) held.delete(h);
  const qc=$("qc"); qc.className="qc"; void qc.offsetWidth;           // replay the pop-in
  $("qVeil").textContent=`🔷 MATH VEIL ${k+1}`;
  $("quiz").classList.add("on");
  newQuestion();
}
function newQuestion(){
  Q.q=G.nextQ(); Q.typed=""; Q.state="ask"; $("qc").classList.remove("right","wrong");
  let a=Q.q.top, b=Q.q.bottom;                                            // the BIGGER number always goes on top
  if ((Q.q.op==="+"||Q.q.op==="×") && qNum(b)>qNum(a)) [a,b]=[b,a];
  $("qTop").textContent=a; $("qOp").textContent=Q.q.op; $("qBot").textContent=b;
  renderQuiz();
}
function renderQuiz(){
  const q=Q.q, L=q.len, t=Q.typed;
  let h=q.money?"<u>$</u>"+(L<3?"<u>0.</u>":""):"";
  for (let i=0;i<L;i++){ if (q.money && L>=3 && i===L-2) h+="<u>.</u>"; h+=`<b class="${i===t.length&&Q.state==="ask"?"cur":""}">${t[i]||""}</b>`; }
  $("qAns").innerHTML=h;
  $("qPips").innerHTML=Array.from({ length:Q.need },(_,i)=>`<i class="${i<Q.got?"on":""}">${i<Q.got?"★":""}</i>`).join("")+`<span>${Q.got} / ${Q.need}</span>`;
  $("qMsg").innerHTML=Q.state==="wrong"?`Oops! It's<em>${q.money?cents(q.s):q.s}</em>`
    :Q.state==="right"?(Q.need-Q.got===1?"✓ Right! One more…":"✓ Right!")
    :Q.need>1&&Q.got===0?`Get ${Q.need} right to open the veil!`:"Type the answer · <kbd>⌫</kbd> to fix";
}
function quizKey(e){
  if (e.ctrlKey||e.metaKey||e.altKey) return;
  if (/^[0-9]$/.test(e.key)){ e.preventDefault(); if (Q.state!=="ask") return;
    Q.typed+=e.key; renderQuiz(); if (Q.typed.length>=Q.q.len) checkAnswer(); return; }
  if (e.key==="Backspace"){ e.preventDefault(); if (Q.state==="ask" && Q.typed){ Q.typed=Q.typed.slice(0,-1); renderQuiz(); } }
}
function checkAnswer(){
  const qc=$("qc");
  if (+Q.typed===Q.q.s){
    Q.got++; G.right++;
    if (Q.got>=Q.need) return passQuiz();
    Q.state="right"; qc.classList.add("right"); renderQuiz();
    Q.timer=setTimeout(newQuestion,RIGHT_MS);
  } else {
    G.wrong++; Q.state="wrong"; qc.classList.add("wrong"); renderQuiz();
    if (navigator.vibrate) navigator.vibrate(80);
    Q.timer=setTimeout(newQuestion,WRONG_MS);
  }
}
function passQuiz(){
  Q.state="pass"; renderQuiz(); G.veils.add(Q.k);
  const qc=$("qc"); qc.classList.add("right","pass");
  $("qYay").querySelectorAll("i").forEach(i=>i.remove());
  for (let i=0;i<18;i++){ const a=i/18*Math.PI*2, r=120+Math.random()*90, el=document.createElement("i");
    el.style.cssText=`--x:${Math.cos(a)*r}px;--y:${Math.sin(a)*r}px;background:${i%3?pcol(i*3):"#ffcf33"}`; $("qYay").appendChild(el); }
  Q.timer=setTimeout(()=>{ qc.classList.add("out"); Q.timer=setTimeout(()=>{ closeQuiz(); if (WORLD && WORLD.passVeil) WORLD.passVeil(); flash("GO!"); },300); },PASS_MS);
}
function closeQuiz(){ clearTimeout(Q.timer); Q.on=false; Q.state="ask"; $("quiz").classList.remove("on"); }

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
    G.sentAt=now; Net.send({ t:"pos", d:Math.round(Math.max(0,Math.min(G.dist,me.d))*100)/100, x:Math.round(me.x*100)/100, y:Math.round(me.y*100)/100, a:Q.on?5:me.a });
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
  const f=WORLD.me?WORLD.me.st.falls:0; $("fallsN").textContent=`💥 ${f} fall${f===1?"":"s"}`;
  const nv=(G.map.veils||[]).length; $("veilsN").textContent=nv?`🔷 ${G.veils.size} / ${nv}`:""; $("veilsN").style.display=nv?"":"none";
  $("dots").innerHTML=all.map(a=>{ const pl=G.players.get(a.pid); return `<i class="dot ${a.pid===G.me?"me":""}" style="left:calc((100% - 22px) * ${Math.max(0,Math.min(1,a.d/G.dist)).toFixed(4)});background:${pcol(pl?.color??0)}"></i>`; }).join("");
}

// ============================================================
//  RACE START / FINISH
// ============================================================
async function beginRace({ players, me, inMs, mode, teacher=false, endsIn=0, raceMs=null, seed=1, map, dist, qpv, qmode, digits }){
  G.pendingGo=true; const t0=performance.now();
  await ready; G.pendingGo=false;
  const lag=performance.now()-t0, now=performance.now();
  closeQuiz();
  const M=MAPS.get(map||MAPS.DEFAULT);
  Object.assign(G,{ map:M, dist:dist||M.length||T.dist, qpv:Math.max(T.qpvMin,Math.min(T.qpvMax,qpv|0||T.qpv)), qmode:qmode||"add", digits:digits||"1",
    nextQ:window.HOOPS?HOOPS.questionStream(seed,qmode||"add",digits||"1"):null, veils:new Set(), right:0, wrong:0 });   // same seed → same questions, same order for everyone
  if (WORLD.setMap) WORLD.setMap(M.id);
  WORLD.qpv=G.qpv;                                // solo bots wait at each veil about as long as qpv questions take
  Object.assign(G,{ mode, me, players:new Map(players.map(p=>[p.pid,p])), startAt:now+inMs-lag, finished:new Map(), botFin:new Map(), done:false, resultShown:false,
    sentAt:0, teacher, finishT:null, limitEnd:endsIn>0?now+endsIn-lag:0, keysHidden:false });
  const moverT0=raceMs!=null?now-raceMs-lag:G.startAt;
  const mine=teacher?null:G.players.get(me)||{ pid:me, color:0, name:myName() };
  WORLD.startRace({ me:mine&&{ pid:me, color:mine.color, name:mine.name }, players, teacher, moverT0, startAt:G.startAt, seed });   // seed: fake tiles, gumballs, lucky doors
  WORLD.selfPid=me;
  countShown=-1; $("done").classList.remove("on"); $("keys").classList.toggle("hide",teacher); $("feed").innerHTML="";
  $("tBoard").classList.toggle("on",teacher); for (const id of ["place","falls","track"]) $(id).style.display=teacher?"none":"";
  // progress track: a blue diamond at each math veil (+ small ticks at the quiet flags)
  const veils=M.veils||[], flags=(M.checkpoints||[]).filter(c=>c.veil==null&&c.d>0).map(c=>c.d), olds=veils.length?[]:COURSE.CHECKPOINTS.slice(1);
  $("cps").innerHTML=[...flags,...olds].map(d=>`<i class="cp" style="left:calc((100% - 22px) * ${d/G.dist})"></i>`).join("")
    +veils.map(d=>`<i class="cp v" style="left:calc((100% - 22px) * ${d/G.dist})"></i>`).join("");
  show("race");
}
function onFinish(){
  if (G.done) return;
  G.done=true; G.finishT=raceSecs();
  const falls=WORLD.me.st.falls;
  if (G.mode==="online") Net.send({ t:"finish", time:Math.round(G.finishT*100)/100, extra:falls });
  $("dTime").textContent=fmt(G.finishT);
  $("dNote").textContent=`💥 ${falls} fall${falls===1?"":"s"} · ✅ ${G.right} right answer${G.right===1?"":"s"} · `+(G.mode==="solo"?"nice running!":"waiting for the others…");
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
  const sp=soloPrefs();
  await beginRace({ players, me:1, inMs:3500, mode:"solo", seed, qmode:sp.mode, digits:sp.digits, qpv:sp.qpv, map:URL_MAP||sp.map });      // ?map= (e.g. hazard-lab) still overrides the picker
  names.forEach((n,i)=>WORLD.addBot({ pid:i+2, color:i+1, name:n, skill:0.25+0.7*i/(names.length-1), seed:seed+i*101 }));
};
function soloResults(){
  if (G.resultShown||screen!=="race"||G.mode!=="solo") return;
  // let the stragglers finish off-screen (up to 3 race-minutes)
  WORLD.fastForwardBots(raceSecs(),180,(b,t)=>{ if (!G.botFin.has(b.pid)) G.botFin.set(b.pid,t); });
  const rank=[{ pid:G.me, name:G.players.get(G.me).name, color:0, time:G.finishT, d:G.dist, extra:WORLD.me.st.falls },
    ...WORLD.bots.map(b=>({ pid:b.pid, name:G.players.get(b.pid).name, color:G.players.get(b.pid).color, time:G.botFin.get(b.pid)??null, d:b.st.d, extra:b.st.falls }))]
    .sort((a,b)=>(a.time==null)-(b.time==null)||(a.time!=null?a.time-b.time:b.d-a.d));
  showResults(rank);
}

// ============================================================
//  RESULTS — top 3 or top 15 % (whichever is more) + your place
// ============================================================
function showResults(rank){
  G.resultShown=true; endTeacher(); closeQuiz();
  if (!rank.length){ show(G.mode==="solo"?"menu":"lobby"); return; }
  const w=rank[0], n=topCount(rank.length), best=w.time;
  $("champ").innerHTML=`<div style="font-size:64px;line-height:1">🏆</div><div class="t">${w.pid===G.me?"You won the race!":"Race champion!"}</div><h2>${esc(w.name)}</h2>`+(G.map&&G.map.name?`<div class="mp">🗺️ ${esc(G.map.name)}</div>`:"");
  const line=(e,i)=>`<div class="line ${i===0?"p1":""} ${e.pid===G.me?"me":""}" style="animation-delay:${i*60}ms"><span class="pos">${i+1}</span><i style="background:${pcol(e.color)}">${e.color+1}</i>
    <span class="nm">${esc(e.name)}${e.pid===G.me?" (you)":""}</span><span class="cl">${e.extra!=null?`💥 ${e.extra} fall${e.extra===1?"":"s"}`:""}</span><span class="tm">${e.time!=null?fmt(e.time):Math.round(100*Math.max(0,e.d||0)/G.dist)+"%"}</span></div>`;
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
      beginRace({ players:m.players, me:Net.pid, inMs:m.in, mode:"online", teacher:iTeach, endsIn:m.endsIn||0, raceMs:m.raceMs??m.elapsed??null,
        seed:m.seed, map:m.map, dist:m.dist, qpv:m.qpv, qmode:m.mode, digits:m.digits }).then(()=>{
        if (m.you && !iTeach){ if (m.you.fin!=null){ G.done=true; G.finishT=m.you.fin; $("dTime").textContent=fmt(m.you.fin); $("dNote").textContent="waiting for the others…"; $("done").classList.add("on"); WORLD.placeMe(G.dist,true); }
          else if (m.you.d>0){ WORLD.placeMe(m.you.d); (G.map.veils||[]).forEach((v,i)=>{ if (v<m.you.d) G.veils.add(i); }); } } });   // rejoin: veils behind you count as passed
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
  limitUI(L); mathUI(L); mapUI(L);
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
// math options (host/teacher, lobby only): question type + questions per veil; ClassKit adds the digit picker (#ckDigits)
// and moves #lMode / #lQpv / #lLimit into the teacher's lobby card
const fillSel=(id,opts)=>{ $(id).innerHTML=opts.map(([v,t])=>`<option value="${v}">${t}</option>`).join(""); };
const QPV_OPTS=[]; for (let n=T.qpvMin;n<=T.qpvMax;n++) QPV_OPTS.push([n,`${n} question${n===1?"":"s"}`]);
fillSel("lMap",MAP_OPTS); fillSel("sMap",MAP_OPTS); fillSel("lMode",QMODES); fillSel("sMode",QMODES); fillSel("lQpv",QPV_OPTS); fillSel("sQpv",QPV_OPTS.map(([n])=>[n,`${n} per veil`]));
function mathUI(L){
  const host=L.host===Net.pid&&L.state==="lobby";
  for (const [id,v,lbl,txt] of [["lMode",L.mode||"add","lModeLbl","Math"],["lQpv",L.qpv||T.qpv,"lQpvLbl","Questions per veil"]]){
    const sel=$(id); if (document.activeElement!==sel) sel.value=String(v); sel.disabled=!host; $(lbl).textContent=txt+(host?" (you choose)":""); }
  const dig=$("ckDigits"), mb=$("lModeBox");                  // ClassKit's digit picker: right under the question type
  if (dig && mb.parentNode===dig.parentNode && mb.nextElementSibling!==dig) mb.after(dig);
}
$("lMode").addEventListener("change",e=>Net.send({ t:"mode", mode:e.target.value }));
// map picker (host/teacher, lobby only; everyone else sees the chosen map read-only). ClassKit moves #lMap's box to the top
// of the teacher's lobby options. A map not in this page's list (older/newer client) is still shown by name.
function mapUI(L){
  const host=L.host===Net.pid&&L.state==="lobby", sel=$("lMap"), id=L.map||MAPS.DEFAULT;
  if (![...sel.options].some(o=>o.value===id)){ const o=document.createElement("option"); o.value=id; o.textContent=MAPS.get(id).name||id; sel.appendChild(o); }
  if (document.activeElement!==sel) sel.value=id;
  sel.disabled=!host; $("lMapLbl").textContent="Map"+(host?" (you choose)":"");
}
$("lMap").addEventListener("change",e=>Net.send({ t:"map", id:e.target.value }));
$("lQpv").addEventListener("change",e=>Net.send({ t:"qpv", n:+e.target.value }));
// solo pickers on the menu (remembered on this device)
function soloPrefs(){ return { map:$("sMap").value||MAPS.DEFAULT, mode:$("sMode").value, digits:$("sDig").value, qpv:+$("sQpv").value }; }
$("sMap").value=PICK_IDS.includes(store.get("sbm_map"))?store.get("sbm_map"):(PICK_IDS.includes(MAPS.DEFAULT)?MAPS.DEFAULT:PICK_IDS[0]||"");
$("sMap").addEventListener("change",e=>store.set("sbm_map",e.target.value));
$("sMode").value=QMODES.some(m=>m[0]===store.get("sbm_mode"))?store.get("sbm_mode"):"add";
$("sDig").value=["1","12","2"].includes(store.get("sbm_dig"))?store.get("sbm_dig"):"1";
$("sQpv").value=String(Math.max(T.qpvMin,Math.min(T.qpvMax,+store.get("sbm_qpv")||T.qpv)));
const soloDigUI=()=>{ $("sDig").style.display=$("sMode").value==="money"?"none":""; };   // money has no digit choice (as in Math Race)
soloDigUI();
$("sMode").addEventListener("change",e=>{ store.set("sbm_mode",e.target.value); soloDigUI(); });
$("sDig").addEventListener("change",e=>store.set("sbm_dig",e.target.value));
$("sQpv").addEventListener("change",e=>store.set("sbm_qpv",e.target.value));
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
  $("tbList").innerHTML=all.slice(0,n).map((a,i)=>{ const p=G.players.get(a.pid); return `<li><span style="color:var(--ink2)">${i+1}</span><span class="n"><i style="background:${pcol(p?.color??0)}"></i>${esc(p?.name||"…")}</span><span class="v">${a.fin&&a.ft!=null?fmt(a.ft).replace(/\.\d$/,""):veilTag(a)+Math.round(100*Math.max(0,a.d)/G.dist)+"%"}</span></li>`; }).join("");
  $("tbMore").textContent=rest>0?`+ ${rest} more running`:""; $("tbMore").style.display=rest>0?"":"none";
}
// veils behind a racer (from their distance) for the teacher board: "🔷3 · 41%"
function veilTag(a){ const v=G.map.veils||[]; if (!v.length) return ""; return `<b class="vt">🔷${v.filter(d=>a.d>d+0.3).length}</b> `; }
function endTeacher(){ $("tBoard").classList.remove("on"); }

function exitGame(){
  if (screen==="menu"){ location.href="../"; return; }
  if (Net.ws && Net.ws.readyState===1) Net.ws.send(JSON.stringify({ t:"leave" }));
  Net.close(); Net.code=null; Net.lobby=null; clearInterval(lobbyTimer); G.mode=""; endTeacher(); closeQuiz();
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
window.__SBM={ G, Q, openQuiz, get world(){ return WORLD; } };      // for automated tests
