// Class data shared by the teacher API and the game rooms: roles, students, saving finished games.
"use strict";
const db=require("./db");

// ---- schools: stored in the db (edited on /admin/schools/), cached here. First run copies server/schools.json in.
const SEED=(()=>{ try{ return require("./schools.json").schools||[]; }catch{ return []; } })();
let SCHOOLS=[], schoolsAt=0;
async function loadSchools(force){
  if (!force && Date.now()-schoolsAt<30e3) return SCHOOLS;
  const n=await db.one("select count(*)::int n from schools");
  if (!n.n) for (const s of SEED) await db.q("insert into schools(id,name,state) values($1,$2,$3) on conflict do nothing",[s.id,s.name,s.state||""]);
  SCHOOLS=(await db.all("select id,name,state from schools order by state,name")).map(r=>({ id:r.id, name:r.name, state:r.state }));
  schoolsAt=Date.now();
  return SCHOOLS;
}
async function schoolById(id){ if (!id) return null; await loadSchools(); return SCHOOLS.find(s=>s.id===id)||null; }
const schoolId=v=>{ const s=String(v||"").toLowerCase().replace(/[^a-z0-9-]/g,"").slice(0,48); return s||null; };

// ---- castle bricks. Each game's raw score is made "higher is better", then divided by that game's running average
// (all students in all saved games), so an average result is worth BRICKS_AVG bricks whatever the game.
const BRICKS_AVG=100, BRICKS_MAX=400;
const PRIOR_N=30;                          // the average starts from these guesses and moves to real data as games are saved
const PRIOR={ math:25, arrows:250, rush:120, hurdle:120, typing:120, sky:120, bear:60, memory:4, cannons:1200, darts:8, words:15 };
const RACES=new Set(["rush","hurdle","typing","sky"]);
// rows: [{ score, stats }] of one game → raw values (≥ 0)
function rawValues(game,rows){
  if (RACES.has(game)){
    // finishers: 100 + up to 100 for speed (fastest = 200); everyone else: % of the course covered
    const times=rows.map(r=>r.stats&&r.stats.finished?Number(r.stats.time):NaN).filter(t=>t>0), best=times.length?Math.min(...times):0;
    return rows.map(r=>{ const s=r.stats||{}; return s.finished&&s.time>0?100+100*best/s.time:Math.max(0,Math.min(100,Number(s.percent)||0)); });
  }
  return rows.map(r=>Math.max(0,Number(r.score)||0));
}
// raw values → bricks each, and fold this game into the running average
async function bricksFor(game,raws){
  if (!raws.length) return [];
  const sc=await db.one("select n,total from game_scale where game=$1",[game])||{ n:0, total:0 };
  const prior=PRIOR[game]||100;
  const avg=Math.max(1e-6,(Number(sc.total)+PRIOR_N*prior)/(Number(sc.n)+PRIOR_N));
  const out=raws.map(v=>Math.max(0,Math.min(BRICKS_MAX,Math.round(BRICKS_AVG*v/avg))));
  await db.q(`insert into game_scale(game,n,total) values($1,$2,$3) on conflict(game) do update set n=game_scale.n+excluded.n,total=game_scale.total+excluded.total`,
    [game,raws.length,raws.reduce((a,b)=>a+b,0)]);
  return out;
}

// 'owner' | 'coteacher' | null
async function roleIn(teacherId,classId){
  const r=await db.one("select role from class_members where class_id=$1 and teacher_id=$2",[classId,teacherId]);
  return r?r.role:null;
}

// student identity: first name (≤20), last initial (1 letter), nickname (≤14)
function cleanStudent(s){
  const name=v=>String(v||"").replace(/[^\p{L}\p{N} '\-.]/gu,"").trim();
  const first=name(s&&s.first).slice(0,20), last=name(s&&s.last).replace(/[^\p{L}]/gu,"").slice(0,1).toUpperCase(), nick=name(s&&s.nick).slice(0,14);
  if (!first) return null;
  return { first:first[0].toUpperCase()+first.slice(1), last, nick:nick||first, school:schoolId(s&&s.school) };
}
// the student this device was last time in this class (or null)
async function knownStudent(classId,deviceToken){
  if (!classId||!deviceToken) return null;
  const s=await db.one("select id,first_name,last_initial,nickname,school_id from students where class_id=$1 and device_token=$2 order by last_seen_at desc nulls last limit 1",[classId,deviceToken]);
  return s?{ id:+s.id, first:s.first_name, last:s.last_initial, nick:s.nickname, school:s.school_id||null }:null;
}
// find this device's student in the class (same name), or the same name without a device, else create one
async function resolveStudent(classId,st,deviceToken){
  const school=st.school&&await schoolById(st.school)?st.school:null;
  let row=deviceToken?await db.one("select id from students where class_id=$1 and device_token=$2 and lower(first_name)=lower($3) and last_initial=$4 limit 1",[classId,deviceToken,st.first,st.last]):null;
  if (!row) row=await db.one("select id from students where class_id=$1 and lower(first_name)=lower($2) and last_initial=$3 and (device_token is null or device_token=$4) limit 1",[classId,st.first,st.last,deviceToken||""]);
  if (row){ await db.q("update students set nickname=$2, device_token=coalesce($3,device_token), school_id=coalesce($4,school_id), last_seen_at=now() where id=$1",[row.id,st.nick,deviceToken||null,school]); return +row.id; }
  row=await db.one("insert into students(class_id,first_name,last_initial,nickname,device_token,last_seen_at,school_id) values($1,$2,$3,$4,$5,now(),$6) returning id",[classId,st.first,st.last,st.nick,deviceToken||null,school]);
  return +row.id;
}
// rec = { game, mode, code, startedAt, endedAt, summary, results:[{ student:{first,last,nick,school}, device, place, score, stats, log }] }
// → { id, bricks } (bricks also added to the castle of the teacher who ran the game)
async function saveSession(classId,teacherId,rec){
  const kept=rec.results.filter(r=>cleanStudent(r.student));
  const each=await bricksFor(rec.game,rawValues(rec.game,kept));
  const total=each.reduce((a,b)=>a+b,0);
  const s=await db.one(`insert into game_sessions(class_id,saved_by,game,mode,room_code,started_at,ended_at,player_count,summary)
    values($1,$2,$3,$4,$5,to_timestamp($6/1000.0),to_timestamp($7/1000.0),$8,$9) returning id`,
    [classId,teacherId,rec.game,rec.mode||null,rec.code||null,rec.startedAt||rec.endedAt,rec.endedAt,rec.results.length,rec.summary||{}]);
  for (let i=0;i<kept.length;i++){
    const r=kept[i], st=cleanStudent(r.student);
    const sid=await resolveStudent(classId,st,r.device);
    await db.q(`insert into session_results(session_id,student_id,place,score,stats,log,bricks) values($1,$2,$3,$4,$5,$6,$7)
      on conflict(session_id,student_id) do update set place=excluded.place,score=excluded.score,stats=excluded.stats,log=excluded.log,bricks=excluded.bricks`,
      [s.id,sid,r.place??null,Number.isFinite(r.score)?r.score:null,r.stats||{},JSON.stringify(r.log||[]),each[i]]);
  }
  await db.q("update game_sessions set bricks=$2 where id=$1",[s.id,total]);
  let won=null;
  if (teacherId){
    await db.q("update teachers set bricks=bricks+$2, castle_games=castle_games+1 where id=$1",[teacherId,total]);
    try{ won=await checkTournament(teacherId); }catch(e){ console.error("[tournament]",e.message); }
  }
  return { id:+s.id, bricks:total, won };
}
// ---- tournaments: bricks from games SAVED since the start count. The first teacher to reach the goal wins (atomic).
const sinceSql=`select coalesce(sum(g.bricks),0)::float8 from game_sessions g where g.saved_by=t.id and g.saved_at>=tn.started_at and (tn.ended_at is null or g.saved_at<=tn.ended_at)`;
async function checkTournament(teacherId){
  const t=await db.one("select id,school_id,display_name from teachers where id=$1",[teacherId]);
  if (!t||!t.school_id) return null;
  const tn=await db.one(`select tn.*,(${sinceSql}) as mine from tournaments tn, teachers t where t.id=$1 and tn.school_id=t.school_id and tn.ended_at is null order by tn.started_at desc limit 1`,[teacherId]);
  if (!tn||+tn.mine<tn.goal) return null;
  const w=await db.one("update tournaments set ended_at=now(),winner_id=$2,winner_name=$3 where id=$1 and ended_at is null returning name",[tn.id,teacherId,t.display_name||"A teacher"]);
  return w?{ tournament:w.name }:null;
}
// a school's page: every castle, the running tournament (standings) and the last few finished ones
async function schoolPage(schoolId){
  const school=await schoolById(schoolId); if (!school) return null;
  const castles=(await db.all("select display_name,bricks::float8 as bricks,castle_games from teachers where school_id=$1 and display_name<>'' order by bricks desc, display_name limit 300",[schoolId]))
    .map(r=>({ name:r.display_name, bricks:+r.bricks, games:r.castle_games }));
  const tns=await db.all("select id,name,goal,started_at,ended_at,winner_name from tournaments where school_id=$1 order by started_at desc limit 6",[schoolId]);
  const live=tns.find(x=>!x.ended_at)||null, past=tns.filter(x=>x.ended_at);
  let tournament=null;
  if (live){
    const rows=await db.all(`select t.display_name,(${sinceSql}) as b from teachers t, tournaments tn where tn.id=$1 and t.school_id=tn.school_id and t.display_name<>'' order by b desc, t.display_name`,[live.id]);
    tournament={ name:live.name, goal:live.goal, startedAt:live.started_at, standings:rows.map(r=>({ name:r.display_name, bricks:+r.b })) };
  }
  return { school, castles, tournament, past:past.map(x=>({ name:x.name, goal:x.goal, startedAt:x.started_at, endedAt:x.ended_at, winner:x.winner_name||null })) };
}
module.exports={ checkTournament, schoolPage, loadSchools, schoolById, schoolId, rawValues, bricksFor, BRICKS_AVG, roleIn, cleanStudent, knownStudent, resolveStudent, saveSession };
