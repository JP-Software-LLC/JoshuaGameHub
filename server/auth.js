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
  // EMAIL_VERIFY=off only works for accounts WITHOUT a password (older accounts, so they can sign in once and set one)
  if (noVerify()){
    const old=await db.one("select pw_hash from teachers where email=$1",[email]);
    if (old && old.pw_hash) throw httpErr(403,"This account has a password. Please sign in with your password.");
    if (!old) throw httpErr(400,"No account with that email yet. Use \"Create account\" to make one with a password.");
    const t=await db.one("update teachers set last_login_at=now() where email=$1 returning *",[email]); return newSession(t,"email"); }
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
  return newSession(t,"link");
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
  return newSession(t,"google");
}
async function newSession(t,method){
  const token=newToken();
  await db.q("insert into auth_sessions(token_hash,teacher_id,expires_at,method) values($1,$2,now()+($3||' days')::interval,$4)",[hash(token),t.id,String(SESSION_DAYS),method||null]);
  await db.q("update teachers set last_login_at=now() where id=$1",[t.id]);
  return { token, teacher:publicTeacher(t) };
}
async function teacherFromToken(token){
  if (!token||typeof token!=="string"||token.length>100) return null;
  return db.one("select t.*, s.viewed_by, s.method as s_method, s.created_at as s_created, s.token_hash as s_hash from auth_sessions s join teachers t on t.id=s.teacher_id where s.token_hash=$1 and s.expires_at>now()",[hash(token)]);
}
// site admin → read-only session as another teacher (2 h). Doesn't touch the teacher's last login.
const VIEW_HOURS=2;
async function viewAsSession(teacherId,adminId){
  const t=await db.one("select * from teachers where id=$1",[teacherId]);
  if (!t) throw httpErr(404,"Teacher not found.");
  const token=newToken();
  await db.q("insert into auth_sessions(token_hash,teacher_id,expires_at,viewed_by,method) values($1,$2,now()+($3||' hours')::interval,$4,'view')",[hash(token),t.id,String(VIEW_HOURS),adminId]);
  return { token, teacher:publicTeacher(t) };
}
const logout=token=>db.q("delete from auth_sessions where token_hash=$1",[hash(token)]);
const publicTeacher=t=>({ id:+t.id, email:t.email, displayName:t.display_name||"", schoolId:t.school_id||null, google:!!t.google_sub,
  hasPassword:!!t.pw_hash, mustChange:!!t.must_change, recoveryQ:t.recovery_q||null, recoveryText:QUESTIONS[t.recovery_q]||null });
function httpErr(status,msg){ const e=new Error(msg); e.status=status; return e; }

// ============================================================
//  PASSWORDS: scrypt (N=2^15, r=8, p=1, 16-byte salt, 64-byte key), compared in constant time.
//  The recovery answer is normalised (case, spaces, punctuation) and hashed the same way. Nothing is stored in plain text.
// ============================================================
const SCRYPT={ N:32768, r:8, p:1, maxmem:96*1024*1024 };
const scrypt=(pw,salt,opt=SCRYPT)=>new Promise((res,rej)=>crypto.scrypt(String(pw).normalize("NFKC"),salt,64,opt,(e,k)=>e?rej(e):res(k)));
async function hashSecret(pw){
  const salt=crypto.randomBytes(16), key=await scrypt(pw,salt);
  return `s1$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}
async function verifySecret(pw,stored){
  const parts=String(stored||"").split("$");
  if (parts.length!==6 || parts[0]!=="s1"){ await scrypt(pw,"x".repeat(16)); return false; }   // same work either way
  const [,N,r,p,salt,key]=parts, want=Buffer.from(key,"base64");
  const got=await scrypt(pw,Buffer.from(salt,"base64"),{ N:+N, r:+r, p:+p, maxmem:SCRYPT.maxmem });
  return got.length===want.length && crypto.timingSafeEqual(got,want);
}
let dummy=null; const DUMMY=()=>dummy||(dummy=hashSecret("not-a-real-password-equal-timing"));
const normAnswer=a=>String(a||"").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
const QUESTIONS={
  pet:"What was the name of your first pet?",
  street:"What street did you grow up on?",
  teacher:"What was the last name of your favourite teacher at school?",
  city:"In what city were you born?",
  book:"What is the title of your favourite childhood book?",
  food:"What food did you hate as a child?",
  firstjob:"What was your first job?",
  friend:"What is the first name of your childhood best friend?",
};
const COMMON=new Set("password password1 password123 12345678 123456789 1234567890 qwerty123 qwertyuiop iloveyou welcome1 letmein1 teacher1 teacher123 school123 abc12345 11111111 00000000 87654321 sunshine princess football baseball".split(" "));
function passwordProblem(pw,email){
  pw=String(pw||"");
  if (pw.length<8) return "Passwords need at least 8 characters.";
  if (pw.length>128) return "That password is too long (128 characters max).";
  if (COMMON.has(pw.toLowerCase()) || new Set(pw).size<4) return "That password is too easy to guess. Please pick another.";
  const local=String(email||"").split("@")[0].toLowerCase();
  if (local.length>=4 && pw.toLowerCase().includes(local)) return "Please don't use your email name in your password.";
  return null;
}
function recoveryProblem(q,a){
  if (!QUESTIONS[q]) return "Please pick a recovery question.";
  const n=normAnswer(a); if (n.length<2) return "Please type an answer to your recovery question.";
  if (n.length>80) return "That answer is too long.";
  return null;
}
const LOCK_AFTER=8, LOCK_MIN=15;
async function failed(t){
  if (!t) return;
  const r=await db.one("update teachers set failed_logins=failed_logins+1 where id=$1 returning failed_logins",[t.id]);
  if (r && r.failed_logins>=LOCK_AFTER) await db.q("update teachers set failed_logins=0, locked_until=now()+($2||' minutes')::interval where id=$1",[t.id,String(LOCK_MIN)]);
}
const isLocked=t=>!!(t && t.locked_until && new Date(t.locked_until)>new Date());
const LOCKED_MSG=`Too many wrong tries. This account is locked for ${LOCK_MIN} minutes.`;
async function passwordLogin(email,pw,ip){
  email=cleanEmail(email);
  if (limited("pi:"+ip,30,15*60e3)||limited("pe:"+email,10,15*60e3)) throw httpErr(429,"Too many sign-in attempts. Please wait a few minutes.");
  const t=validEmail(email)?await db.one("select * from teachers where email=$1",[email]):null;
  if (isLocked(t)) throw httpErr(429,LOCKED_MSG);
  let ok=false;
  if (t && t.pw_hash) ok=await verifySecret(pw,t.pw_hash); else await verifySecret(pw,await DUMMY());
  if (!ok){ await failed(t);
    if (t && !t.pw_hash) throw httpErr(401,"This account doesn't have a password yet. Use \"No password yet?\" below to sign in once and set one.");
    throw httpErr(401,"Email or password is wrong."); }
  await db.q("update teachers set failed_logins=0, locked_until=null where id=$1",[t.id]);
  return newSession(t,"password");
}
async function register(b,ip){
  const email=cleanEmail(b.email);
  if (!validEmail(email)) throw httpErr(400,"Please enter a valid email address.");
  if (limited("ri:"+ip,10,60*60e3)) throw httpErr(429,"Too many new accounts from here. Please try again later.");
  const pp=passwordProblem(b.password,email); if (pp) throw httpErr(400,pp);
  const rp=recoveryProblem(b.question,b.answer); if (rp) throw httpErr(400,rp);
  if (await db.one("select id from teachers where email=$1",[email])) throw httpErr(409,"An account with this email already exists. Please sign in instead.");
  const name=String(b.displayName||"").replace(/[<>]/g,"").trim().slice(0,60);
  const t=await db.one(`insert into teachers(email,display_name,pw_hash,pw_set_at,recovery_q,recovery_hash) values($1,$2,$3,now(),$4,$5)
    on conflict(email) do nothing returning *`,[email,name,await hashSecret(b.password),b.question,await hashSecret(normAnswer(b.answer))]);
  if (!t) throw httpErr(409,"An account with this email already exists. Please sign in instead.");
  return newSession(t,"password");
}
// signed in: set / change the password and recovery question. Changing needs the current password
// (unless it's a first password, or a temporary one from an admin). Every OTHER session of this account is signed out.
async function setPassword(t,b){
  if (t.pw_hash && !t.must_change && !await verifySecret(b.current||"",t.pw_hash)){ await failed(t); throw httpErr(403,"Your current password is wrong."); }
  const pp=passwordProblem(b.password,t.email); if (pp) throw httpErr(400,pp);
  let q=t.recovery_q, h=t.recovery_hash;
  if (b.question || !h){ const rp=recoveryProblem(b.question,b.answer); if (rp) throw httpErr(400,rp); q=b.question; h=await hashSecret(normAnswer(b.answer)); }
  const u=await db.one("update teachers set pw_hash=$2, pw_set_at=now(), must_change=false, recovery_q=$3, recovery_hash=$4, failed_logins=0, locked_until=null where id=$1 returning *",
    [t.id,await hashSecret(b.password),q,h]);
  await db.q("delete from auth_sessions where teacher_id=$1 and token_hash<>$2 and viewed_by is null",[t.id,t.s_hash||""]);
  await db.q("update auth_sessions set method='password' where token_hash=$1",[t.s_hash||""]);
  return publicTeacher(u);
}
// forgot password: show the account's question. Unknown emails get a made-up (but always the same) question,
// so this can't be used to find out who has an account.
async function recoveryQuestion(email,ip){
  email=cleanEmail(email);
  if (limited("qi:"+ip,30,15*60e3)) throw httpErr(429,"Too many tries. Please wait a few minutes.");
  if (!validEmail(email)) throw httpErr(400,"Please enter a valid email address.");
  const t=await db.one("select recovery_q from teachers where email=$1",[email]);
  const keys=Object.keys(QUESTIONS), q=t&&QUESTIONS[t.recovery_q]?t.recovery_q:keys[parseInt(hash("q:"+email).slice(0,8),16)%keys.length];
  return { question:q, text:QUESTIONS[q] };
}
async function recover(b,ip){
  const email=cleanEmail(b.email);
  if (limited("ci:"+ip,20,15*60e3)||limited("ce:"+email,5,15*60e3)) throw httpErr(429,"Too many tries. Please wait 15 minutes.");
  const t=validEmail(email)?await db.one("select * from teachers where email=$1",[email]):null;
  if (isLocked(t)) throw httpErr(429,LOCKED_MSG);
  let ok=false;
  if (t && t.recovery_hash) ok=await verifySecret(normAnswer(b.answer),t.recovery_hash); else await verifySecret("x",await DUMMY());
  if (!ok){ await failed(t); throw httpErr(401,"That answer doesn't match. Check the spelling and try again."); }
  const pp=passwordProblem(b.password,email); if (pp) throw httpErr(400,pp);
  const u=await db.one("update teachers set pw_hash=$2, pw_set_at=now(), must_change=false, failed_logins=0, locked_until=null where id=$1 returning *",[t.id,await hashSecret(b.password)]);
  await db.q("delete from auth_sessions where teacher_id=$1 and viewed_by is null",[t.id]);      // sign out everywhere else
  return newSession(u,"recover");
}
// admin: a one-time temporary password (shown to the admin once); the teacher must pick a new one when they sign in
async function tempPassword(teacherId){
  const pw=crypto.randomBytes(12).toString("base64url").replace(/[-_]/g,"x").slice(0,12);
  const u=await db.one("update teachers set pw_hash=$2, pw_set_at=now(), must_change=true, failed_logins=0, locked_until=null where id=$1 returning id",[teacherId,await hashSecret(pw)]);
  if (!u) throw httpErr(404,"Teacher not found.");
  await db.q("delete from auth_sessions where teacher_id=$1 and viewed_by is null",[teacherId]);
  return pw;
}
// Admin pages need a STRONG, recent session: signed in with a password (or Google / an email link / recovery),
// never the EMAIL_VERIFY=off email-only sign-in, never a view-as session, and opened in the last 12 hours.
const ADMIN_HOURS=12;
function adminProblem(t){
  if (!t || t.viewed_by || !isAdminEmail(t.email)) return "This page is only for site admins.";
  if (!["password","google","link","recover"].includes(t.s_method)) return "For safety, admin pages need a password sign-in. Please sign out on the teacher page and sign in again with your password.";
  if (t.must_change) return "Please set a new password first (on the teacher page).";
  if (Date.now()-new Date(t.s_created).getTime()>ADMIN_HOURS*3600e3) return `For safety, admin sign-ins last ${ADMIN_HOURS} hours. Please sign out and sign in again.`;
  return null;
}
const isAdminEmail=e=>new Set(String(process.env.ADMIN_EMAILS||"").toLowerCase().split(/[,\s]+/).filter(Boolean)).has(String(e||"").toLowerCase());
module.exports={ QUESTIONS, hashSecret, verifySecret, normAnswer, passwordProblem, passwordLogin, register, setPassword, recoveryQuestion, recover, tempPassword, adminProblem, isAdminEmail, noVerify, hash, newToken, cleanEmail, validEmail, limited, sendEmail, emailEnabled, startEmailLogin, verifyEmailLogin, googleLogin, teacherFromToken, viewAsSession, logout, publicTeacher, httpErr, APP_URL };
