// Serves the browser client: public/*, shared/sim.js at /sim.js, and /config.js
// which tells the client where the game server lives (GAME_SERVER_URL).
"use strict";
const fs=require("fs"), path=require("path");
const ROOT=path.join(__dirname,"..");
const PUBLIC=path.join(ROOT,"public");
const TYPES={ ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css",
  ".png":"image/png", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".json":"application/json", ".webp":"image/webp", ".mp3":"audio/mpeg", ".ogg":"audio/ogg" };

function configJs(){
  // Empty server URL = same origin as the page (single-service / local dev).
  let url=(process.env.GAME_SERVER_URL||"").trim();
  if (url && !/^wss?:\/\//.test(url)) url="wss://"+url.replace(/^https?:\/\//,"");
  return `window.CG_CONFIG=${JSON.stringify({ server:url })};\n`;
}

// Never let a bad request take the server down: bots probe for "/%00.env", "/%E0%A4%A" etc.
function serveStatic(req,res){
  try{ return serve(req,res); }
  catch(e){ console.error("[static]",e.message); if (!res.headersSent){ res.writeHead(400,{"content-type":"text/plain"}); } res.end("bad request"); }
}
function serve(req,res){
  const u=new URL(req.url,"http://x");
  let p;
  try{ p=decodeURIComponent(u.pathname); }catch{ res.writeHead(400,{"content-type":"text/plain"}); return res.end("bad request"); }
  if (p.includes("\0")){ res.writeHead(400,{"content-type":"text/plain"}); return res.end("bad request"); }
  if (p==="/health"){ res.writeHead(200,{"content-type":"text/plain"}); return res.end("ok"); }
  if (p==="/config.js"){ res.writeHead(200,{"content-type":TYPES[".js"],"cache-control":"no-store"}); return res.end(configJs()); }
  let file;
  if (p==="/sim.js") file=path.join(ROOT,"shared","sim.js");
  else if (p==="/rush.js") file=path.join(ROOT,"shared","rush.js");
  else if (p==="/bear.js") file=path.join(ROOT,"shared","bear.js");
  else if (p==="/munch.js") file=path.join(ROOT,"shared","munch.js");
  else if (p==="/softball.js") file=path.join(ROOT,"shared","softball.js");
  else if (p==="/crossword.js") file=path.join(ROOT,"shared","crossword.js");
  else if (p==="/hurdle.js") file=path.join(ROOT,"shared","hurdle.js");
  else if (p==="/wordsearch.js") file=path.join(ROOT,"shared","wordsearch.js");
  else if (p==="/sky.js") file=path.join(ROOT,"shared","sky.js");
  else if (p==="/darts.js") file=path.join(ROOT,"shared","darts.js");
  else if (p==="/cannons.js") file=path.join(ROOT,"shared","cannons.js");
  else if (p==="/typing.js") file=path.join(ROOT,"shared","typing.js");
  else if (p==="/memory.js") file=path.join(ROOT,"shared","memory.js");
  else if (p==="/hoops.js") file=path.join(ROOT,"shared","hoops.js");
  else {
    if (p.endsWith("/")) p+="index.html";
    file=path.normalize(path.join(PUBLIC,p));
    if (file!==PUBLIC && !file.startsWith(PUBLIC+path.sep)){ res.writeHead(403); return res.end(); }
  }
  // /clean-getaway → /clean-getaway/ so the page's relative paths resolve
  if (!path.extname(file) && fs.existsSync(path.join(file,"index.html"))){ res.writeHead(301,{ location:p+"/"+u.search }); return res.end(); }
  fs.readFile(file,(err,buf)=>{
    if (err){ res.writeHead(404,{"content-type":"text/plain"}); return res.end("not found"); }
    const ext=path.extname(file);
    res.writeHead(200,{ "content-type":TYPES[ext]||"application/octet-stream",
      "cache-control": ext===".html"||ext===".js" ? "no-cache" : "public, max-age=86400" });
    res.end(buf);
  });
}
module.exports={ serveStatic };
