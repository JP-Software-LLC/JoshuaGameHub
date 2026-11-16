// Site analytics, counted on our own server: no cookies, no third parties, nothing about any one person.
// Counts are kept in memory and added to daily totals (UTC days) in the daily_stats table once a minute.
// Metrics:  view:<page>[?play]  ·  mode:<student|teacher|guest>  ·  room:<game>:<public|private>
//           teach:<game> (Teacher Mode)  ·  play:<game> (games started)  ·  join:<game> (players joining)
//           peak (most connections at once)
"use strict";
const db=require("./db");

const FLUSH_MS=+process.env.STATS_FLUSH_MS||60000;
const MODES=new Set(["student","teacher","guest"]);
const PLAYS=new Set(["practice","teacher","public","private","bots","try"]);
// pages that can be counted: the hub ("") and every folder in public/ with an index.html
const fs=require("fs"), path=require("path"), PUB=path.join(__dirname,"..","public");
const PAGES=new Set([""]);
try{ for (const d of fs.readdirSync(PUB)) if (fs.existsSync(path.join(PUB,d,"index.html"))) PAGES.add(d); }catch{}
const buf=new Map(); let peak=0;
const day=()=>new Date().toISOString().slice(0,10);

function add(metric,n=1){ if (buf.size<500||buf.has(metric)) buf.set(metric,(buf.get(metric)||0)+n); }
function conns(n){ if (n>peak) peak=n; }
// a hub view chosen in the browser (only these three names are accepted)
function mode(m){ if (MODES.has(m)) add("mode:"+m); }
// a page view, reported by the page itself (pages may be served by the separate web service)
function view(page,play){ page=String(page||"").replace(/^\/+|\/+$/g,""); if (PAGES.has(page)) add("view:/"+page+(page?"/":"")+(PLAYS.has(play)?"?"+play:"")); }

async function flush(){
  if (!buf.size && !peak) return;
  const rows=[...buf], p=peak, d=day(); buf.clear(); peak=0;
  try{
    for (const [m,n] of rows) await db.q("insert into daily_stats(day,metric,n) values($1,$2,$3) on conflict(day,metric) do update set n=daily_stats.n+excluded.n",[d,m,n]);
    if (p) await db.q("insert into daily_stats(day,metric,n) values($1,'peak',$2) on conflict(day,metric) do update set n=greatest(daily_stats.n,excluded.n)",[d,p]);
  }catch(e){ console.error("[stats]",e.message); for (const [m,n] of rows) add(m,n); conns(p); }   // try again next time
}
const timer=setInterval(flush,FLUSH_MS); timer.unref();

// the admin page's numbers: daily totals for the last `days` days, plus account totals
async function report(days){
  days=Math.max(1,Math.min(366,days|0||30));
  await flush();
  const rows=await db.all("select to_char(day,'YYYY-MM-DD') as day,metric,n::int as n from daily_stats where day>current_date-$1::int order by day",[days]);
  const totals=await db.one(`select (select count(*) from teachers)::int teachers, (select count(*) from classes)::int classes,
    (select count(*) from students)::int students, (select count(*) from game_sessions)::int saved_games,
    (select count(*) from teachers where created_at>now()-($1::int*interval '1 day'))::int new_teachers`,[days]);
  return { days, rows, totals };
}
module.exports={ add, conns, mode, view, flush, report };
