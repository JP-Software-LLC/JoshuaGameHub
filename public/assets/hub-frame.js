/* Joshua Game Hub — shared frame.
   Gives every game the same brand bar, exit button, favicon and "more games" strip,
   so each game keeps its own art but clearly lives inside the hub.
   Usage: <script src="/assets/hub-frame.js" defer></script>
   - On a game's menu (exit button titled "Back to game hub") the hub bar shows.
   - While playing, only the hub-styled exit button shows, so nothing covers the game.
   - data-always on the script tag keeps the bar visible (teacher dashboard). */
(function(){
  // anonymous page-view count (no name, no id, no cookie): server/stats.js. Hub previews are not counted.
  if (!/[?&]demo=1/.test(location.search)) addEventListener("load",()=>{ try{
    const s=(window.CG_CONFIG&&CG_CONFIG.server)||"", base=s?s.replace(/^ws/,"http").replace(/\/$/,""):"";
    fetch(base+"/api/hit",{ method:"POST", headers:{ "content-type":"application/json" }, keepalive:true,
      body:JSON.stringify({ view:location.pathname, play:new URLSearchParams(location.search).get("play")||"" }) }).catch(()=>{});
  }catch{} });
  // ?spectate=CODE&pid=N&who=Name: admin watch mode (opened from /admin/live/). The page's own socket is
  // rewritten so its "hello" becomes spectate{code,pid,auth} and everything else it would send is dropped,
  // so the watcher sees exactly what that player's (or the teacher's) screen gets and can never act in the game.
  const SPY=new URLSearchParams(location.search);
  if (SPY.get("spectate")){
    const code=SPY.get("spectate").toUpperCase().replace(/[^A-Z]/g,"").slice(0,4), pid=SPY.get("pid")||"", who=(SPY.get("who")||"").slice(0,40);
    const Native=window.WebSocket;
    class SpyWS extends Native {
      send(raw){ let m=null; try{ m=JSON.parse(raw); }catch{ return; }
        if (m.t==="hello"){ let auth; try{ auth=localStorage.getItem("jgh_auth")||undefined; }catch{}
          return super.send(JSON.stringify({ t:"spectate", code, pid, auth })); }
        if (m.t==="ping"||m.t==="leave") return super.send(raw); }
      set onmessage(fn){ super.onmessage=fn&&(e=>{ try{ const t=JSON.parse(e.data).t; if (t==="welcome") return; }catch{} fn.call(this,e); }); }
      get onmessage(){ return super.onmessage; }
    }
    window.WebSocket=SpyWS;
    addEventListener("load",()=>setTimeout(()=>{
      const ci=document.getElementById("codeIn"), bj=document.getElementById("bJoin")||document.getElementById("btnJoin");
      if (ci && bj){ ci.value=code; bj.click(); }
      const b=document.createElement("div");
      b.textContent=`👀 Watching${who?" "+who:""} · ${code} · read only`;
      b.style.cssText="position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:99999;background:rgba(200,30,60,.92);color:#fff;font:600 13px system-ui,sans-serif;padding:6px 14px;border-radius:999px;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.4)";
      document.body.appendChild(b);
    },300));
  }
  // ?demo=1: the hub's live bot-match preview. No bar, no buttons, no input: the game page starts a
  // bots-only match itself (each game checks the same flag) and we just hide everything that isn't the game.
  if (/[?&]demo=1/.test(location.search)){
    const st=document.createElement("style");
    st.textContent=`#exitBtn,#hint,#touchHint,.tb,#stick,#throwBtn,#legs,.legs,#tL,#tR,#tF,#pad,#quiz,#confetti,#jgh-bar,#jgh-menu{display:none!important}
      html,body{pointer-events:none!important;cursor:default!important}
      #menu,#lobby,#sMenu{visibility:hidden!important}`;
    document.head.appendChild(st);
    return;
  }
  const me=document.currentScript, ALWAYS=me&&me.hasAttribute("data-always"), PAD=me&&me.hasAttribute("data-pad");
  const GAMES=[
    ["/clean-getaway/","Clean Getaway","🏦"],["/arrow-blitz/","Arrow Blitz","🏹"],["/math-race/","Math Race","➗"],
    ["/rush-hour/","Rush Hour","🚗"],["/hurdle-dash/","Hurdle Dash","🏃"],["/mathsketball/","Mathsketball","🏀"],["/marble-munch/","Marble Munch","🦛"], ["/softball-smarts/","Softball Smarts","🥎"],["/bear-attack/","Bear Attack!","🐻"],
    ["/memory-tiles/","Memory Tiles","🧠"],["/odds-evens/","Odds or Evens","✂️"], ["/crossword/","Vocab Crossword","✏️"],["/typing-cowboys/","Typing Cowboys","🤠"],["/star-cannons/","Star Cannons","🚀"],["/dart-party/","Dart Party","🎈"],["/sky-climb/","Sky Climb","🪽"],["/word-rush/","Word Rush","🔤"],
  ];
  const here=location.pathname.replace(/index\.html$/,"");
  // which hub view the player came from (landing page: Student · Teacher · Guest); "Back" returns there
  const MODE=(()=>{ try{ return localStorage.getItem("jgh_mode")||""; }catch{ return ""; } })();
  const HOME=MODE?"/#"+MODE:"/";
  window.JGH={ mode:MODE, home:HOME };

  // fonts + favicon + theme colour, shared with the hub
  const head=document.head;
  if (!document.querySelector('link[href*="Press+Start+2P"]') || !document.querySelector('link[href*="Space+Grotesk"]')){
    const l=document.createElement("link"); l.rel="stylesheet";
    l.href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Space+Grotesk:wght@500;600;700&display=swap"; head.appendChild(l);
  }
  if (!document.querySelector('link[rel="icon"]')){
    const i=document.createElement("link"); i.rel="icon";
    i.href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'%3E%3Crect width='16' height='16' rx='3' fill='%2307080c'/%3E%3Crect x='3' y='5' width='10' height='6' fill='%2358c27d'/%3E%3Crect x='3' y='7' width='10' height='1' fill='%232f7d4a'/%3E%3Crect x='7' y='6' width='2' height='4' fill='%23f2c94c'/%3E%3C/svg%3E";
    head.appendChild(i);
  }

  const css=`
  :root{--jgh-h:46px}
  #jgh-bar{position:fixed;top:0;left:0;right:0;z-index:2147483000;height:var(--jgh-h);display:flex;align-items:center;gap:14px;padding:0 14px;
    background:linear-gradient(rgba(7,8,12,.92),rgba(7,8,12,.78));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    border-bottom:1px solid rgba(255,255,255,.1);font:500 14px "Space Grotesk",system-ui,sans-serif;color:#eeebe3;
    transition:transform .25s ease,opacity .25s ease}
  #jgh-bar[data-off]{transform:translateY(-100%);opacity:0;pointer-events:none}
  #jgh-bar a{color:inherit;text-decoration:none}
  #jgh-bar .jgh-brand{display:flex;align-items:center;gap:9px;white-space:nowrap}
  #jgh-bar .jgh-brand svg{width:24px;height:24px;filter:drop-shadow(0 0 8px rgba(242,201,76,.35))}
  #jgh-bar .jgh-brand b{font:400 10px/1.4 "Press Start 2P",monospace;letter-spacing:.5px}
  #jgh-bar .jgh-brand b span{color:#f2c94c}
  #jgh-bar .jgh-crumb{display:flex;align-items:center;gap:10px;min-width:0;color:#8f98a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #jgh-bar .jgh-crumb i{width:1px;height:18px;background:rgba(255,255,255,.18)}
  #jgh-bar .jgh-crumb strong{color:#eeebe3;font-weight:600;overflow:hidden;text-overflow:ellipsis}
  #jgh-bar .jgh-nav{margin-left:auto;display:flex;align-items:center;gap:6px}
  #jgh-bar button,#jgh-bar a,#jgh-menu a{all:unset;box-sizing:border-box;cursor:pointer}
  body.jgh-on.jgh-pad .screen{top:var(--jgh-h);align-items:safe center}
  #jgh-bar .jgh-nav a,#jgh-bar .jgh-nav button{font:600 13px "Space Grotesk",system-ui,sans-serif;color:#c7ccd6;padding:7px 11px;border-radius:9px;border:1px solid transparent;background:none;cursor:pointer;white-space:nowrap}
  #jgh-bar .jgh-nav a:hover,#jgh-bar .jgh-nav button:hover,#jgh-bar .jgh-nav button[aria-expanded="true"]{color:#fff;background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12)}
  #jgh-bar .jgh-nav .jgh-t{color:#ffb3b3}
  #jgh-menu{position:fixed;top:calc(var(--jgh-h) + 6px);right:12px;z-index:2147483001;width:min(300px,calc(100vw - 24px));padding:8px;border-radius:14px;
    background:rgba(13,16,24,.97);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 50px rgba(0,0,0,.55);font:500 14px "Space Grotesk",system-ui,sans-serif}
  #jgh-menu[hidden]{display:none}
  #jgh-menu a{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;color:#eeebe3;text-decoration:none}
  #jgh-menu a:hover{background:rgba(255,255,255,.06)}
  #jgh-menu a[aria-current]{background:rgba(242,201,76,.1);color:#f2c94c}
  #jgh-menu a span{width:22px;text-align:center}
  #jgh-menu hr{border:0;border-top:1px solid rgba(255,255,255,.1);margin:6px 4px}
  @media (max-width:640px){ #jgh-bar .jgh-brand b{display:none} #jgh-bar .jgh-nav .jgh-hide{display:none} #jgh-bar{gap:10px;padding:0 10px} }

  /* one exit button for every game */
  #exitBtn{position:fixed!important;top:10px!important;right:10px!important;left:auto!important;z-index:2147482999!important;
    width:34px!important;height:34px!important;padding:0!important;border-radius:10px!important;display:grid!important;place-items:center!important;
    background:rgba(7,8,12,.82)!important;border:1px solid rgba(242,201,76,.45)!important;color:#f2c94c!important;
    box-shadow:0 3px 0 rgba(0,0,0,.5)!important;backdrop-filter:blur(8px);font-size:15px!important;cursor:pointer;transform:none!important}
  #exitBtn:hover,#exitBtn:focus-visible{background:#f2c94c!important;color:#1a1408!important;outline:none!important}
  #exitBtn svg{width:16px!important;height:16px!important}
  body.jgh-on #exitBtn{display:none!important}
  /* big, obvious way back: kids look for it */
  #exitBtn{width:auto!important;height:46px!important;padding:0 16px 0 12px!important;gap:8px;grid-auto-flow:column;font:700 17px "Space Grotesk",system-ui,sans-serif!important;border-radius:14px!important;border-width:2px!important}
  #exitBtn::after{content:"Leave"}
  #jgh-bar .jgh-back{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 18px 0 14px;border-radius:12px;
    background:#f2c94c;color:#1a1408;font:700 17px "Space Grotesk",system-ui,sans-serif;box-shadow:0 3px 0 #b8862b;white-space:nowrap}
  #jgh-bar .jgh-back:hover,#jgh-bar .jgh-back:focus-visible{filter:brightness(1.08);outline:none}
  :root{--jgh-h:58px}
  /* a screen that just appeared ignores taps for a second (stops accidental presses as a round ends) */
  .jgh-wait button,.jgh-wait a,.jgh-wait input{pointer-events:none!important}
  .jgh-wait button,.jgh-wait a.btn{opacity:.55;transition:opacity .2s}`;
  const st=document.createElement("style"); st.id="jgh-style"; st.textContent=css; head.appendChild(st);

  function build(){
    const cur=GAMES.find(g=>here.startsWith(g[0]));
    const teacher=here.startsWith("/teacher");
    const bar=document.createElement("header"); bar.id="jgh-bar"; bar.setAttribute("data-off","");
    bar.innerHTML=`
      ${teacher&&!ALWAYS?"":`<a class="jgh-back" href="${HOME}" aria-label="Back to the games">← Back to games</a>`}
      <a class="jgh-brand" href="${HOME}" aria-label="Joshua Game Hub home">
        <svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect width="16" height="16" rx="3" fill="#07080c"/><rect x="3" y="5" width="10" height="6" fill="#58c27d"/><rect x="3" y="7" width="10" height="1" fill="#2f7d4a"/><rect x="7" y="6" width="2" height="4" fill="#f2c94c"/></svg>
        <b>JOSHUA <span>GAME</span> HUB</b></a>
      <div class="jgh-crumb"><i></i><strong>${cur?cur[2]+" "+cur[1]:teacher?"🍎 Teacher dashboard":here.startsWith("/school")?"🏰 School castles":""}</strong></div>
      <nav class="jgh-nav">
        <button type="button" id="jgh-more" aria-expanded="false" aria-haspopup="true">All games ▾</button>
        ${teacher||MODE==="student"?"":'<a class="jgh-t jgh-hide" href="/teacher/">🍎 Teachers</a>'}
      </nav>`;
    const menu=document.createElement("div"); menu.id="jgh-menu"; menu.hidden=true;
    menu.innerHTML=GAMES.map(g=>`<a href="${g[0]}"${cur&&cur[0]===g[0]?' aria-current="page"':""}><span>${g[2]}</span>${g[1]}</a>`).join("")
      +`<hr><a href="${HOME}"><span>🏠</span>Game hub home</a><a href="/teacher/"><span>🍎</span>Teacher dashboard</a>`;
    document.body.prepend(menu); document.body.prepend(bar);
    const more=bar.querySelector("#jgh-more");
    const close=()=>{ menu.hidden=true; more.setAttribute("aria-expanded","false"); };
    more.onclick=e=>{ e.stopPropagation(); menu.hidden=!menu.hidden; more.setAttribute("aria-expanded",String(!menu.hidden)); };
    document.addEventListener("click",e=>{ if (!menu.contains(e.target)) close(); });
    document.addEventListener("keydown",e=>{ if (e.key==="Escape"&&!menu.hidden){ close(); e.stopImmediatePropagation(); } },true);

    const ex=document.getElementById("exitBtn");
    // on a game's menu the exit button means "back to the hub": go to the view they came from
    if (ex) ex.addEventListener("click",e=>{ if (/^Back to game hub/.test(ex.title||"")){ e.stopImmediatePropagation(); e.preventDefault(); location.href=HOME; } },true);
    document.addEventListener("click",e=>{ const a=e.target.closest&&e.target.closest('a[href="../"],a[href="/"]'); if (a && !a.closest("#jgh-bar")){ e.preventDefault(); location.href=HOME; } },true);
    // tap guard: any screen that becomes visible ignores taps for 1 s
    const vis=el=>!el.hidden && getComputedStyle(el).display!=="none" && getComputedStyle(el).visibility!=="hidden";
    const seen=new WeakMap();
    const guard=()=>{ document.querySelectorAll(".screen,.scr,section[id],.overlay,.panel-ov").forEach(el=>{ const v=vis(el), was=seen.get(el);
      if (v && was===false){ el.classList.add("jgh-wait"); clearTimeout(el._jw); el._jw=setTimeout(()=>el.classList.remove("jgh-wait"),1000); }
      seen.set(el,v); }); };
    let gq=0; guard(); new MutationObserver(()=>{ if (!gq) gq=requestAnimationFrame(()=>{ gq=0; guard(); }); }).observe(document.body,{ subtree:true, attributes:true, attributeFilter:["class","hidden"] });
    const sync=()=>{
      const on=ALWAYS||(ex&&/^Back to game hub/.test(ex.title||""));
      bar.toggleAttribute("data-off",!on); document.body.classList.toggle("jgh-on",!!on); document.body.classList.toggle("jgh-pad",PAD);
      if (!on) close();
      window.dispatchEvent(new Event("resize"));            // canvases re-measure around the bar
    };
    if (ex) new MutationObserver(sync).observe(ex,{attributes:true,attributeFilter:["title"]});
    sync();
  }
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",build):build();
})();
