// Rush Hour balance check: races bots of mixed skill on many seeds and reports
// median finish time and the gap from winner to last place (target: ~2 min, last ≤ ~25 s).
// Usage: node scripts/rush-balance.js [races] [racers]
"use strict";
const R=require("../shared/rush.js");
const races=+process.argv[2]||30, racers=+process.argv[3]||12;
const DT=1/60;

function race(seed, n, help=true){
  const track=R.makeTrack(seed);
  const cars=[], bots=[];
  for (let i=0;i<n;i++){ cars.push(R.newCar()); bots.push(R.makeBot(seed*31+i, n===1?0.5:0.08+0.9*i/(n-1))); }
  let t=0;
  while (cars.some(c=>!c.done) && t<400){
    const leader=help?Math.max(...cars.map(c=>c.d)):0;
    for (let i=0;i<n;i++){ const c=cars[i]; if (c.done) continue;
      R.step(c,track,DT,R.botInput(bots[i],c,track,DT),help?leader:c.d); }
    t+=DT;
  }
  return cars.map((c,i)=>({ skill:bots[i].skill, t:c.done?c.finishT:Infinity, rear:c.hits.rear, side:c.hits.side, boosts:c.boosts }));
}
const med=a=>{ const s=[...a].sort((x,y)=>x-y); return s[s.length>>1]; };
for (const help of [false,true]){
  const all=[], spreads=[], winners=[], lasts=[], rears=[];
  for (let s=1;s<=races;s++){
    const res=race(1000+s*7919, racers, help);
    const ts=res.map(r=>r.t); all.push(...ts); winners.push(Math.min(...ts)); lasts.push(Math.max(...ts));
    spreads.push(Math.max(...ts)-Math.min(...ts)); rears.push(...res.map(r=>r.rear));
  }
  console.log(`${help?"WITH catch-up   ":"WITHOUT catch-up"}  median finish ${med(all).toFixed(1)}s · winner ${med(winners).toFixed(1)}s · last ${med(lasts).toFixed(1)}s`
    +` · spread median ${med(spreads).toFixed(1)}s, worst ${Math.max(...spreads).toFixed(1)}s · rear-ends/racer ${(rears.reduce((a,b)=>a+b,0)/rears.length).toFixed(1)}`);
}
// fairness: two equally-skilled racers at the back finish close together
{
  const track=R.makeTrack(4242), cars=[R.newCar(),R.newCar(),R.newCar()], bots=[R.makeBot(1,0.95),R.makeBot(2,0.15),R.makeBot(3,0.15)];
  let t=0; while (cars.some(c=>!c.done)&&t<400){ const L=Math.max(...cars.map(c=>c.d)); cars.forEach((c,i)=>!c.done&&R.step(c,track,DT,R.botInput(bots[i],c,track,DT),L)); t+=DT; }
  console.log(`help curve: equal-gap racers get equal help → helpFor(100)=${R.helpFor(100).toFixed(3)}, helpFor(105)=${R.helpFor(105).toFixed(3)} (5 m apart)`);
  console.log(`sample: pro ${cars[0].finishT.toFixed(1)}s, two weak bots ${cars[1].finishT.toFixed(1)}s / ${cars[2].finishT.toFixed(1)}s`);
}
