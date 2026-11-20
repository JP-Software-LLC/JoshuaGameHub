// Shared bits for the /admin/ pages: nav, sign-in check, API calls. Admin = signed-in teacher whose email is in ADMIN_EMAILS.
"use strict";
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const n=v=>Math.round(v||0).toLocaleString();
const apiBase=()=>{ const s=(window.CG_CONFIG&&CG_CONFIG.server)||""; return s?s.replace(/^ws/,"http").replace(/\/$/,""):""; };
const token=()=>{ try{ return localStorage.getItem("jgh_auth"); }catch{ return null; } };
const ago=d=>{ if (!d) return "never"; const s=(Date.now()-new Date(d))/1e3; if (s<3600) return Math.max(1,s/60|0)+" min ago"; if (s<86400) return (s/3600|0)+" h ago"; if (s<86400*30) return (s/86400|0)+" days ago"; return new Date(d).toLocaleDateString(undefined,{ year:"numeric", month:"short", day:"numeric" }); };
async function api(path,method="GET",body){
  const r=await fetch(apiBase()+path,{ method, headers:{ authorization:"Bearer "+token(), "content-type":"application/json" }, body:body?JSON.stringify(body):undefined });
  const d=await r.json().catch(()=>({}));
  if (!r.ok){ const e=new Error(d.error||"Something went wrong."); e.status=r.status; throw e; }
  return d;
}
// a page shows this instead of its content when the visitor isn't a signed-in admin
function gate(e){
  const out=document.getElementById("out");
  if (!token()||e&&e.status===401) out.innerHTML=`<div class="msg">Please <a href="/teacher/">sign in on the teacher page</a> with an admin email first, then come back here.</div>`;
  else out.innerHTML=`<div class="msg">${esc(e?e.message:"Couldn't reach the server.")}</div>`;
}
(function nav(){
  const here=location.pathname.replace(/index\.html$/,"");
  const tabs=[["/admin/","📊 Analytics"],["/admin/live/","🟢 Live now"],["/admin/teachers/","🍎 Teachers"],["/admin/students/","🎒 Students"],["/admin/schools/","🏫 Schools & tournaments"]];
  const el=document.createElement("nav"); el.className="anav"; el.setAttribute("aria-label","Admin pages");
  el.innerHTML=`<a class="brand" href="/admin/">JGH <span>Admin</span></a>${tabs.map(([h,t])=>`<a class="tab" href="${h}"${here===h?' aria-current="page"':""}>${t}</a>`).join("")}
    <span class="sp"></span><a class="out" href="/">← Back to the site</a>`;
  document.querySelector("main").prepend(el);
  if (here==="/admin/" && location.hash==="#teachers") location.replace("/admin/teachers/");   // old link
})();
