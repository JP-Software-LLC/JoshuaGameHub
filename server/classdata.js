// Class data shared by the teacher API and the game rooms: roles, students, saving finished games.
"use strict";
const db=require("./db");

const SCHOOLS=(()=>{ try{ return require("./schools.json").schools||[]; }catch{ return []; } })();
const schoolById=id=>SCHOOLS.find(s=>s.id===id)||null;

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
  return { first:first[0].toUpperCase()+first.slice(1), last, nick:nick||first };
}
// the student this device was last time in this class (or null)
async function knownStudent(classId,deviceToken){
  if (!classId||!deviceToken) return null;
  const s=await db.one("select id,first_name,last_initial,nickname from students where class_id=$1 and device_token=$2 order by last_seen_at desc nulls last limit 1",[classId,deviceToken]);
  return s?{ id:+s.id, first:s.first_name, last:s.last_initial, nick:s.nickname }:null;
}
// find this device's student in the class (same name), or the same name without a device, else create one
async function resolveStudent(classId,st,deviceToken){
  let row=deviceToken?await db.one("select id from students where class_id=$1 and device_token=$2 and lower(first_name)=lower($3) and last_initial=$4 limit 1",[classId,deviceToken,st.first,st.last]):null;
  if (!row) row=await db.one("select id from students where class_id=$1 and lower(first_name)=lower($2) and last_initial=$3 and (device_token is null or device_token=$4) limit 1",[classId,st.first,st.last,deviceToken||""]);
  if (row){ await db.q("update students set nickname=$2, device_token=coalesce($3,device_token), last_seen_at=now() where id=$1",[row.id,st.nick,deviceToken||null]); return +row.id; }
  row=await db.one("insert into students(class_id,first_name,last_initial,nickname,device_token,last_seen_at) values($1,$2,$3,$4,$5,now()) returning id",[classId,st.first,st.last,st.nick,deviceToken||null]);
  return +row.id;
}
// rec = { game, mode, code, startedAt, endedAt, summary, results:[{ student:{first,last,nick}, device, place, score, stats, log }] }
async function saveSession(classId,teacherId,rec){
  const s=await db.one(`insert into game_sessions(class_id,saved_by,game,mode,room_code,started_at,ended_at,player_count,summary)
    values($1,$2,$3,$4,$5,to_timestamp($6/1000.0),to_timestamp($7/1000.0),$8,$9) returning id`,
    [classId,teacherId,rec.game,rec.mode||null,rec.code||null,rec.startedAt||rec.endedAt,rec.endedAt,rec.results.length,rec.summary||{}]);
  for (const r of rec.results){
    const st=cleanStudent(r.student); if (!st) continue;
    const sid=await resolveStudent(classId,st,r.device);
    await db.q(`insert into session_results(session_id,student_id,place,score,stats,log) values($1,$2,$3,$4,$5,$6)
      on conflict(session_id,student_id) do update set place=excluded.place,score=excluded.score,stats=excluded.stats,log=excluded.log`,
      [s.id,sid,r.place??null,Number.isFinite(r.score)?r.score:null,r.stats||{},JSON.stringify(r.log||[])]);
  }
  return +s.id;
}
module.exports={ SCHOOLS, schoolById, roleIn, cleanStudent, knownStudent, resolveStudent, saveSession };
