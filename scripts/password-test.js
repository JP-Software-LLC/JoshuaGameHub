// Teacher passwords + recovery question + admin protection + admin teacher editing.
// Runs the server in this process so the test can also look inside the database (nothing stored in plain text).
"use strict";
const PORT=23200+(Math.random()*300|0), BASE=`http://127.0.0.1:${PORT}`;
Object.assign(process.env,{ PORT:String(PORT), DATABASE_URL:"", ALLOW_DEV_LINKS:"1", ADMIN_EMAILS:"boss@school.test" });
delete process.env.EMAIL_VERIFY;
const fail=m=>{ console.error("FAIL:",m); process.exit(1); };
const origLog=console.log; console.log=(...a)=>{ if (!/^\[(game|bus|db|mail)/.test(String(a[0]))) origLog(...a); };
require("../server/index.js");
const db=require("../server/db");
const A=require("../server/auth");
async function api(method,p,body,token){
  const r=await fetch(BASE+p,{ method, headers:{ "content-type":"application/json", ...(token?{ authorization:"Bearer "+token }:{}) }, body:body?JSON.stringify(body):undefined });
  return { status:r.status, ...(await r.json().catch(()=>({}))) };
}
async function linkSignIn(email){            // an older account, signed in with an email link (no password yet)
  const s=await api("POST","/api/auth/email",{ email });
  return (await api("POST","/api/auth/email/verify",{ token:new URL(s.devLink).searchParams.get("login") })).token;
}
const expect=(r,status,what)=>{ if (r.status!==status) fail(`${what}: expected ${status}, got ${r.status} ${r.error||""}`); return r; };
setTimeout(async()=>{
  try {
    // ---- hashing
    const h=await A.hashSecret("Correct Horse 9");
    if (!/^s1\$32768\$8\$1\$/.test(h) || h.includes("Correct")) fail("hash format");
    if (!await A.verifySecret("Correct Horse 9",h) || await A.verifySecret("correct horse 9",h)) fail("verify");
    if (h===await A.hashSecret("Correct Horse 9")) fail("salts must differ");
    if (A.normAnswer("  Mr.   SMITH! ")!==A.normAnswer("mr smith")) fail("recovery answers ignore case/spaces/punctuation");

    // ---- create account
    expect(await api("POST","/api/auth/register",{ email:"ann@school.test", password:"short", question:"pet", answer:"Rex" }),400,"too-short password");
    expect(await api("POST","/api/auth/register",{ email:"ann@school.test", password:"password123", question:"pet", answer:"Rex" }),400,"common password");
    expect(await api("POST","/api/auth/register",{ email:"ann@school.test", password:"Blue-Kite-42", question:"nope", answer:"Rex" }),400,"bad question");
    const reg=expect(await api("POST","/api/auth/register",{ email:"Ann@School.test", password:"Blue-Kite-42", question:"pet", answer:"Rex the Dog", displayName:"Ms Ann" }),200,"register");
    if (!reg.token || !reg.teacher.hasPassword || reg.teacher.recoveryQ!=="pet") fail("register should sign in with a password");
    expect(await api("POST","/api/auth/register",{ email:"ann@school.test", password:"Other-Pass-77", question:"pet", answer:"Spot" }),409,"duplicate email");
    const row=await db.one("select * from teachers where email='ann@school.test'");
    if (!row.pw_hash.startsWith("s1$") || /Blue-Kite|rex/i.test(row.pw_hash+row.recovery_hash)) fail("nothing may be stored in plain text");

    // ---- sign in
    expect(await api("POST","/api/auth/password",{ email:"ann@school.test", password:"wrong-pass-1" }),401,"wrong password");
    const nobody=expect(await api("POST","/api/auth/password",{ email:"ghost@school.test", password:"whatever-1" }),401,"unknown email");
    if (nobody.error!=="Email or password is wrong.") fail("unknown email must look the same as a wrong password");
    const li=expect(await api("POST","/api/auth/password",{ email:" ANN@school.test ", password:"Blue-Kite-42" }),200,"right password");
    // EMAIL_VERIFY=off email-only sign-in is refused once an account has a password
    process.env.EMAIL_VERIFY="off";
    expect(await api("POST","/api/auth/email",{ email:"ann@school.test" }),403,"email-only sign-in on a password account");
    expect(await api("POST","/api/auth/email",{ email:"new@school.test" }),400,"email-only sign-in can't create accounts");
    delete process.env.EMAIL_VERIFY;

    // ---- change password (needs the current one); other sessions are signed out
    expect(await api("POST","/api/me/password",{ current:"nope-nope-1", password:"Green-Boat-55" },li.token),403,"change without current password");
    expect(await api("POST","/api/me/password",{ current:"Blue-Kite-42", password:"Green-Boat-55" },li.token),200,"change password");
    expect(await api("GET","/api/me",null,reg.token),401,"other sessions are signed out after a change");
    expect(await api("GET","/api/me",null,li.token),200,"this session stays signed in");

    // ---- forgot password: recovery question (no email)
    const q=expect(await api("POST","/api/auth/recover/question",{ email:"ann@school.test" }),200,"question");
    if (q.question!=="pet" || !/pet/.test(q.text)) fail("should show Ann's question");
    const f1=(await api("POST","/api/auth/recover/question",{ email:"ghost@school.test" })).question, f2=(await api("POST","/api/auth/recover/question",{ email:"ghost@school.test" })).question;
    if (!f1 || f1!==f2) fail("unknown emails get a made-up but stable question");
    expect(await api("POST","/api/auth/recover",{ email:"ann@school.test", answer:"Fido", password:"Red-Kite-31" }),401,"wrong recovery answer");
    const rec=expect(await api("POST","/api/auth/recover",{ email:"ann@school.test", answer:"  rex THE dog ", password:"Red-Kite-31" }),200,"right recovery answer");
    expect(await api("GET","/api/me",null,li.token),401,"recovery signs out every other session");
    expect(await api("GET","/api/me",null,rec.token),200,"recovery signs you in");
    expect(await api("POST","/api/auth/password",{ email:"ann@school.test", password:"Red-Kite-31" }),200,"new password works");

    // ---- lockout after 8 wrong passwords (even the right one is refused while locked)
    await api("POST","/api/auth/register",{ email:"bo@school.test", password:"Bo-Secret-88", question:"city", answer:"Austin" });
    for (let i=0;i<8;i++) await api("POST","/api/auth/password",{ email:"bo@school.test", password:"guess-"+i+"-xyz" });
    expect(await api("POST","/api/auth/password",{ email:"bo@school.test", password:"Bo-Secret-88" }),429,"locked account");
    console.log("OK: passwords — scrypt + salt, nothing in plain text, weak passwords refused, same error for unknown emails, change needs current, other sessions signed out, lockout after 8");
    console.log("OK: recovery question — prebuilt list, answer hashed + forgiving (case/spaces), no email needed, fake questions for unknown emails, resets sign everyone else out");

    // ---- admin protection: an old email-only session is not enough
    const bossOld=await linkSignIn("boss@school.test");
    await db.q("update auth_sessions set method='email' where teacher_id=(select id from teachers where email='boss@school.test')");
    expect(await api("GET","/api/admin/teachers",null,bossOld),403,"admin with an email-only session");
    expect(await api("POST","/api/me/password",{ password:"Head-Strong-71", question:"food", answer:"Liver" },bossOld),200,"admin sets a first password");
    const boss=(await api("POST","/api/auth/password",{ email:"boss@school.test", password:"Head-Strong-71" })).token;
    const list=expect(await api("GET","/api/admin/teachers",null,boss),200,"admin with a password session");
    const bo=list.teachers.find(t=>t.email==="bo@school.test"), ann=list.teachers.find(t=>t.email==="ann@school.test");
    if (!bo.locked || !ann.has_password || !ann.has_recovery) fail("teacher list should show password / recovery / locked");
    const annTok=(await api("POST","/api/auth/password",{ email:"ann@school.test", password:"Red-Kite-31" })).token;
    expect(await api("GET","/api/admin/teachers",null,annTok),403,"non-admin");
    expect(await api("DELETE",`/api/admin/teachers/${bo.id}`,null,annTok),403,"non-admin delete");
    // ---- admin edits
    expect(await api("POST",`/api/admin/teachers/${bo.id}/unlock`,{},boss),200,"unlock");
    expect(await api("POST","/api/auth/password",{ email:"bo@school.test", password:"Bo-Secret-88" }),200,"unlocked account signs in");
    expect(await api("PATCH",`/api/admin/teachers/${ann.id}`,{ displayName:"Ms Ann B", email:"bo@school.test" },boss),409,"email clash");
    expect(await api("PATCH",`/api/admin/teachers/${ann.id}`,{ displayName:"Ms Ann B" },boss),200,"rename");
    if ((await db.one("select display_name from teachers where id=$1",[ann.id])).display_name!=="Ms Ann B") fail("rename didn't save");
    // temporary password: shown once, all sessions end, must be changed before anything else
    const tmp=expect(await api("POST",`/api/admin/teachers/${ann.id}/temp-password`,{},boss),200,"temp password");
    expect(await api("GET","/api/me",null,annTok),401,"temp password signs the teacher out");
    const tl=expect(await api("POST","/api/auth/password",{ email:"ann@school.test", password:tmp.password }),200,"temp password signs in");
    if (!tl.teacher.mustChange) fail("temp password must be changed");
    expect(await api("POST","/api/classes",{ name:"5B" },tl.token),403,"nothing else until the temp password is changed");
    expect(await api("POST","/api/me/password",{ password:"Fresh-Start-64" },tl.token),200,"replace temp password (keeps recovery question)");
    expect(await api("POST","/api/classes",{ name:"5B" },tl.token),200,"works after changing it");
    // sign out everywhere, then delete
    expect(await api("POST",`/api/admin/teachers/${ann.id}/signout`,{},boss),200,"sign out everywhere");
    expect(await api("GET","/api/me",null,tl.token),401,"signed out");
    const me=list.teachers.find(t=>t.email==="boss@school.test");
    expect(await api("DELETE",`/api/admin/teachers/${me.id}`,null,boss),400,"can't delete yourself");
    expect(await api("DELETE",`/api/admin/teachers/${ann.id}`,null,boss),200,"delete");
    if (await db.one("select id from teachers where id=$1",[ann.id]) || await db.one("select 1 from classes where owner_id=$1",[ann.id])) fail("delete should remove the teacher and their classes");
    console.log("OK: admin — needs a password sign-in (not email-only), edit name/email, unlock, temp password (must change), sign out everywhere, delete (not yourself)");
    process.exit(0);
  } catch(e){ fail(e.stack||e.message); }
},800);
setTimeout(()=>fail("timeout"),60000);
