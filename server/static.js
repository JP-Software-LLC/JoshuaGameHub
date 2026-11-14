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

function serveStatic(req,res){
  const u=new URL(req.url,"http://x");
  let p=decodeURIComponent(u.pathname);
  if (p==="/health"){ res.writeHead(200,{"content-type":"text/plain"}); return res.end("ok"); }
  if (p==="/config.js"){ res.writeHead(200,{"content-type":TYPES[".js"],"cache-control":"no-store"}); return res.end(configJs()); }
  let file;
  if (p==="/sim.js") file=path.join(ROOT,"shared","sim.js");
  else {
    if (p.endsWith("/")) p+="index.html";
    file=path.normalize(path.join(PUBLIC,p));
    if (!file.startsWith(PUBLIC)){ res.writeHead(403); return res.end(); }
  }
  fs.readFile(file,(err,buf)=>{
    if (err){ res.writeHead(404,{"content-type":"text/plain"}); return res.end("not found"); }
    const ext=path.extname(file);
    res.writeHead(200,{ "content-type":TYPES[ext]||"application/octet-stream",
      "cache-control": ext===".html"||ext===".js" ? "no-cache" : "public, max-age=86400" });
    res.end(buf);
  });
}
module.exports={ serveStatic };
