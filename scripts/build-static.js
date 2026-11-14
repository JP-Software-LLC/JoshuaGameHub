// Builds dist/ — a plain static copy of the client (for itch.io, Cloudflare Pages, any CDN).
// Usage: GAME_SERVER_URL=wss://game.example.com npm run build:static
"use strict";
const fs=require("fs"), path=require("path");
const root=path.join(__dirname,".."), out=path.join(root,"dist");
fs.rmSync(out,{ recursive:true, force:true });
fs.cpSync(path.join(root,"public"),out,{ recursive:true });
fs.copyFileSync(path.join(root,"shared","sim.js"),path.join(out,"sim.js")); // pages load it as /sim.js or ../sim.js
fs.copyFileSync(path.join(root,"shared","rush.js"),path.join(out,"rush.js"));
fs.copyFileSync(path.join(root,"shared","bear.js"),path.join(out,"bear.js"));
fs.copyFileSync(path.join(root,"shared","hurdle.js"),path.join(out,"hurdle.js"));
const url=(process.env.GAME_SERVER_URL||"").trim();
fs.writeFileSync(path.join(out,"config.js"),`window.CG_CONFIG=${JSON.stringify({ server:url })};\n`);
console.log(`dist/ built · game server: ${url||"(same origin)"}`);
