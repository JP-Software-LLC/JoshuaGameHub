// Memory Tiles — shared rules (Node: require; browser: window.MEMORY for solo mode).
// N×N black tiles. Each round every tile flips to show a picture for a few seconds, then flips
// back. A target picture is shown and players have a fixed time to stand on a tile with it.
// Anyone not on a matching tile is out. Round 1 uses 2 different pictures, building up to a maximum of 4.
// Reveal time shrinks each round; choosing time stays the same. Positions are secret until the reveal.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MEMORY = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

const PICS=["🍎","🐶","⭐","🚗","🌙","🐟","🎈","🌸","🍕","⚽","🦋","🍩"];
const T = {
  N: 5,                                            // 5×5 grid
  decideT: 7,                                      // seconds to get onto a tile (constant)
  hideT: 1.2,                                      // tiles flip back to black
  resultT: 4.5,                                    // show everyone + who's out
  revealFor: r=>Math.max(3.5, 7-0.25*(r-1)),       // picture reveal: 7 s, then 0.25 s shorter each round (min 3.5 s)
  imagesFor: r=>r<=3?2:r<=7?3:4,                   // 2 pictures (rounds 1–3), 3 (rounds 4–7), then 4 max
  maxRounds: 25,
};
function rng(seed){ let a=seed>>>0; return ()=>{ a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// phases: reveal → hide → decide → result → (next round) … → over
// events: round{n,tiles,target,reveal}, hide, decide{target}, result{pos,out,correct}, over{winners}
class Game {
  constructor(players, seed=(Math.random()*2**31)|0){
    this.r=rng(seed); this.events=[]; this.round=0; this.phase="idle"; this.timer=0; this.tiles=[]; this.target=0;
    this.players=players.map(p=>({ id:p.id, name:p.name, bot:!!p.bot, x:0, y:0, alive:true, outRound:null, correct:0 }));
    this.solo=this.players.length===1;
    const N=T.N, spots=[...Array(N*N).keys()].sort(()=>this.r()-0.5);
    this.players.forEach((p,i)=>{ const s=spots[i%spots.length]; p.x=s%N; p.y=(s/N)|0; });
  }
  emit(type,data){ this.events.push(Object.assign({ type },data)); }
  drainEvents(){ const e=this.events; this.events=[]; return e; }
  alive(){ return this.players.filter(p=>p.alive); }
  setPhase(p,t){ this.phase=p; this.timer=t; this.phaseT=t; }
  // late joiner: drops onto a random tile; the round they join in never counts against them (they missed the pictures)
  addPlayer(pl){
    if (this.players.some(q=>q.id===pl.id) || this.phase==="over") return;
    const s=this.r()*T.N*T.N|0;
    this.players.push({ id:pl.id, name:pl.name, bot:!!pl.bot, x:s%T.N, y:(s/T.N)|0, alive:true, outRound:null, correct:0, safeRound:this.round });
    this.solo=false;
  }
  start(){ this.nextRound(); }
  nextRound(){
    this.round++;
    const N=T.N, k=T.imagesFor(this.round), pics=[...PICS.keys()].sort(()=>this.r()-0.5).slice(0,k);
    const tiles=[...pics];                                                   // every picture appears at least once
    while (tiles.length<N*N) tiles.push(pics[this.r()*k|0]);
    this.tiles=tiles.sort(()=>this.r()-0.5);
    this.target=pics[this.r()*k|0];
    const reveal=T.revealFor(this.round);
    this.setPhase("reveal",reveal);
    this.emit("round",{ n:this.round, tiles:this.tiles, target:this.target, reveal, hide:T.hideT, decide:T.decideT, result:T.resultT });
  }
  move(id,dx,dy){
    const p=this.players.find(q=>q.id===id);
    if (!p||!p.alive||this.phase!=="decide") return null;
    p.x=Math.max(0,Math.min(T.N-1,p.x+Math.sign(dx||0))); p.y=Math.max(0,Math.min(T.N-1,p.y+Math.sign(dy||0)));
    return { x:p.x, y:p.y };
  }
  step(dt){
    if (this.phase==="over"||this.phase==="idle") return;
    this.timer-=dt;
    if (this.timer>0) return;
    switch (this.phase){
      case "reveal": this.setPhase("hide",T.hideT); this.emit("hide",{}); break;
      case "hide": this.setPhase("decide",T.decideT); this.emit("decide",{ target:this.target }); break;
      case "decide": {
        const A=this.alive().filter(p=>p.safeRound!==this.round), ok=A.filter(p=>this.tiles[p.y*T.N+p.x]===this.target);
        const out=ok.length?A.filter(p=>!ok.includes(p)):[];                // nobody right → nobody out this round
        for (const p of ok) p.correct++;
        for (const p of out){ p.alive=false; p.outRound=this.round; }
        this.setPhase("result",T.resultT);
        this.emit("result",{ pos:this.players.map(p=>[p.id,p.x,p.y,p.alive?1:0]), out:out.map(p=>p.id), correct:ok.map(p=>p.id), target:this.target, tiles:this.tiles });
        break; }
      case "result": {
        const left=this.alive();
        const done=this.solo?!left.length||this.round>=T.maxRounds:left.length<=1||this.round>=T.maxRounds;
        if (done){ this.setPhase("over",0); this.emit("over",{ winners:left.length?left.map(p=>p.id):this.lastOut() }); }
        else this.nextRound();
        break; }
    }
  }
  lastOut(){ const r=Math.max(...this.players.map(p=>p.outRound||0)); return this.players.filter(p=>p.outRound===r).map(p=>p.id); }
  // still in first, then whoever lasted longest
  ranking(){
    return [...this.players].sort((a,b)=>(b.alive-a.alive)||((b.outRound??1e9)-(a.outRound??1e9))||(b.correct-a.correct))
      .map(p=>({ id:p.id, name:p.name, alive:p.alive, rounds:p.alive?this.round:(p.outRound-1), correct:p.correct }));
  }
}
// solo bots: remember the right tile with a chance that falls as more pictures appear, then walk there
function makeBot(seed, skill){ return { r:rng(seed), skill, goal:null, wait:0 }; }
function botThink(g, p, bot, dt){
  if (!p.alive) return;
  if (g.phase!=="decide"){ bot.goal=null; return; }
  if (!bot.goal){
    const k=T.imagesFor(g.round), remember=bot.r()<Math.max(0.25,bot.skill-0.06*(k-2));
    const cells=[...g.tiles.keys()].filter(i=>remember?g.tiles[i]===g.target:true);
    cells.sort((a,b)=>Math.abs(a%T.N-p.x)+Math.abs((a/T.N|0)-p.y)-(Math.abs(b%T.N-p.x)+Math.abs((b/T.N|0)-p.y)));
    const pick=remember?cells[0]:cells[bot.r()*cells.length|0];
    bot.goal={ x:pick%T.N, y:(pick/T.N)|0 }; bot.wait=0.3+bot.r()*0.6;
  }
  bot.wait-=dt; if (bot.wait>0) return; bot.wait=0.18+bot.r()*0.15;
  const dx=Math.sign(bot.goal.x-p.x), dy=dx?0:Math.sign(bot.goal.y-p.y);
  if (dx||dy) g.move(p.id,dx,dy);
}
return { T, PICS, rng, Game, makeBot, botThink };
});
