// Database access. DATABASE_URL (Railway Postgres) → node-postgres pool.
// Without it (local dev / tests) → PGlite, a real Postgres running inside Node, in memory.
"use strict";
const fs=require("fs"), path=require("path");

let impl=null;
async function connect(){
  if (impl) return impl;
  const url=process.env.DATABASE_URL;
  if (url){
    const { Pool }=require("pg");
    const pool=new Pool({ connectionString:url, max:5, ssl:/sslmode=require/.test(url)?{ rejectUnauthorized:false }:undefined });
    impl={ kind:"postgres", query:(sql,params)=>pool.query(sql,params), close:()=>pool.end() };
  } else {
    const { PGlite }=require("@electric-sql/pglite");
    const db=new PGlite();                                     // in memory: data is lost on restart
    await db.waitReady;
    impl={ kind:"pglite", query:(sql,params)=>db.query(sql,params), exec:sql=>db.exec(sql), close:()=>db.close() };
    console.log("[db] DATABASE_URL not set: using in-memory PGlite (data resets on restart)");
  }
  await migrate();
  if (impl.kind==="postgres") console.log("[db] connected to Postgres");
  return impl;
}
async function migrate(){
  const sql=fs.readFileSync(path.join(__dirname,"schema.sql"),"utf8");
  if (impl.exec) await impl.exec(sql);                        // PGlite: run the whole file
  else await impl.query(sql);                                  // node-postgres: multi-statement simple query
}
const q=async (sql,params=[])=>(await connect()).query(sql,params);
const one=async (sql,params=[])=>(await q(sql,params)).rows[0]||null;
const all=async (sql,params=[])=>(await q(sql,params)).rows;
module.exports={ connect, q, one, all };
