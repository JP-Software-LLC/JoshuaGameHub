// Teacher sign-in: email login links + Google sign-in → a bearer session token.
// Only SHA-256 hashes of login links, invites and session tokens are stored.
"use strict";
const crypto=require("crypto");
const db=require("./db");

const LINK_MIN=15;                    // email login links expire after 15 minutes
const SESSION_DAYS=30;
const APP_URL=()=>(process.env.APP_URL||"https://joshuagamehub.website").replace(/\/$/,"");
const hash=t=>crypto.createHash("sha256").update(String(t)).digest("hex");
const newToken=()=>crypto.randomBytes(32).toString("base64url");
const cleanEmail=e=>String(e||"").trim().toLowerCase();
const validEmail=e=>/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e);

// small in-memory rate limiter: max `n` hits per `ms` per key
const hits=new Map();
function limited(key,n,ms){
  const now=Date.now(), arr=(hits.get(key)||[]).filter(t=>now-t<ms);
  arr.push(now); hits.set(key,arr);
  return arr.length>n;
}

// ---- email delivery: Resend (RESEND_API_KEY + MAIL_FROM) or, without it, the server log
async function sendEmail(to,subject,text,html){
  const key=process.env.RESEND_API_KEY, from=process.env.MAIL_FROM;
  if (!key||!from){ console.log(`[mail:not-configured] to=${to} subject="${subject}"\n${text}`); return { delivered:false }; }
  const r=await fetch("https://api.resend.com/emails",{ method:"POST", headers:{ "authorization":`Bearer ${key}`, "content-type":"application/json" },
    body:JSON.stringify({ from, to:[to], subject, text, html }) });
  if (!r.ok){ console.error("[mail] send failed",r.status,await r.text().catch(()=>"" )); throw new Error("Could not send email right now."); }
  return { delivered:true };
}
const noVerify=()=>String(process.env.EMAIL_VERIFY||"").toLowerCase()==="off";
const emailEnabled=()=>!!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM);

async function startEmailLogin(email,ip){
  email=cleanEmail(email);
  if (!validEmail(email)) throw httpErr(400,"Please enter a valid email address.");
  if (limited("e:"+email,5,15*60e3)||limited("i:"+ip,20,15*60e3)) throw httpErr(429,"Too many sign-in emails. Please wait a few minutes.");
  // EMAIL_VERIFY=off (temporary, until sign-in emails are set up): typing an email signs straight in
  if (noVerify()){ const t=await db.one(`insert into teachers(email) values($1) on conflict(email) do update set last_login_at=now() returning *`,[email]); return newSession(t); }
  const token=newToken();
  await db.q("insert into login_links(token_hash,email,expires_at) values($1,$2,now()+($3||' minutes')::interval)",[hash(token),email,String(LINK_MIN)]);
  const link=`${APP_URL()}/teacher/?login=${token}`;
  const sent=await sendEmail(email,"Your Joshua Game Hub sign-in link",
    `Click to sign in to your teacher account:\n\n${link}\n\nThis link works once and expires in ${LINK_MIN} minutes. If you didn't ask for it, you can ignore this email.`,
    `<p>Click to sign in to your teacher account:</p><p><a href="${link}">Sign in to Joshua Game Hub</a></p><p style="color:#666">This link works once and expires in ${LINK_MIN} minutes. If you didn't ask for it, you can ignore this email.</p>`);
  return { sent:true, delivered:sent.delivered, devLink:process.env.ALLOW_DEV_LINKS==="1"?link:undefined };
}
async function verifyEmailLogin(token){
  const row=await db.one("update login_links set used_at=now() where token_hash=$1 and used_at is null and expires_at>now() returning email",[hash(token)]);
  if (!row) throw httpErr(400,"That sign-in link has expired or was already used. Please request a new one.");
  const t=await db.one(`insert into teachers(email) values($1) on conflict(email) do update set last_login_at=now() returning *`,[row.email]);
  return newSession(t);
}
// Google: verify the ID token with Google, check it was issued for our client id and the email is verified
async function googleLogin(credential){
  const cid=process.env.GOOGLE_CLIENT_ID;
  if (!cid) throw httpErr(400,"Google sign-in isn't set up yet.");
  const r=await fetch("https://oauth2.googleapis.com/tokeninfo?id_token="+encodeURIComponent(credential||""));
  const p=await r.json().catch(()=>({}));
  if (!r.ok||p.aud!==cid||String(p.email_verified)!=="true"||!p.email||!p.sub) throw httpErr(401,"Google sign-in failed. Please try again.");
  const email=cleanEmail(p.email);
  let t=await db.one("select * from teachers where google_sub=$1",[p.sub]);
  if (!t) t=await db.one(`insert into teachers(email,google_sub,display_name) values($1,$2,$3)
      on conflict(email) do update set google_sub=coalesce(teachers.google_sub,excluded.google_sub) returning *`,[email,p.sub,String(p.name||"").slice(0,60)]);
  return newSession(t);
}
async function newSession(t){
  const token=newToken();
  await db.q("insert into auth_sessions(token_hash,teacher_id,expires_at) values($1,$2,now()+($3||' days')::interval)",[hash(token),t.id,String(SESSION_DAYS)]);
  await db.q("update teachers set last_login_at=now() where id=$1",[t.id]);
  return { token, teacher:publicTeacher(t) };
}
async function teacherFromToken(token){
  if (!token||typeof token!=="string"||token.length>100) return null;
  return db.one("select t.*, s.viewed_by from auth_sessions s join teachers t on t.id=s.teacher_id where s.token_hash=$1 and s.expires_at>now()",[hash(token)]);
}
// site admin → read-only session as another teacher (2 h). Doesn't touch the teacher's last login.
const VIEW_HOURS=2;
async function viewAsSession(teacherId,adminId){
  const t=await db.one("select * from teachers where id=$1",[teacherId]);
  if (!t) throw httpErr(404,"Teacher not found.");
  const token=newToken();
  await db.q("insert into auth_sessions(token_hash,teacher_id,expires_at,viewed_by) values($1,$2,now()+($3||' hours')::interval,$4)",[hash(token),t.id,String(VIEW_HOURS),adminId]);
  return { token, teacher:publicTeacher(t) };
}
const logout=token=>db.q("delete from auth_sessions where token_hash=$1",[hash(token)]);
const publicTeacher=t=>({ id:+t.id, email:t.email, displayName:t.display_name||"", schoolId:t.school_id||null, google:!!t.google_sub });
function httpErr(status,msg){ const e=new Error(msg); e.status=status; return e; }

const isAdminEmail=e=>new Set(String(process.env.ADMIN_EMAILS||"").toLowerCase().split(/[,\s]+/).filter(Boolean)).has(String(e||"").toLowerCase());
module.exports={ isAdminEmail, noVerify, hash, newToken, cleanEmail, validEmail, limited, sendEmail, emailEnabled, startEmailLogin, verifyEmailLogin, googleLogin, teacherFromToken, viewAsSession, logout, publicTeacher, httpErr, APP_URL };
