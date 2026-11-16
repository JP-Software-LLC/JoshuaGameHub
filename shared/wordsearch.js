// Word Rush (live word search) — shared by the server room and the browser (solo vs bots + client-side checks).
// One giant grid for everyone. The first player to drag across a word claims it in their colour.
(function(root,factory){ if (typeof module==="object"&&module.exports) module.exports=factory(); else root.WORDS=factory(); })(this,function(){
"use strict";
const T={ cols:30, rows:18, words:28, time:360, minLen:3, maxLen:15, maxCustom:40 };   // 540 letters · 6-minute limit

// kid-friendly themed word banks (4–9 letters so they fit and are easy to read)
const THEMES={
  "Animals":["ELEPHANT","GIRAFFE","PENGUIN","DOLPHIN","KANGAROO","TIGER","ZEBRA","MONKEY","RABBIT","TURTLE","PARROT","OCTOPUS","CHEETAH","GORILLA","HAMSTER","LOBSTER","BEAVER","CAMEL","KOALA","LIZARD","OSTRICH","PANDA","SQUIRREL","WALRUS","FLAMINGO","HEDGEHOG","JAGUAR","LLAMA","MOOSE","OTTER","PELICAN","RACCOON","SPARROW","TOUCAN","WHALE","BADGER","FALCON","FERRET"],
  "Space":["PLANET","COMET","GALAXY","ROCKET","ORBIT","METEOR","SATURN","JUPITER","MARS","VENUS","MERCURY","NEPTUNE","URANUS","EARTH","MOON","STAR","NEBULA","ASTEROID","CRATER","GRAVITY","ECLIPSE","SHUTTLE","ALIEN","COSMOS","TELESCOPE","LAUNCH","CAPSULE","STATION","SOLAR","LUNAR","ROVER","SPACESUIT","BEAM","ZODIAC","PROBE","HELMET"],
  "Food":["APPLE","BANANA","CARROT","PIZZA","PASTA","CHEESE","BREAD","BUTTER","COOKIE","MUFFIN","PANCAKE","WAFFLE","GRAPES","ORANGE","LEMON","MANGO","PEACH","CHERRY","TOMATO","POTATO","CELERY","BROCCOLI","PRETZEL","POPCORN","NOODLES","CEREAL","YOGURT","HONEY","TACO","SALAD","SANDWICH","PICKLE","OATMEAL","PEPPER","MELON","RAISIN","BAGEL"],
  "Sports":["SOCCER","TENNIS","HOCKEY","GOLF","RUGBY","BOXING","KARATE","SKIING","ROWING","CYCLING","DIVING","ARCHERY","BASEBALL","FOOTBALL","CRICKET","BOWLING","SURFING","SKATING","SWIMMING","RUNNING","JUMPING","RELAY","MEDAL","TROPHY","COACH","REFEREE","STADIUM","WHISTLE","HELMET","RACKET","GOAL","TEAM","SPRINT","HURDLE","SCORE","LEAGUE","DRIBBLE"],
  "Nature":["FOREST","RIVER","MOUNTAIN","VALLEY","OCEAN","ISLAND","DESERT","CANYON","MEADOW","JUNGLE","VOLCANO","GLACIER","WATERFALL","LAKE","POND","STREAM","CLOUD","RAINBOW","THUNDER","BREEZE","SUNSET","FLOWER","TREE","LEAF","ACORN","PEBBLE","BOULDER","CAVE","CLIFF","BEACH","TULIP","DAISY","FERN","MOSS","SNOW","STORM","PINECONE"],
  "School":["PENCIL","ERASER","RULER","CRAYON","MARKER","NOTEBOOK","BACKPACK","TEACHER","STUDENT","LIBRARY","SCIENCE","HISTORY","READING","WRITING","SPELLING","MATH","ART","MUSIC","RECESS","LUNCH","DESK","CHAIR","CHALK","GLOBE","MAP","SCISSORS","GLUE","PAPER","FOLDER","LESSON","QUIZ","PROJECT","CLASS","FRIEND","HALLWAY","LOCKER","BINDER"],
};
// filler letters must never spell these in any direction (word cells are already chosen safe)
const BLOCK=["FUCK","FUK","FCK","SHIT","SHT","CUNT","DICK","COCK","PISS","PUSSY","SLUT","WHORE","BITCH","FAG","DAMN","HELL","ASS","TIT","SEX","PORN","NAZI","KKK","CRAP","BUTT","BOOB","FART","PENIS","KILL","DIE","DEAD","GUN","NUDE","POOP","PEE","JEW","GAY","HOMO","NIG","RAPE","HATE","WTF","STFU","DUMB","STUPID","IDIOT","UGLY","FAT","LOSER","SUCK"];
const DIRS=[[0,1],[1,0],[1,1],[-1,1],[0,-1],[-1,0],[-1,-1],[1,-1]];
// filler skews to common letters so the grid looks like real words (and so fake starts are everywhere)
const FILL="EEEEAAAIIIOOOTTTNNNRRRSSSLLLCCDDGGHMMPPUUBBFKWVY";

function rng(seed){ let s=seed>>>0||1; return ()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }; }

// "star pattern" colours: each new player gets the hue farthest from all hues used so far
// (0°, 180°, 90°, 270°, 45°, …), and later laps of the wheel switch lightness so 40 players stay distinct.
function vdc(i){ let v=0, d=0.5; while (i){ if (i&1) v+=d; i>>=1; d/=2; } return v; }
function color(i){ i=Math.max(0,i|0); const lap=Math.floor(i/12), h=(vdc(i)*360+8)%360;
  const L=[50,36,66,44][lap%4], S=[88,80,82,70][lap%4]; return `hsl(${h.toFixed(1)},${S}%,${L}%)`; }
// dark text on light colours (yellows, greens, cyans and the light lap), white on the rest
function ink(i){ i=Math.max(0,i|0); const lap=Math.floor(i/12)%4, h=(vdc(i)*360+8)%360; return lap===2||(lap!==1&&h>=40&&h<=200)?"#1d2033":"#fff"; }

// custom: optional teacher word list { title, words:[...] } (already cleaned with cleanList)
function makeBoard(seed,custom){
  const R=rng(seed), C=T.cols, H=T.rows, g=new Array(C*H).fill(""), word=new Array(C*H).fill(false);
  const names=Object.keys(THEMES), theme=custom&&custom.words.length?(custom.title||"Our words"):names[R()*names.length|0];
  const pool=custom&&custom.words.length?custom.words.slice():THEMES[theme].slice();
  const want=custom&&custom.words.length?Math.min(T.maxCustom,custom.words.length):T.words; for (let i=pool.length-1;i>0;i--){ const j=R()*(i+1)|0; [pool[i],pool[j]]=[pool[j],pool[i]]; }
  pool.sort((a,b)=>b.length-a.length);                                   // long words first: they're hardest to fit
  const words=[];
  for (const w of pool){
    if (words.length>=want) break;
    for (let tries=0;tries<300;tries++){
      const [dr,dc]=DIRS[R()*(tries<200?8:4)|0];                          // a few backwards words, mostly forwards
      const r0=R()*H|0, c0=R()*C|0, r1=r0+dr*(w.length-1), c1=c0+dc*(w.length-1);
      if (r1<0||r1>=H||c1<0||c1>=C) continue;
      let ok=true, overlap=0;
      for (let k=0;k<w.length;k++){ const i=(r0+dr*k)*C+c0+dc*k; if (g[i]&&g[i]!==w[k]){ ok=false; break; } if (g[i]) overlap++; }
      if (!ok||overlap>1) continue;
      for (let k=0;k<w.length;k++){ const i=(r0+dr*k)*C+c0+dc*k; g[i]=w[k]; word[i]=true; }
      words.push({ w, a:[r0,c0,r1,c1] }); break;
    }
  }
  for (let i=0;i<g.length;i++) if (!g[i]) g[i]=FILL[R()*FILL.length|0];
  // clean the filler: re-roll a filler cell of any blocked word, in all 8 directions, until none are left
  for (let pass=0;pass<60;pass++){
    let bad=0;
    for (let r=0;r<H;r++) for (let c=0;c<C;c++) for (const [dr,dc] of DIRS) for (const b of BLOCK){
      let k=0, cells=[]; for (;k<b.length;k++){ const rr=r+dr*k, cc=c+dc*k; if (rr<0||rr>=H||cc<0||cc>=C) break; const i=rr*C+cc; if (g[i]!==b[k]) break; cells.push(i); }
      if (k<b.length) continue;
      const free=cells.filter(i=>!word[i]); if (!free.length) continue;
      bad++; const i=free[R()*free.length|0]; g[i]=FILL[R()*FILL.length|0];
    }
    if (!bad) break;
  }
  // no accidental second copy of a bank word in the filler (so every claim is the real one)
  words.sort((a,b)=>a.w<b.w?-1:1);
  return { theme, cols:C, rows:H, grid:g.join(""), words };
}

// letters along a dragged line, or null if it isn't a straight 8-direction line
function lineCells(a,cols,rows){
  const [r0,c0,r1,c1]=a.map(v=>v|0), dr=Math.sign(r1-r0), dc=Math.sign(c1-c0), n=Math.max(Math.abs(r1-r0),Math.abs(c1-c0))+1;
  if (r0<0||r1<0||c0<0||c1<0||r0>=rows||r1>=rows||c0>=cols||c1>=cols) return null;
  if (r1!==r0 && c1!==c0 && Math.abs(r1-r0)!==Math.abs(c1-c0)) return null;
  return Array.from({length:n},(_,k)=>(r0+dr*k)*cols+c0+dc*k);
}
function readLine(board,a){ const cs=lineCells(a,board.cols,board.rows); return cs?cs.map(i=>board.grid[i]).join(""):""; }
// which unfound word does this drag spell (forwards or backwards)? -1 if none
function match(board,found,a){
  const s=readLine(board,a); if (s.length<T.minLen) return -1;
  const rev=[...s].reverse().join("");
  return board.words.findIndex((w,i)=>{ w=w.w||w; return !found[i]&&(w===s||w===rev); });            // words may be {w,a} (server) or plain strings (client)
}

// a teacher's pasted list -> clean unique words (letters only, 3–15 long, at most 40), plus what was skipped
function cleanList(text,title){
  const words=[], skipped=[];
  for (const raw of String(text||"").split(/[\n,;]+/)){
    const w=raw.toUpperCase().replace(/[^A-Z]/g,""); if (!raw.trim()) continue;
    if (w.length<T.minLen||w.length>T.maxLen){ skipped.push(raw.trim().slice(0,20)); continue; }
    if (!words.includes(w) && words.length<T.maxCustom) words.push(w);
  }
  return { title:String(title||"").replace(/[^\p{L}\p{N} '&!?.,-]/gu,"").trim().slice(0,30), words, skipped };
}
class Game {
  constructor(players,seed,custom){
    this.seed=seed||((Math.random()*2**31)|0)+1;
    this.board=makeBoard(this.seed,custom);
    this.found=this.board.words.map(()=>null);                 // index -> { id, a, t }
    this.players=players.map(p=>({ id:p.id, name:p.name, bot:!!p.bot, score:0, words:0, last:0, tries:0, next:0, lazy:p.lazy||1 }));
    this.time=0; this.phase="play"; this.events=[];
    for (const p of this.players) if (p.bot) p.next=this.botDelay(p);
  }
  addPlayer(p){ if (!this.players.some(q=>q.id===p.id)) this.players.push({ id:p.id, name:p.name, bot:false, score:0, words:0, last:0, tries:0, next:0, lazy:1 }); }
  botDelay(p){ return (18+Math.random()*30)*p.lazy; }
  left(){ return this.found.filter(f=>!f).length; }
  claim(id,a){
    if (this.phase!=="play") return -1;
    const p=this.players.find(q=>q.id===id); if (!p) return -1;
    p.tries++;
    const i=match(this.board,this.found,a); if (i<0) return -1;
    const pts=this.board.words[i].w.length;
    this.found[i]={ id, a:a.map(v=>v|0), t:this.time };
    p.score+=pts; p.words++; p.last=this.time;
    this.events.push(["found",i,id,a.map(v=>v|0),pts]);
    if (!this.left()){ this.phase="over"; this.events.push(["over"]); }
    return i;
  }
  step(dt){
    if (this.phase!=="play") return;
    this.time+=dt;
    for (const p of this.players) if (p.bot && this.time>=p.next){
      const open=this.found.map((f,i)=>f?-1:i).filter(i=>i>=0);
      if (open.length){ const i=open[Math.random()*open.length|0], a=this.board.words[i].a; this.claim(p.id,Math.random()<0.5?a:[a[2],a[3],a[0],a[1]]); }
      p.next=this.time+this.botDelay(p);
    }
    if (this.time>=T.time && this.phase==="play"){ this.phase="over"; this.events.push(["over"]); }
  }
  drainEvents(){ const e=this.events; this.events=[]; return e; }
  foundList(){ return this.found.map((f,i)=>f?[i,f.id,f.a]:null).filter(Boolean); }
  ranking(){
    return this.players.slice().sort((a,b)=>b.score-a.score||b.words-a.words||(a.last||1e9)-(b.last||1e9))
      .map(p=>({ id:p.id, name:p.name, score:p.score, words:p.words }));
  }
}
return { T, THEMES, BLOCK, DIRS, color, ink, cleanList, makeBoard, lineCells, readLine, match, Game };
});
