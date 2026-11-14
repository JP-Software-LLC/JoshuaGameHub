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
.ck-f input{border:2px solid #dfe6ee;border-radius:12px;padding:11px 12px;font-size:17px;font-family:inherit;outline:none;color:#16202e}
.ck-f input:focus{border-color:#3b82f6}
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
.ck-toast{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9998;background:#16202e;color:#fff;border-radius:999px;padding:8px 16px;font:600 14px system-ui,sans-serif;animation:ckpop .3s}`;
const st=document.createElement("style"); st.textContent=css; document.head.appendChild(st);
function overlay(html){ close(); const o=document.createElement("div"); o.className="ck-ov"; o.id="ckOv"; o.innerHTML=`<div class="ck-card">${html}</div>`; document.body.appendChild(o); return o; }
function close(){ const o=document.getElementById("ckOv"); if (o) o.remove(); }
function toast(t){ const d=document.createElement("div"); d.className="ck-toast"; d.textContent=t; document.body.appendChild(d); setTimeout(()=>d.remove(),2600); }

// ---------- students: who are you?
function askStudent(known,error){
  const send=s=>{ store.set("jgh_student",JSON.stringify(s)); Net.send({ t:"iam", ...s }); close(); };
  if (known && !error){
    const o=overlay(`<h3>Welcome back, ${esc(known.first)}${known.last?" "+esc(known.last)+".":""}! 👋</h3>
      <p>You'll play as <b>${esc(known.nick)}</b>. Is that you?</p>
      <div class="ck-row"><button class="ck-btn" id="ckYes" style="flex:1">Yes, that's me</button><button class="ck-btn alt" id="ckNo">Not me</button></div>`);
    o.querySelector("#ckYes").onclick=()=>send({ first:known.first, last:known.last, nick:known.nick });
    o.querySelector("#ckNo").onclick=()=>askStudent(null);
    return;
  }
  let prev={}; try{ prev=JSON.parse(store.get("jgh_student")||"{}"); }catch{}
  const o=overlay(`<h3>Joining your teacher's game</h3>
    <p>Only your teacher sees your first name. Everyone else sees your nickname.</p>
    <div class="ck-row"><div class="ck-f"><label for="ckFirst">First name</label><input id="ckFirst" maxlength="20" autocomplete="off" value="${esc(prev.first)}"></div>
      <div class="ck-f" style="flex:0 0 96px"><label for="ckLast">Last initial</label><input id="ckLast" maxlength="1" autocomplete="off" value="${esc(prev.last)}" style="text-transform:uppercase;text-align:center"></div></div>
    <div class="ck-f"><label for="ckNick">Nickname (what classmates see)</label><input id="ckNick" maxlength="14" autocomplete="off" value="${esc(prev.nick)}" placeholder="e.g. Rocket"></div>
    <p class="ck-err" id="ckErr">${esc(error||"")}</p>
    <button class="ck-btn" id="ckGo" style="width:100%">Let's play!</button>`);
  const go=()=>{ const s={ first:o.querySelector("#ckFirst").value.trim(), last:o.querySelector("#ckLast").value.trim().toUpperCase(), nick:o.querySelector("#ckNick").value.trim() };
    if (!s.first) return o.querySelector("#ckErr").textContent="Please type your first name.";
    if (!/^\p{L}$/u.test(s.last)) return o.querySelector("#ckErr").textContent="Please add the first letter of your last name.";
    send(s); };
  o.querySelector("#ckGo").onclick=go;
  o.querySelectorAll("input").forEach(i=>i.addEventListener("keydown",e=>{ e.stopPropagation(); if (e.key==="Enter") go(); }));
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
  d.innerHTML=`<div><b>📊 Class results are ready</b><span>${m.sessionId?"Saved to your class.":"Create a free teacher account to keep them."}</span></div>
    <a class="ck-btn" href="${href}" target="_blank" rel="noopener">See class results</a><button class="ck-x" aria-label="Close">✕</button>`;
  d.querySelector(".ck-x").onclick=()=>d.remove();
  document.body.appendChild(d);
}

window.ClassKit={
  classId:null,
  auth(){ return store.get("jgh_auth")||undefined; },
  teacherMsg(){ return { t:"teacher", classId:this.classId||undefined }; },
  beginTeacher,
  onNet(m){
    if (m.t==="whoareyou"){ askStudent(m.known,m.error); return true; }
    if (m.t==="iamok"){ toast(`You're playing as ${m.student.nick}`); return true; }
    if (m.t==="classresults"){ resultsButton(m); return true; }
    return false;
  },
};
})();
