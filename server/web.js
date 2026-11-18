// Frontend service entry (Railway "web"): static client only.
"use strict";
const http=require("http");
const { serveStatic }=require("./static");
const PORT=process.env.PORT||8080;
http.createServer(serveStatic).listen(PORT,()=>console.log(`[web] client on :${PORT} · game server: ${process.env.GAME_SERVER_URL||"(same origin)"}`));
// static-only service: log anything unexpected instead of crashing the whole site
process.on("uncaughtException",e=>console.error("[web] uncaught:",e&&e.stack||e));
process.on("unhandledRejection",e=>console.error("[web] unhandled rejection:",e&&e.stack||e));
