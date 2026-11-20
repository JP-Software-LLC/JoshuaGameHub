// Bots never count as players: crawler/script WebSockets are refused, an open socket that never joins a room
// isn't "online", bot page-view hits are ignored, and real browsers still count.
"use strict";
const { spawn }=require("child_process");
const path=require("path");
const http=require("http");
const WebSocket=require("ws");
const STATS=require("../server/stats");
const PORT=22100+(Math.random()*300|0);
const srv=spawn(process.execPath,[path.join(__dirname,"..","server","index.js")],{ env:{ ...process.env, PORT }, stdio:["ignore","pipe","inherit"] });
const fail=m=>{ console.error("FAIL:",m); srv.kill(); process.exit(1); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CHROME="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const health=()=>new Promise((res,rej)=>http.get(`http://127.0.0.1:${PORT}/health`,r=>{ let s=""; r.on("data",d=>s+=d); r.on("end",()=>res(JSON.parse(s))); }).on("error",rej));
function open(ua){ const ws=new WebSocket(`ws://127.0.0.1:${PORT}`,{ headers:ua?{ "user-agent":ua }:{} }), c={ ws, msgs:[], closed:false };
  ws.on("message",raw=>c.msgs.push(JSON.parse(raw))); ws.on("close",()=>c.closed=true); ws.on("error",()=>{});
  c.send=m=>ws.readyState===1&&ws.send(JSON.stringify(m)); c.ready=new Promise(r=>{ ws.on("open",r); ws.on("close",r); }); return c; }
srv.stdout.on("data",async d=>{
  if (!/listening/.test(d)) return;
  try {
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)","Mozilla/5.0 HeadlessChrome/120.0","python-requests/2.31","curl/8.0"])
      if (!STATS.isBot(ua)) fail("should be a bot: "+ua);
    for (const ua of [CHROME,"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1","Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"])
      if (STATS.isBot(ua)) fail("real browser flagged as bot: "+ua);
    const bot=open("Mozilla/5.0 (compatible; Googlebot/2.1)"); await bot.ready; await sleep(150);
    if (!bot.closed) fail("bot socket should be refused");
    const idle=open(CHROME); await idle.ready; idle.send({ t:"hello", name:"Idle" }); await sleep(200);
    if ((await health()).connections!==0) fail("an open socket that never joins a room is not a player");
    const p=open(CHROME); await p.ready; p.send({ t:"hello", name:"Kid" }); await sleep(100); p.send({ t:"create", game:"math" }); await sleep(250);
    if ((await health()).connections!==1) fail("a player in a room should count");
    console.log("OK: bots — crawler/script sockets refused, idle sockets not counted as online, players in rooms counted");
    srv.kill(); setTimeout(()=>process.exit(0),200);
  } catch(e){ fail(e.message); }
});
setTimeout(()=>fail("overall timeout"),15000);
