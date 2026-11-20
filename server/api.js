// Teacher REST API (/api/*). Bearer-token auth; CORS open (no cookies are used).
// Every class route checks the caller's role: owner = full control, coteacher = view + save games.
"use strict";
const db=require("./db");
const A=require("./auth");
const C=require("./classdata");
const STATS=require("./stats");

const PENDING_TTL=24*3600;            // unsaved Teacher Mode games are kept for 24 h
const json=(res,status,body)=>{ res.writeHead(status,{ "content-type":"application/json","cache-control":"no-store",...CORS }); res.end(JSON.stringify(body)); };
const CORS={ "access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"GET,POST,PATCH,DELETE,OPTIONS" };
async function body(req){ let s=""; for await (const c of req){ s+=c; if (s.length>200e3) throw A.httpErr(413,"Too much data."); } try{ return s?JSON.parse(s):{}; }catch{ throw A.httpErr(400,"Bad JSON."); } }
const ipOf=req=>String(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"").split(",")[0].trim();

function makeApi(bus,host={}){
  const pendingKey=c=>`cg:pending:${c}`;
  async function needTeacher(req,opt={}){
    const t=await A.teacherFromToken(String(req.headers.authorization||"").replace(/^Bearer /,""));
    if (!t) throw A.httpErr(401,"Please sign in.");
    // an admin-issued temporary password must be replaced before anything else can be changed
    if (t.must_change && !t.viewed_by && req.method!=="GET" && !opt.pwSetup) throw A.httpErr(403,"Please choose a new password first.");
    // admin "view as" sessions are read-only
    if (t.viewed_by && req.method!=="GET") throw A.httpErr(403,"View only: you're looking at this teacher's account as an admin, so nothing can be changed.");
    return t;
  }
  async function needAdmin(req){
    const t=await needTeacher(req);
    const why=A.adminProblem(t); if (why) throw A.httpErr(403,why);
    return t;
  }
  async function needRole(t,classId,want){
    const role=await C.roleIn(t.id,classId);
    if (!role || (want==="owner"&&role!=="owner")) throw A.httpErr(role?403:404,role?"Only the class owner can do that.":"Class not found.");
    return role;
  }
  const routes=[
    ["GET","/api/config",async()=>({ googleClientId:process.env.GOOGLE_CLIENT_ID||null, emailEnabled:A.emailEnabled(), noVerify:A.noVerify(), questions:A.QUESTIONS })],
    // ---- analytics: the hub reports which view was picked; site admins (ADMIN_EMAILS) read the totals
    ["POST","/api/hit",async(req,b)=>{ if (STATS.isBot(req.headers["user-agent"])) return { ok:true };   // crawlers never count
      if (b.mode) STATS.mode(String(b.mode)); if (b.view!==undefined) STATS.view(b.view,String(b.play||"")); return { ok:true }; }],
    ["GET","/api/admin/stats",async req=>{ await needAdmin(req); return STATS.report(+new URL(req.url,"http://x").searchParams.get("days")||30); }],
    // every teacher account, newest first, with what they've set up
    // ---- live games on this server right now (admin "Live now" page). Read only.
    ["GET","/api/admin/live",async req=>{ await needAdmin(req);
      const games=host.live?host.live():[];
      const tids=[...new Set(games.map(g=>g.teacherAcct&&g.teacherAcct.teacherId).filter(Boolean))], cids=[...new Set(games.map(g=>g.teacherAcct&&g.teacherAcct.classId).filter(Boolean))];
      const schools=await C.loadSchools().catch(()=>[]);
      const tRows=tids.length?await db.all("select id,email,display_name,school_id from teachers where id=any($1)",[tids]).catch(()=>[]):[];
      const cRows=cids.length?await db.all("select id,name from classes where id=any($1)",[cids]).catch(()=>[]):[];
      const sch=id=>{ const s=schools.find(x=>String(x.id)===String(id)); return s?`${s.name}, ${s.state}`:""; };
      for (const g of games){
        const a=g.teacherAcct||{}, tr=tRows.find(r=>+r.id===+a.teacherId), cr=cRows.find(r=>+r.id===+a.classId);
        g.account=tr?{ id:+tr.id, email:tr.email, name:tr.display_name||"", school:sch(tr.school_id) }:null;
        g.className=cr?cr.name:null; delete g.teacherAcct;
        for (const p of g.players) if (p.student) p.student={ ...p.student, school:sch(p.student.school)||p.student.school||"" };
      }
      return { now:Date.now(), games }; }],
    ["GET","/api/admin/teachers",async req=>{ await needAdmin(req); const schools=await C.loadSchools();
      const rows=await db.all(`select t.id,t.email,t.display_name,t.school_id,(t.google_sub is not null) as google,t.created_at,t.last_login_at,t.bricks::float8 as bricks,t.castle_games,
        (t.pw_hash is not null) as has_password, t.must_change, (t.recovery_hash is not null) as has_recovery, (t.locked_until is not null and t.locked_until>now()) as locked,
        (select count(*) from class_members m where m.teacher_id=t.id and m.role='owner')::int as classes,
        (select count(*) from class_members m where m.teacher_id=t.id and m.role='coteacher')::int as shared,
        (select count(*) from students s join classes c on c.id=s.class_id where c.owner_id=t.id)::int as students,
        (select count(*) from game_sessions g join classes c on c.id=g.class_id where c.owner_id=t.id)::int as games,
        (select max(g.ended_at) from game_sessions g join class_members m on m.class_id=g.class_id where m.teacher_id=t.id) as last_game
        from teachers t order by t.created_at desc`);
      return { teachers:rows.map(r=>{ const sc=schools.find(x=>x.id===r.school_id); return { ...r, id:+r.id, bricks:+r.bricks, school:sc?`${sc.name}, ${sc.state}`:"" }; }) }; }],
    // ---- schools list (teachers and students pick from it); admins add / rename / remove
    ["GET","/api/admin/schools",async req=>{ await needAdmin(req); await C.loadSchools(true);
      const rows=await db.all(`select s.id,s.name,s.state,s.created_at,(select count(*) from teachers t where t.school_id=s.id)::int as teachers,
        (select count(*) from students st where st.school_id=s.id)::int as students,(select coalesce(sum(t.bricks),0) from teachers t where t.school_id=s.id)::float8 as bricks,
        (select json_build_object('id',tn.id,'name',tn.name,'goal',tn.goal,'startedAt',tn.started_at) from tournaments tn where tn.school_id=s.id and tn.ended_at is null limit 1) as tournament,
        (select json_build_object('name',tn.name,'winner',tn.winner_name,'endedAt',tn.ended_at) from tournaments tn where tn.school_id=s.id and tn.ended_at is not null order by tn.ended_at desc limit 1) as last_tournament
        from schools s order by s.state,s.name`);
      return { schools:rows }; }],
    ["POST","/api/admin/schools",async(req,b)=>{ await needAdmin(req); const { name,state }=cleanSchool(b);
      const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,30)||"school";
      const id=`${slug}-${(state||"xx").toLowerCase()}-${A.newToken().replace(/[^a-z0-9]/gi,"").slice(0,4).toLowerCase()}`;
      await db.q("insert into schools(id,name,state) values($1,$2,$3)",[id,name,state]); await C.loadSchools(true); return { school:{ id, name, state } }; }],
    ["PATCH","/api/admin/schools/:id",async(req,b,p)=>{ await needAdmin(req); const { name,state }=cleanSchool(b);
      const r=await db.one("update schools set name=$2,state=$3 where id=$1 returning id,name,state",[p.id,name,state]); if (!r) throw A.httpErr(404,"School not found.");
      await C.loadSchools(true); return { school:r }; }],
    ["DELETE","/api/admin/schools/:id",async(req,b,p)=>{ await needAdmin(req);
      const n=await db.one("select count(*)::int n from teachers where school_id=$1",[p.id]);
      if (n.n) throw A.httpErr(409,`${n.n} teacher${n.n>1?"s use":" uses"} this school, so it can't be removed. Rename it instead, or ask them to pick another school.`);
      await db.q("update students set school_id=null where school_id=$1",[p.id]); await db.q("delete from schools where id=$1",[p.id]); await C.loadSchools(true); return { ok:true }; }],
    // ---- school page (public): castles of the teachers at a school (display name + bricks only) + tournaments
    ["GET","/api/school/:id",async(req,b,p)=>{ const r=await C.schoolPage(C.schoolId(p.id)); if (!r) throw A.httpErr(404,"School not found."); return r; }],
    // ---- tournaments (admins): one running per school
    ["POST","/api/admin/schools/:id/tournament",async(req,b,p)=>{ const a=await needAdmin(req); if (!await C.schoolById(p.id)) throw A.httpErr(404,"School not found.");
      const name=String(b.name||"").replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0,60)||"Castle Tournament", goal=Math.round(+b.goal);
      if (!(goal>=100&&goal<=10000000)) throw A.httpErr(400,"Pick a goal between 100 and 10,000,000 bricks.");
      if (await db.one("select id from tournaments where school_id=$1 and ended_at is null",[p.id])) throw A.httpErr(409,"This school already has a tournament running. End it first.");
      const r=await db.one("insert into tournaments(school_id,name,goal,created_by) values($1,$2,$3,$4) returning id",[p.id,name,goal,a.id]); return { id:+r.id }; }],
    ["POST","/api/admin/tournaments/:id/end",async(req,b,p)=>{ await needAdmin(req); const r=await db.one("update tournaments set ended_at=now() where id=$1 and ended_at is null returning id",[p.id]);
      if (!r) throw A.httpErr(404,"No running tournament with that id."); return { ok:true }; }],
    // open a read-only session as that teacher (the /teacher/ page uses it in its own tab)
    // ---- admin Students board. One student = same first name (any case) + same last initial.
    // Sources: student_activity (every named join / game start in a teacher room) + saved class results (place, bricks).
    ["GET","/api/admin/students",async req=>{ await needAdmin(req);
      const days=Math.max(1,Math.min(3650,+new URL(req.url,"http://x").searchParams.get("days")||30));
      const since=`now()-($1||' days')::interval`;
      const act=await db.all(`select kind,first_name,last_initial,nickname,school_id,game,room_code,teacher_id,at from student_activity where at>${since}`,[String(days)]);
      const res=await db.all(`select s.first_name,s.last_initial,s.nickname,s.school_id,g.game,g.saved_by as teacher_id,g.ended_at as at,r.place,r.bricks,g.player_count
        from session_results r join students s on s.id=r.student_id join game_sessions g on g.id=r.session_id where g.ended_at>${since}`,[String(days)]);
      const schools=await C.loadSchools().catch(()=>[]), sch=id=>{ const x=schools.find(s=>String(s.id)===String(id)); return x?`${x.name}, ${x.state}`:""; };
      const tRows=await db.all("select id,display_name,email from teachers"), tname=id=>{ const t=tRows.find(r=>+r.id===+id); return t?(t.display_name||t.email):""; };
      const by=new Map();
      const who=r=>{ const first=String(r.first_name||"").trim(), key=first.toLowerCase()+"|"+String(r.last_initial||"").toUpperCase();
        let s=by.get(key);
        if (!s){ s={ key, first:first?first[0].toUpperCase()+first.slice(1):"?", last:String(r.last_initial||"").toUpperCase(), nicks:new Map(), schools:new Set(), teachers:new Set(),
          joins:0, rooms:new Set(), plays:0, games:{}, saved:0, wins:0, top3:0, bricks:0, places:[], first_at:null, last_at:null }; by.set(key,s); }
        if (r.nickname) s.nicks.set(r.nickname,(s.nicks.get(r.nickname)||0)+1);
        if (r.school_id) s.schools.add(r.school_id); if (r.teacher_id) s.teachers.add(+r.teacher_id);
        const at=new Date(r.at); if (!s.first_at||at<s.first_at) s.first_at=at; if (!s.last_at||at>s.last_at) s.last_at=at;
        return s; };
      for (const r of act){ const s=who(r);
        if (r.kind==="join"){ s.joins++; s.rooms.add(r.room_code+"@"+new Date(r.at).toISOString().slice(0,10)); }
        else { s.plays++; s.games[r.game]=(s.games[r.game]||0)+1; } }
      for (const r of res){ const s=who(r); s.saved++; s.bricks+=+r.bricks||0;
        if (r.place){ s.places.push(+r.place); if (+r.place===1) s.wins++; if (+r.place<=3) s.top3++; } }
      const students=[...by.values()].map(s=>{ const fav=Object.entries(s.games).sort((a,b)=>b[1]-a[1])[0];
        return { key:s.key, first:s.first, last:s.last, nicknames:[...s.nicks.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]),
          schools:[...s.schools].map(sch).filter(Boolean), teachers:[...s.teachers].map(tname).filter(Boolean),
          joins:s.joins, plays:s.plays, games:s.games, favorite:fav?fav[0]:null, saved:s.saved, wins:s.wins, top3:s.top3, bricks:s.bricks,
          avgPlace:s.places.length?Math.round(10*s.places.reduce((a,b)=>a+b,0)/s.places.length)/10:null, firstSeen:s.first_at, lastSeen:s.last_at }; })
        .sort((a,b)=>b.plays-a.plays||b.joins-a.joins||a.first.localeCompare(b.first));
      const dayAgo=Date.now()-864e5, weekAgo=Date.now()-7*864e5;
      return { days, students, totals:{ students:students.length, today:students.filter(s=>new Date(s.lastSeen)>dayAgo).length,
        week:students.filter(s=>new Date(s.lastSeen)>weekAgo).length, joins:act.filter(r=>r.kind==="join").length,
        plays:act.filter(r=>r.kind==="play").length, saved:res.length } }; }],
    // ---- admins: edit / delete teacher accounts
    ["PATCH","/api/admin/teachers/:id",async(req,b,p)=>{ await needAdmin(req);
      const t=await db.one("select * from teachers where id=$1",[p.id]); if (!t) throw A.httpErr(404,"Teacher not found.");
      const name=b.displayName===undefined?t.display_name:String(b.displayName).replace(/[<>]/g,"").trim().slice(0,60);
      const school=b.schoolId===undefined?t.school_id:(b.schoolId&&await C.schoolById(b.schoolId)?b.schoolId:null);
      let email=t.email;
      if (b.email!==undefined){ email=A.cleanEmail(b.email); if (!A.validEmail(email)) throw A.httpErr(400,"That email doesn't look right.");
        if (email!==t.email && await db.one("select id from teachers where email=$1",[email])) throw A.httpErr(409,"Another teacher already uses that email."); }
      await db.q("update teachers set display_name=$2, school_id=$3, email=$4 where id=$1",[t.id,name,school,email]);
      return { ok:true }; }],
    ["DELETE","/api/admin/teachers/:id",async(req,b,p)=>{ const a=await needAdmin(req);
      if (+p.id===+a.id) throw A.httpErr(400,"You can't delete your own account from here.");
      const r=await db.one("delete from teachers where id=$1 returning id",[p.id]); if (!r) throw A.httpErr(404,"Teacher not found.");
      return { ok:true }; }],                                           // cascades: their classes, students, saved games, sessions
    ["POST","/api/admin/teachers/:id/signout",async(req,b,p)=>{ const a=await needAdmin(req);
      await db.q("delete from auth_sessions where teacher_id=$1 and viewed_by is null and token_hash<>$2",[p.id,a.s_hash]); return { ok:true }; }],
    ["POST","/api/admin/teachers/:id/unlock",async(req,b,p)=>{ await needAdmin(req);
      await db.q("update teachers set failed_logins=0, locked_until=null where id=$1",[p.id]); return { ok:true }; }],
    ["POST","/api/admin/teachers/:id/temp-password",async(req,b,p)=>{ const a=await needAdmin(req);
      if (+p.id===+a.id) throw A.httpErr(400,"Change your own password on the teacher page.");
      return { password:await A.tempPassword(p.id) }; }],
    ["POST","/api/admin/teachers/:id/view",async(req,b,p)=>{ const a=await needAdmin(req); return A.viewAsSession(p.id,a.id); }],
    ["GET","/api/schools",async()=>({ schools:await C.loadSchools() })],
    // ---- auth
    ["POST","/api/auth/email",async(req,b)=>A.startEmailLogin(b.email,ipOf(req))],
    ["POST","/api/auth/email/verify",async(req,b)=>A.verifyEmailLogin(b.token)],
    // passwords (scrypt) + one recovery question for resetting without email
    ["POST","/api/auth/password",async(req,b)=>A.passwordLogin(b.email,String(b.password||""),ipOf(req))],
    ["POST","/api/auth/register",async(req,b)=>A.register(b,ipOf(req))],
    ["POST","/api/auth/recover/question",async(req,b)=>A.recoveryQuestion(b.email,ipOf(req))],
    ["POST","/api/auth/recover",async(req,b)=>A.recover({ email:b.email, answer:String(b.answer||""), password:String(b.password||"") },ipOf(req))],
    ["POST","/api/me/password",async(req,b)=>{ const t=await needTeacher(req,{ pwSetup:true });
      if (A.limited("sp:"+t.id,10,15*60e3)) throw A.httpErr(429,"Too many tries. Please wait a few minutes.");
      return { teacher:await A.setPassword(t,{ current:String(b.current||""), password:String(b.password||""), question:b.question?String(b.question):undefined, answer:String(b.answer||"") }) }; }],
    ["POST","/api/auth/google",async(req,b)=>A.googleLogin(b.credential)],
    ["POST","/api/auth/logout",async req=>{ await A.logout(String(req.headers.authorization||"").replace(/^Bearer /,"")); return { ok:true }; }],
    ["GET","/api/me",async req=>{ const t=await needTeacher(req); return { teacher:A.publicTeacher(t), school:await C.schoolById(t.school_id), viewAs:!!t.viewed_by, castle:{ bricks:+t.bricks||0, games:t.castle_games||0 } }; }],
    ["PATCH","/api/me",async(req,b)=>{ const t=await needTeacher(req);
      const name=String(b.displayName??t.display_name).replace(/[<>]/g,"").trim().slice(0,60), school=b.schoolId===undefined?t.school_id:(await C.schoolById(b.schoolId)?b.schoolId:null);
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
      const r=await C.saveSession(+b.classId,t.id,rec); await bus.del(pendingKey(p.claim)); return { sessionId:r.id, bricks:r.bricks, won:r.won }; }],
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
function cleanSchool(b){
  const name=String(b.name||"").replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0,80), state=String(b.state||"").replace(/[^a-z]/gi,"").slice(0,2).toUpperCase();
  if (name.length<3) throw A.httpErr(400,"Type the school's name.");
  return { name, state };
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
module.exports={ makeApi };
