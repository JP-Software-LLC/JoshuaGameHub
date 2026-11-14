// Teacher REST API (/api/*). Bearer-token auth; CORS open (no cookies are used).
// Every class route checks the caller's role: owner = full control, coteacher = view + save games.
"use strict";
const db=require("./db");
const A=require("./auth");
const C=require("./classdata");

const PENDING_TTL=24*3600;            // unsaved Teacher Mode games are kept for 24 h
const json=(res,status,body)=>{ res.writeHead(status,{ "content-type":"application/json","cache-control":"no-store",...CORS }); res.end(JSON.stringify(body)); };
const CORS={ "access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"GET,POST,PATCH,DELETE,OPTIONS" };
async function body(req){ let s=""; for await (const c of req){ s+=c; if (s.length>200e3) throw A.httpErr(413,"Too much data."); } try{ return s?JSON.parse(s):{}; }catch{ throw A.httpErr(400,"Bad JSON."); } }
const ipOf=req=>String(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"").split(",")[0].trim();

function makeApi(bus){
  const pendingKey=c=>`cg:pending:${c}`;
  async function needTeacher(req){
    const t=await A.teacherFromToken(String(req.headers.authorization||"").replace(/^Bearer /,""));
    if (!t) throw A.httpErr(401,"Please sign in.");
    return t;
  }
  async function needRole(t,classId,want){
    const role=await C.roleIn(t.id,classId);
    if (!role || (want==="owner"&&role!=="owner")) throw A.httpErr(role?403:404,role?"Only the class owner can do that.":"Class not found.");
    return role;
  }
  const routes=[
    ["GET","/api/config",async()=>({ googleClientId:process.env.GOOGLE_CLIENT_ID||null, emailEnabled:A.emailEnabled() })],
    ["GET","/api/schools",async()=>({ schools:C.SCHOOLS })],
    // ---- auth
    ["POST","/api/auth/email",async(req,b)=>A.startEmailLogin(b.email,ipOf(req))],
    ["POST","/api/auth/email/verify",async(req,b)=>A.verifyEmailLogin(b.token)],
    ["POST","/api/auth/google",async(req,b)=>A.googleLogin(b.credential)],
    ["POST","/api/auth/logout",async req=>{ await A.logout(String(req.headers.authorization||"").replace(/^Bearer /,"")); return { ok:true }; }],
    ["GET","/api/me",async req=>{ const t=await needTeacher(req); return { teacher:A.publicTeacher(t), school:C.schoolById(t.school_id) }; }],
    ["PATCH","/api/me",async(req,b)=>{ const t=await needTeacher(req);
      const name=String(b.displayName??t.display_name).replace(/[<>]/g,"").trim().slice(0,60), school=b.schoolId===undefined?t.school_id:(C.schoolById(b.schoolId)?b.schoolId:null);
      const u=await db.one("update teachers set display_name=$2, school_id=$3 where id=$1 returning *",[t.id,name,school]); return { teacher:A.publicTeacher(u) }; }],
    ["DELETE","/api/me",async req=>{ const t=await needTeacher(req); await db.q("delete from teachers where id=$1",[t.id]); return { ok:true }; }],   // cascades: owned classes, students, games
    // ---- classes
    ["GET","/api/classes",async req=>{ const t=await needTeacher(req);
      return { classes:(await db.all(`select c.id,c.name,m.role,c.created_at,(select count(*) from students s where s.class_id=c.id)::int as students,
        (select count(*) from game_sessions g where g.class_id=c.id)::int as games, o.display_name as owner_name, o.email as owner_email
        from class_members m join classes c on c.id=m.class_id join teachers o on o.id=c.owner_id where m.teacher_id=$1 order by c.created_at`,[t.id])).map(r=>({ ...r, id:+r.id })) }; }],
    ["POST","/api/classes",async(req,b)=>{ const t=await needTeacher(req); const name=String(b.name||"").replace(/[<>]/g,"").trim().slice(0,60); if (!name) throw A.httpErr(400,"Give the class a name.");
      const n=await db.one("select count(*)::int n from classes where owner_id=$1",[t.id]); if (n.n>=50) throw A.httpErr(400,"That's a lot of classes! The limit is 50.");
      const c=await db.one("insert into classes(owner_id,name) values($1,$2) returning id,name",[t.id,name]); await db.q("insert into class_members values($1,$2,'owner')",[c.id,t.id]); return { class:{ id:+c.id, name:c.name, role:"owner" } }; }],
    ["PATCH","/api/classes/:id",async(req,b,p)=>{ const t=await needTeacher(req); await needRole(t,p.id,"owner"); const name=String(b.name||"").replace(/[<>]/g,"").trim().slice(0,60); if (!name) throw A.httpErr(400,"Name required.");
      await db.q("update classes set name=$2 where id=$1",[p.id,name]); return { ok:true }; }],
    ["DELETE","/api/classes/:id",async(req,b,p)=>{ const t=await needTeacher(req); await needRole(t,p.id,"owner"); await db.q("delete from classes where id=$1",[p.id]); return { ok:true }; }],
    // ---- secure sharing: owner invites an email; only someone signed in with that exact email can accept, once, within 7 days
    ["GET","/api/classes/:id/members",async(req,b,p)=>{ const t=await needTeacher(req); const role=await needRole(t,p.id);
      const members=(await db.all("select t.id,t.email,t.display_name,m.role from class_members m join teachers t on t.id=m.teacher_id where m.class_id=$1 order by m.role desc,t.email",[p.id])).map(r=>({ ...r, id:+r.id }));
      const invites=role==="owner"?await db.all("select email,expires_at from class_invites where class_id=$1 and used_at is null and expires_at>now() order by expires_at",[p.id]):[];
      return { members, invites, you:role }; }],
    ["POST","/api/classes/:id/invites",async(req,b,p)=>{ const t=await needTeacher(req); await needRole(t,p.id,"owner");
      const email=A.cleanEmail(b.email); if (!A.validEmail(email)) throw A.httpErr(400,"Please enter a valid email address."); if (email===t.email) throw A.httpErr(400,"That's you!");
      if (A.limited("inv:"+t.id,20,3600e3)) throw A.httpErr(429,"Too many invites. Please try again later.");
      const c=await db.one("select name from classes where id=$1",[p.id]), token=A.newToken();
      await db.q("delete from class_invites where class_id=$1 and email=$2 and used_at is null",[p.id,email]);
      await db.q("insert into class_invites(token_hash,class_id,email,invited_by,expires_at) values($1,$2,$3,$4,now()+interval '7 days')",[A.hash(token),p.id,email,t.id]);
      const link=`${A.APP_URL()}/teacher/?invite=${token}`, who=t.display_name||t.email;
      const sent=await A.sendEmail(email,`${who} shared a class with you on Joshua Game Hub`,
        `${who} invited you to co-teach "${c.name}" on Joshua Game Hub.\n\nAccept (sign in with ${email}):\n${link}\n\nThis invite works once and expires in 7 days.`,
        `<p>${esc(who)} invited you to co-teach <b>${esc(c.name)}</b> on Joshua Game Hub.</p><p><a href="${link}">Accept the invite</a> (sign in with ${esc(email)})</p><p style="color:#666">This invite works once and expires in 7 days.</p>`);
      return { ok:true, delivered:sent.delivered, devLink:process.env.ALLOW_DEV_LINKS==="1"?link:undefined }; }],
    ["DELETE","/api/classes/:id/invites",async(req,b,p)=>{ const t=await needTeacher(req); await needRole(t,p.id,"owner"); await db.q("delete from class_invites where class_id=$1 and email=$2",[p.id,A.cleanEmail(b.email)]); return { ok:true }; }],
    ["POST","/api/invites/accept",async(req,b)=>{ const t=await needTeacher(req);
      const inv=await db.one("select * from class_invites where token_hash=$1",[A.hash(b.token)]);
      if (!inv||inv.used_at||new Date(inv.expires_at)<new Date()) throw A.httpErr(400,"That invite has expired or was already used. Ask the class owner for a new one.");
      if (inv.email!==t.email) throw A.httpErr(403,`This invite was sent to ${inv.email}. Please sign in with that email to accept it.`);
      await db.q("update class_invites set used_at=now() where token_hash=$1",[inv.token_hash]);
      await db.q("insert into class_members values($1,$2,'coteacher') on conflict do nothing",[inv.class_id,t.id]);
      return { classId:+inv.class_id }; }],
    ["DELETE","/api/classes/:id/members/:tid",async(req,b,p)=>{ const t=await needTeacher(req); const role=await needRole(t,p.id);
      if (+p.tid===+t.id){ if (role==="owner") throw A.httpErr(400,"Owners can delete the class instead."); }      // co-teachers may leave
      else if (role!=="owner") throw A.httpErr(403,"Only the class owner can remove co-teachers.");
      await db.q("delete from class_members where class_id=$1 and teacher_id=$2 and role='coteacher'",[p.id,p.tid]); return { ok:true }; }],
    // ---- games + students
    ["GET","/api/classes/:id/sessions",async(req,b,p)=>{ const t=await needTeacher(req); await needRole(t,p.id);
      return { sessions:(await db.all("select id,game,mode,room_code,ended_at,player_count,summary from game_sessions where class_id=$1 order by ended_at desc limit 200",[p.id])).map(r=>({ ...r, id:+r.id })) }; }],
    ["GET","/api/sessions/:id",async(req,b,p)=>{ const t=await needTeacher(req); const s=await db.one("select * from game_sessions where id=$1",[p.id]); if (!s) throw A.httpErr(404,"Game not found.");
      await needRole(t,s.class_id);
      const results=await db.all(`select r.place,r.score,r.stats,r.log,s.id as student_id,s.first_name,s.last_initial,s.nickname from session_results r join students s on s.id=r.student_id
        where r.session_id=$1 order by r.place nulls last, r.score desc nulls last`,[p.id]);
      return { session:{ ...s, id:+s.id, class_id:+s.class_id }, results:results.map(r=>({ ...r, student_id:+r.student_id })) }; }],
    ["DELETE","/api/sessions/:id",async(req,b,p)=>{ const t=await needTeacher(req); const s=await db.one("select class_id from game_sessions where id=$1",[p.id]); if (!s) throw A.httpErr(404,"Game not found.");
      await needRole(t,s.class_id,"owner"); await db.q("delete from game_sessions where id=$1",[p.id]); return { ok:true }; }],
    ["GET","/api/classes/:id/students",async(req,b,p)=>{ const t=await needTeacher(req); await needRole(t,p.id);
      return { students:(await db.all(`select s.id,s.first_name,s.last_initial,s.nickname,s.last_seen_at,count(r.session_id)::int as games,avg(r.place)::float as avg_place
        from students s left join session_results r on r.student_id=s.id where s.class_id=$1 group by s.id order by s.first_name,s.last_initial`,[p.id])).map(r=>({ ...r, id:+r.id })) }; }],
    ["GET","/api/students/:id",async(req,b,p)=>{ const t=await needTeacher(req); const s=await db.one("select * from students where id=$1",[p.id]); if (!s) throw A.httpErr(404,"Student not found.");
      await needRole(t,s.class_id);
      const history=await db.all(`select g.id as session_id,g.game,g.mode,g.ended_at,g.player_count,r.place,r.score,r.stats,r.log from session_results r join game_sessions g on g.id=r.session_id
        where r.student_id=$1 order by g.ended_at desc limit 300`,[p.id]);
      return { student:{ id:+s.id, classId:+s.class_id, first:s.first_name, last:s.last_initial, nick:s.nickname }, history:history.map(h=>({ ...h, session_id:+h.session_id })) }; }],
    ["PATCH","/api/students/:id",async(req,b,p)=>{ const t=await needTeacher(req); const s=await db.one("select class_id from students where id=$1",[p.id]); if (!s) throw A.httpErr(404,"Student not found.");
      await needRole(t,s.class_id,"owner"); const st=C.cleanStudent({ first:b.first, last:b.last, nick:b.nick }); if (!st) throw A.httpErr(400,"First name required.");
      await db.q("update students set first_name=$2,last_initial=$3,nickname=$4 where id=$1",[p.id,st.first,st.last,st.nick]); return { ok:true }; }],
    ["DELETE","/api/students/:id",async(req,b,p)=>{ const t=await needTeacher(req); const s=await db.one("select class_id from students where id=$1",[p.id]); if (!s) throw A.httpErr(404,"Student not found.");
      await needRole(t,s.class_id,"owner"); await db.q("delete from students where id=$1",[p.id]); return { ok:true }; }],
    // ---- "See class results": a finished Teacher Mode game waiting to be saved
    ["GET","/api/pending/:claim",async(req,b,p)=>{ const rec=await bus.get(pendingKey(p.claim)); if (!rec) throw A.httpErr(404,"Those results have expired (they're kept for 24 hours).");
      return { game:rec.game, mode:rec.mode, endedAt:rec.endedAt, players:rec.results.length }; }],
    ["POST","/api/pending/:claim/save",async(req,b,p)=>{ const t=await needTeacher(req); await needRole(t,b.classId);
      const rec=await bus.get(pendingKey(p.claim)); if (!rec) throw A.httpErr(404,"Those results have expired (they're kept for 24 hours).");
      const id=await C.saveSession(+b.classId,t.id,rec); await bus.del(pendingKey(p.claim)); return { sessionId:id }; }],
  ];
  const compiled=routes.map(([m,pat,fn])=>({ m, fn, keys:(pat.match(/:\w+/g)||[]).map(k=>k.slice(1)), re:new RegExp("^"+pat.replace(/:\w+/g,"([A-Za-z0-9_-]+)")+"$") }));
  async function handle(req,res){
    if (req.method==="OPTIONS"){ res.writeHead(204,CORS); return res.end(); }
    const url=new URL(req.url,"http://x");
    for (const r of compiled){
      if (r.m!==req.method) continue;
      const mm=r.re.exec(url.pathname); if (!mm) continue;
      const p=Object.fromEntries(r.keys.map((k,i)=>[k,mm[i+1]]));
      try{ const b=["POST","PATCH","DELETE"].includes(req.method)?await body(req):{}; return json(res,200,await r.fn(req,b,p)); }
      catch(e){ if (!e.status) console.error("[api]",e); return json(res,e.status||500,{ error:e.status?e.message:"Something went wrong." }); }
    }
    json(res,404,{ error:"Not found." });
  }
  return { handle, pendingKey, PENDING_TTL };
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
module.exports={ makeApi };
