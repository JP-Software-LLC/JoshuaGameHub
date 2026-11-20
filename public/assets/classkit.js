// ClassKit — shared by every whole-class game page.
//  • Students joining a teacher's room: "Who are you?" (first name, last initial, nickname). Classmates see the nickname only.
//  • Signed-in teachers: pick which class is playing before hosting, so results save automatically.
//  • After a Teacher Mode game: a "See class results" button (saved session, or "create a free account to save").
// Pages call: ClassKit.auth() in hello · ClassKit.teacherMsg() · ClassKit.beginTeacher(go) · ClassKit.onNet(m) first in onNet.
(function(){
"use strict";
const store={ get(k){ try{ return localStorage.getItem(k); }catch{ return null; } }, set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,v); }catch{} } };
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const apiBase=()=>{ const s=(window.CG_CONFIG&&CG_CONFIG.server)||""; return s?s.replace(/^ws/,"http").replace(/\/$/,""):""; };
async function api(path,opts={}){
  const r=await fetch(apiBase()+path,{ ...opts, headers:{ "content-type":"application/json", ...(store.get("jgh_auth")?{ authorization:"Bearer "+store.get("jgh_auth") }:{}) } });
  const j=await r.json().catch(()=>({})); if (!r.ok){ const e=new Error(j.error||"Something went wrong."); e.status=r.status; throw e; } return j;
}

// ---------- styles (self-contained, works on every game's theme)
const css=`
.ck-ov{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,14,22,.72);backdrop-filter:blur(4px);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.ck-card{width:min(440px,100%);background:#fff;color:#16202e;border-radius:20px;padding:22px 22px 18px;box-shadow:0 30px 70px -20px rgba(0,0,0,.6);animation:ckpop .3s cubic-bezier(.2,1.4,.4,1)}
@keyframes ckpop{from{transform:scale(.92);opacity:0}}
.ck-card h3{margin:0 0 4px;font-size:22px}
.ck-card p{margin:0 0 12px;color:#5a6676;font-size:14px;line-height:1.45}
.ck-row{display:flex;gap:10px}
.ck-f{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;flex:1}
.ck-f label{font-size:12px;font-weight:700;letter-spacing:.5px;color:#5a6676;text-transform:uppercase}
.ck-f input,.ck-f select{width:100%;min-width:0;background:#fff;border:2px solid #dfe6ee;border-radius:12px;padding:11px 12px;font-size:17px;font-family:inherit;outline:none;color:#16202e}
.ck-f input:focus,.ck-f select:focus{border-color:#3b82f6}
.ck-btn{appearance:none;border:0;border-radius:12px;padding:12px 16px;font-size:16px;font-weight:700;cursor:pointer;background:#3b82f6;color:#fff;font-family:inherit}
.ck-btn.alt{background:#eef2f7;color:#16202e}
.ck-btn:hover{filter:brightness(1.05)}
.ck-err{color:#dc2626;font-size:14px;min-height:18px;margin:0 0 6px}
.ck-list{display:flex;flex-direction:column;gap:6px;max-height:44vh;overflow:auto;margin-bottom:12px}
.ck-cls{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-radius:12px;border:2px solid #dfe6ee;cursor:pointer;font-weight:700}
.ck-cls:hover{border-color:#3b82f6}
.ck-cls small{color:#5a6676;font-weight:500}
.ck-res{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9998;display:flex;align-items:center;gap:12px;background:#fff;color:#16202e;border-radius:16px;padding:12px 12px 12px 18px;
  box-shadow:0 18px 40px -10px rgba(0,0,0,.55);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;animation:ckpop .35s cubic-bezier(.2,1.4,.4,1);max-width:calc(100% - 24px)}
.ck-res b{display:block;font-size:15px}
.ck-res span{font-size:13px;color:#5a6676}
.ck-res a{text-decoration:none;white-space:nowrap}
.ck-x{background:none;border:0;font-size:18px;color:#8a95a5;cursor:pointer;padding:4px}
.ck-banner{position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:9997;display:flex;align-items:center;gap:14px;padding:14px 24px;border-radius:20px;
  background:#fff;color:#16202e;box-shadow:0 20px 50px -12px rgba(0,0,0,.6);font:700 20px system-ui,-apple-system,"Segoe UI",sans-serif;max-width:calc(100% - 24px);text-align:center;pointer-events:none}
.ck-banner b{font-size:40px;line-height:1;color:#e5484d;min-width:1.2ch}
.ck-banner small{display:block;font-size:14px;font-weight:600;color:#5a6676}
.ck-banner.ok{background:#e9fbef;top:auto;bottom:16px}
.ck-board{position:fixed;right:12px;top:66px;z-index:9996;width:min(270px,40vw);background:rgba(13,16,24,.9);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:16px;
  padding:12px 14px;font:600 15px system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 18px 40px -12px rgba(0,0,0,.6);backdrop-filter:blur(8px)}
.ck-board .cd{font:800 13px system-ui,sans-serif;color:#aab4c4;letter-spacing:.5px;text-transform:uppercase}
.ck-board .cd b{display:block;font:800 40px/1.05 ui-monospace,"JetBrains Mono",monospace;letter-spacing:6px;color:#f2c94c}
.ck-board .cd span{display:block;font-size:11px;text-transform:none;letter-spacing:0;color:#8f98a8;margin-top:2px}
.ck-board ol{list-style:none;margin:10px 0 0;padding:8px 0 0;border-top:1px solid rgba(255,255,255,.14);display:flex;flex-direction:column;gap:4px}
.ck-board li{display:flex;justify-content:space-between;gap:10px}
.ck-board li i{font-style:normal;color:#f2c94c;margin-right:6px}
.ck-board li em{font-style:normal;color:#aab4c4;white-space:nowrap}
.ck-board .more{color:#8f98a8;font-size:13px;font-weight:500}
.ck-board .hide{all:unset;cursor:pointer;float:right;color:#8f98a8;font-size:12px}
.ck-board.min ol,.ck-board.min .cd span{display:none}
.ck-me{position:fixed;left:12px;bottom:12px;z-index:9996;background:rgba(13,16,24,.88);color:#fff;border-radius:14px;padding:8px 14px;font:700 15px system-ui,-apple-system,"Segoe UI",sans-serif;
  border:1px solid rgba(255,255,255,.18);pointer-events:none}
.ck-me span{color:#f2c94c}
.ck-sm{position:fixed;inset:var(--jgh-h,58px) 0 0 0;z-index:2147482000;overflow:auto;display:flex;align-items:safe center;justify-content:center;padding:18px;
  background:radial-gradient(900px 500px at 50% 0%,#24325a,#0b0f1a 70%);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff}
.ck-sm[hidden]{display:none}
.ck-who{margin:0;text-align:center;font-weight:700;opacity:.85}.ck-who a{color:inherit;text-decoration:underline}
.ck-sm .in{width:min(640px,100%);display:flex;flex-direction:column;gap:16px}
.ck-sm h1{margin:0;font-size:clamp(34px,6vw,56px);line-height:1.05;letter-spacing:-1px}
.ck-sm .how{margin:0;font-size:19px;line-height:1.5;color:#d5dcea;background:rgba(255,255,255,.06);border-radius:16px;padding:14px 18px}
.ck-sm .who{font-size:15px;color:#aab4c4}.ck-sm .who b{color:#fff}.ck-sm .who a{color:#f2c94c}
.ck-sm .jr{display:flex;gap:10px}
.ck-sm .big{all:unset;box-sizing:border-box;cursor:pointer;text-align:center;border-radius:18px;padding:20px 22px;font-size:26px;font-weight:800;box-shadow:0 5px 0 rgba(0,0,0,.35)}
.ck-sm .big:active{transform:translateY(3px);box-shadow:0 2px 0 rgba(0,0,0,.35)}
.ck-sm .join{background:#58c27d;color:#08240f;flex:0 0 auto}
.ck-sm .make{background:#5aa9e6;color:#061a2b}
.ck-sm .code{flex:1;min-width:0;border:4px solid #58c27d;border-radius:18px;background:#fff;color:#16202e;font:800 34px ui-monospace,"JetBrains Mono",monospace;letter-spacing:10px;text-align:center;text-transform:uppercase;padding:10px;outline:none}
.ck-sm .code::placeholder{color:#c3cad6;letter-spacing:6px}
.ck-sm .quick{all:unset;cursor:pointer;align-self:center;color:#cfd7e6;font-size:16px;font-weight:700;padding:10px 16px;border-radius:12px;border:2px solid rgba(255,255,255,.2)}
.ck-sm .quick:hover{border-color:rgba(255,255,255,.5)}
.ck-sm .err{color:#ffb3b3;font-weight:700;min-height:1.3em;margin:0;text-align:center;font-size:17px}
@media (max-width:560px){ .ck-sm .jr{flex-direction:column} .ck-sm .big{font-size:22px} }
.ck-dig{display:flex;flex-direction:column;gap:6px;margin:4px 0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.ck-dig>span{font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;opacity:.75}
.ck-dig>div{display:flex;gap:6px;flex-wrap:wrap}
.ck-dig button{appearance:none;border:2px solid rgba(127,140,160,.45);background:rgba(127,140,160,.12);color:inherit;border-radius:10px;padding:8px 12px;font:700 15px inherit;font-family:inherit;cursor:pointer}
.ck-dig button.on{background:#3b82f6;border-color:#3b82f6;color:#fff}
.ck-dig button:disabled{cursor:default;opacity:.6}.ck-dig button.on:disabled{opacity:1}
.ck-toast{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9998;background:#16202e;color:#fff;border-radius:999px;padding:8px 16px;font:600 14px system-ui,sans-serif;animation:ckpop .3s}`;
const st=document.createElement("style"); st.textContent=css; document.head.appendChild(st);
function overlay(html){ close(); const o=document.createElement("div"); o.className="ck-ov"; o.id="ckOv"; o.innerHTML=`<div class="ck-card">${html}</div>`; document.body.appendChild(o); return o; }
function close(){ const o=document.getElementById("ckOv"); if (o) o.remove(); }
function toast(t){ const d=document.createElement("div"); d.className="ck-toast"; d.textContent=t; document.body.appendChild(d); setTimeout(()=>d.remove(),2600); }

// ---------- students: who are you?
const MODE=(()=>{ try{ return localStorage.getItem("jgh_mode")||""; }catch{ return ""; } })();
function profile(){ try{ const p=JSON.parse(store.get("jgh_student")||"null"); return p&&p.first&&p.last&&p.nick&&p.school?p:null; }catch{ return null; } }
let SCHOOLS=null;
async function schoolOptions(sel,pick){
  if (!SCHOOLS){ try{ SCHOOLS=(await api("/api/schools")).schools||[]; }catch{ SCHOOLS=[]; } }
  const states=[...new Set(SCHOOLS.map(x=>x.state))];
  sel.innerHTML=`<option value="">${SCHOOLS.length?"Pick your school…":"No schools yet"}</option>`+states.map(st=>`<optgroup label="${esc(st||"Other")}">${SCHOOLS.filter(x=>x.state===st).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</optgroup>`).join("");
  sel.value=SCHOOLS.some(x=>x.id===pick)?pick:"";
}
let teacherSchool=null;
function askStudent(known,error){
  const send=s=>{ store.set("jgh_student",JSON.stringify(s)); store.set("cg_name",s.nick); Net.send({ t:"iam", ...s }); close(); };
  const mine=profile();
  if (mine && !error && (MODE==="student" || (known && known.first===mine.first && known.last===mine.last))) return send(mine);   // set up on the student hub: no questions
  if (!known && mine && !error) known=mine;
  if (known && !known.school) known=null;            // older saved students: ask again so we get their school
  if (known && !error){
    const o=overlay(`<h3>Welcome back, ${esc(known.first)}${known.last?" "+esc(known.last)+".":""}! 👋</h3>
      <p>You'll play as <b>${esc(known.nick)}</b>. Is that you?</p>
      <div class="ck-row"><button class="ck-btn" id="ckYes" style="flex:1">Yes, that's me</button><button class="ck-btn alt" id="ckNo">Not me</button></div>`);
    o.querySelector("#ckYes").onclick=()=>send({ first:known.first, last:known.last, nick:known.nick, school:known.school });
    o.querySelector("#ckNo").onclick=()=>askStudent(null);
    return;
  }
  let prev={}; try{ prev=JSON.parse(store.get("jgh_student")||"{}"); }catch{}
  const o=overlay(`<h3>Joining your teacher's game</h3>
    <p>Only your teacher sees your first name. Everyone else sees your nickname.</p>
    <div class="ck-row"><div class="ck-f"><label for="ckFirst">First name</label><input id="ckFirst" maxlength="20" autocomplete="off" value="${esc(prev.first)}"></div>
      <div class="ck-f" style="flex:0 0 96px"><label for="ckLast">Last initial</label><input id="ckLast" maxlength="1" autocomplete="off" value="${esc(prev.last)}" style="text-transform:uppercase;text-align:center"></div></div>
    <div class="ck-f"><label for="ckNick">Nickname (what classmates see)</label><input id="ckNick" maxlength="14" autocomplete="off" value="${esc(prev.nick)}" placeholder="e.g. Rocket"></div>
    <div class="ck-f"><label for="ckSchool">School</label><select id="ckSchool"><option value="">Loading…</option></select></div>
    <p class="ck-err" id="ckErr">${esc(error||"")}</p>
    <button class="ck-btn" id="ckGo" style="width:100%">Let's play!</button>`);
  schoolOptions(o.querySelector("#ckSchool"),prev.school||teacherSchool);
  const go=()=>{ const s={ first:o.querySelector("#ckFirst").value.trim(), last:o.querySelector("#ckLast").value.trim().toUpperCase(), nick:o.querySelector("#ckNick").value.trim(),
      school:o.querySelector("#ckSchool").value||(SCHOOLS&&!SCHOOLS.length?"-":"") };
    if (!s.first) return o.querySelector("#ckErr").textContent="Please type your first name.";
    if (!/^\p{L}$/u.test(s.last)) return o.querySelector("#ckErr").textContent="Please add the first letter of your last name.";
    if (!s.school) return o.querySelector("#ckErr").textContent="Please pick your school.";
    send(s); };
  o.querySelector("#ckGo").onclick=go;
  o.querySelectorAll("input,select").forEach(i=>i.addEventListener("keydown",e=>{ e.stopPropagation(); if (e.key==="Enter") go(); }));
  setTimeout(()=>o.querySelector("#ckFirst").focus(),50);
}

// ---------- teachers: which class is playing?
async function beginTeacher(go){
  ClassKit.classId=null;
  if (!store.get("jgh_auth")) return go();
  let classes;
  try{ classes=(await api("/api/classes")).classes; }
  catch(e){ if (e.status===401) store.set("jgh_auth",null); return go(); }
  const o=overlay(`<h3>🍎 Which class is playing?</h3><p>Results will save to this class automatically.</p>
    <div class="ck-list">${classes.map(c=>`<div class="ck-cls" data-id="${c.id}">${esc(c.name)}<small>${c.students} students${c.role==="coteacher"?" · co-teacher":""}</small></div>`).join("")||`<p>You don't have a class yet. Make one:</p>`}</div>
    <div class="ck-row"><div class="ck-f" style="margin:0"><input id="ckNew" maxlength="60" placeholder="New class name (e.g. 5B Maths)"></div><button class="ck-btn alt" id="ckAdd">Add</button></div>
    <p style="margin:12px 0 0;text-align:center"><a href="#" id="ckSkip" style="color:#5a6676;font-size:14px">Play without saving results</a></p>`);
  o.querySelectorAll(".ck-cls").forEach(el=>el.onclick=()=>{ ClassKit.classId=+el.dataset.id; close(); go(); });
  o.querySelector("#ckSkip").onclick=e=>{ e.preventDefault(); close(); go(); };
  o.querySelector("#ckNew").addEventListener("keydown",e=>e.stopPropagation());
  o.querySelector("#ckAdd").onclick=async()=>{ const name=o.querySelector("#ckNew").value.trim(); if (!name) return;
    try{ const c=(await api("/api/classes",{ method:"POST", body:JSON.stringify({ name }) })).class; ClassKit.classId=c.id; close(); toast(`Playing as ${c.name}`); go(); }catch(e){ toast(e.message); } };
}

// ---------- after the game: "See class results"
function resultsButton(m){
  document.querySelectorAll(".ck-res").forEach(x=>x.remove());
  const href=m.sessionId?`/teacher/#session/${m.sessionId}`:`/teacher/?claim=${encodeURIComponent(m.claim)}`;
  const d=document.createElement("div"); d.className="ck-res";
  d.innerHTML=`<div><b>📊 Class results are ready</b><span>${m.sessionId?`Saved to your class.${m.bricks?` 🧱 +${Number(m.bricks).toLocaleString()} bricks for your castle!`:""}${m.won?` 🏆 You won ${esc(m.won)}!`:""}`:"Create a free teacher account to keep them (and earn castle bricks)."}</span></div>
    <a class="ck-btn" href="${href}" target="_blank" rel="noopener">See class results</a><button class="ck-x" aria-label="Close">✕</button>`;
  d.querySelector(".ck-x").onclick=()=>d.remove();
  document.body.appendChild(d);
}

// ---------- lobby extras: start countdown (teacher pressed Start), "you're in" for students, room code while playing
const me={ pid:0 }; let last=null, cdTimer=0;
function el(id,cls){ let d=document.getElementById(id); if (!d){ d=document.createElement("div"); d.id=id; document.body.appendChild(d); } d.className=cls; return d; }
function drop(id){ const d=document.getElementById(id); if (d) d.remove(); }
function onLobby(L){
  last=L; L.at=performance.now();
  const iTeach=!!L.teacher&&L.teacher===me.pid, student=!!L.teacher&&!iTeach;
  clearInterval(cdTimer); drop("ckCount");
  if (L.state==="lobby"){ drop("ckBoard"); drop("ckMe"); drop("ckCode"); }
  if (L.state==="lobby" && L.closeIn>0){
    const tick=()=>{ const s=Math.max(0,Math.ceil((L.closeIn-(performance.now()-L.at))/1000));
      el("ckCount","ck-banner").innerHTML=`<b>${s}</b><div>${iTeach?"Starting soon…":"The game is starting!"}<small>${iTeach?"Press Start again to begin right now.":document.getElementById("ckOv")?"Finish typing your name!":"Get ready…"}</small></div>`; };
    tick(); cdTimer=setInterval(tick,200); return;
  }
  if (student && L.state==="lobby"){ const mine=(L.players||[]).find(p=>p.pid===me.pid);
    if (mine && !mine.pending) el("ckCount","ck-banner ok").innerHTML=`<div>✅ You're in, ${esc(mine.name)}!<small>Waiting for your teacher to press Start.</small></div>`; }
  if (L.state==="playing" && !L.teacher && !L.pub && L.code) el("ckCode","ck-me").innerHTML=`Room <span>${esc(L.code)}</span> · friends can join`;
  if (L.state==="playing" && iTeach && !document.getElementById("ckBoard")) onBoard({ code:L.code, rows:[] });
  digitPicker(L);
}
// Math Race + Hurdle Dash + Mathsketball: the host (teacher) picks how many digits each number has
function digitPicker(L){
  let d=document.getElementById("ckDigits");
  const lob=document.getElementById("lobby");
  if (!L.digits || !lob || L.mode==="money"){ if (d) d.remove(); return; }
  if (!d){ d=document.createElement("div"); d.id="ckDigits"; d.className="ck-dig";
    const st=document.getElementById("bStart"), row=st&&st.closest(".row");
    if (row) row.parentNode.insertBefore(d,row); else (lob.firstElementChild||lob).appendChild(d);
    d.addEventListener("click",e=>{ const b=e.target.closest("button[data-d]"); if (b && !b.disabled) Net.send({ t:"digits", d:b.dataset.d }); }); }
  const host=L.host===me.pid&&L.state==="lobby";
  d.innerHTML=`<span>${host?"Numbers in each sum (you choose)":"Numbers in each sum"}</span><div>`+[["1","1 digit"],["12","1 & 2 digits"],["2","2 digits"]]
    .map(([k,t])=>`<button type="button" data-d="${k}" class="${L.digits===k?"on":""}"${host?"":" disabled"}>${t}</button>`).join("")+`</div>`;
}
function onBoard(m){
  const L=last; if (!L || !L.teacher || L.state!=="playing") return;
  const iTeach=L.teacher===me.pid, rows=m.rows||[], n=Math.max(3,Math.ceil(rows.length*0.15));   // only the top names are shown
  if (iTeach){
    const b=document.getElementById("ckBoard")||el("ckBoard","ck-board"), codeOnly=document.body.dataset.ckBoard==="code";
    if (!b.dataset.init){ b.dataset.init=1; b.addEventListener("click",e=>{ if (e.target.classList.contains("hide")) b.classList.toggle("min"); }); }
    b.innerHTML=`<button class="hide" type="button">${b.classList.contains("min")?"show":"hide"}</button><div class="cd">Join code<b>${esc(m.code)}</b><span>Late? Open the website, press Student, type this code.</span></div>`
      +(codeOnly||!rows.length?"":`<ol>${rows.slice(0,n).map((r,i)=>`<li><span><i>${i+1}</i>${esc(r.name)}</span><em>${esc(r.v)}</em></li>`).join("")}${rows.length>n?`<li class="more">+ ${rows.length-n} more playing</li>`:""}</ol>`);
  } else {
    const i=rows.findIndex(r=>r.pid===me.pid); if (i<0) return;
    el("ckMe","ck-me").innerHTML=`You: <span>${esc(rows[i].v)}</span> · #${i+1} of ${rows.length}`;
  }
}

// ---------- Student mode: a much simpler game menu (name of game · how to play · Join friends · Make a game · Quick join)
const HOW={
  "math-race":"Solve each sum as fast as you can. Type the answer with the number keys. Get it right and the next one appears!",
  "arrow-blitz":"Arrows appear on screen. Press the same arrow keys in the same order. Each one gets longer!",
  "mathsketball":"Answer 3 math questions right, then take 3 shots. Press Space (or SHOOT) when the line is in the green! Reach the basket goal to win.",
  "softball-smarts":"The pitch comes in slow motion. Type the answer before the ball reaches you! Faster answers hit farther: single, double, triple or HOME RUN. Wrong or too slow = strike.",
  "marble-munch":"Mash Space (or CHOMP) when a marble rolls past your hippo. Caught one? Answer the question before the timer runs out to keep it!",
  "hurdle-dash":"Tap ← → (or the big buttons) to run. At each hurdle, answer the sum to jump over it!",
  "rush-hour":"Steer your car with ← → (or tap left and right). Dodge the traffic and drive over the glowing boost strips!",
  "bear-attack":"Move with the arrow keys (or the joystick). When a red path shows up, get out of it before the bear charges!",
  "memory-tiles":"Look at the pictures, then they hide. Walk onto the tile that matches the picture at the top!",
  "typing-cowboys":"Type the word you see and press Space. Every right word makes your horse gallop!",
  "star-cannons":"Move your cannon with ← →. It fires by itself. Laser the asteroids and don't get squashed!",
  "dart-party":"Walk with the arrow keys (or the joystick). Press Space (or the button) to throw darts at balloons!",
  "sky-climb":"Press Space (or tap) to flap. Steer with ← → through the gaps to reach the top!",
  "word-rush":"Find a word in the big letter grid. Drag across it with your mouse or finger to claim it before anyone else!",
  "clean-getaway":"Grab the cash and get out of the bank without the guards catching you!",
};
function studentMenu(){
  // Students keep the game's own card (title, how-to, art) but only get: the code box + Join, and "Private game".
  // Name box, Play online, Teacher mode and Solo/Practice are hidden; a small "Playing as …" line replaces the name box.
  if (MODE!=="student" || /[?&]demo=1/.test(location.search)) return;
  const $=id=>document.getElementById(id), menu=$("menu"), nameIn=$("nameIn"); if (!menu) return;
  const p=profile();
  if (p){ store.set("cg_name",p.nick); if (nameIn) nameIn.value=p.nick; }
  const hide=el=>{ if (el && menu.contains(el)) el.style.display="none"; };
  ["bPublic","btnPublic","bTeacher","bSolo","bPractice","btnLocal"].forEach(id=>hide($(id)));
  const pr=$("pMode"); if (pr) hide(pr.closest(".practice")||pr.parentElement);
  if (nameIn){
    const box=nameIn.closest("label")&&nameIn.closest("label").parentElement===menu?nameIn.closest("label"):nameIn.parentElement;
    const who=document.createElement("p"); who.className="ck-who";
    who.innerHTML=p?`Playing as <b>${esc(p.nick)}</b> · <a href="/#student">change</a>`:`<a href="/#student">Set up your name first →</a>`;
    if (box && box!==menu){ box.parentNode.insertBefore(who,box); hide(box); }
  }
  // a row left with only "Private game" in it: let that button fill the row
  const pv=$("bPrivate")||$("btnPrivate"); if (pv) pv.style.flex="1 1 100%";
  if (!p){ const go=e=>{ e.preventDefault(); e.stopImmediatePropagation(); location.href="/#student"; };
    [pv,$("bJoin"),$("btnJoin")].forEach(b=>b&&b.addEventListener("click",go,true)); }
}
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",studentMenu):studentMenu();

window.ClassKit={
  classId:null,
  auth(){ return store.get("jgh_auth")||undefined; },
  teacherMsg(){ return { t:"teacher", classId:this.classId||undefined }; },
  beginTeacher,
  onNet(m){
    if (m.t==="joined") me.pid=m.pid;
    if (m.t==="lobby") onLobby(m);
    if (m.t==="board"){ onBoard(m); return true; }
    if (m.t==="whoareyou"){ teacherSchool=m.school||null; askStudent(m.known,m.error); return true; }
    if (m.t==="iamok"){ toast(`You're playing as ${m.student.nick}`); return true; }
    if (m.t==="classresults"){ resultsButton(m); return true; }
    return false;
  },
};
})();
