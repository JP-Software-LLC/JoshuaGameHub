// Clean Getaway — pixel art + board renderer, shared by the game page and the hub's live demo.
// Original 16×16 sprites drawn from palette strings. Exposes window.CGArt.
(function (root) {
"use strict";
const COLORS = ["#f2c94c","#5aa9e6","#e2554b","#58c27d","#c084fc"];
const PAL = { k:"#16161d", s:"#e8b98f", S:"#c08a64", b:"#2b2b36", w:"#e9e6dc", g:"#58c27d", G:"#2f7d4a",
  y:"#f2c94c", Y:"#b8862b", u:"#3b62b8", U:"#263f7a", n:"#1b2540", r:"#d9534f", R:"#8e2b2b", l:"#9aa3ad", L:"#5d6670", c:"#7fd3ff" };
const ART = {
  thief0:["................",".....kkkkkk.....","....kbbbbbbk....","...kbbbbbbbbk...","...kkkkkkkkkk...","...kbwkbbkwbk...",
          "...kssssssssk...","....kssSSssk....","...kkbwbwbwbkk..","..kbkwbwbwbwkgk.","..kskbwbwbwbkggk","...kkbbbbbbkkGgk",
          "....kbbkkbbk.kk.","....kbbk.kbbk...","....kkk...kkk...","................"],
  thief1:["................",".....kkkkkk.....","....kbbbbbbk....","...kbbbbbbbbk...","...kkkkkkkkkk...","...kbwkbbkwbk...",
          "...kssssssssk...","....kssSSssk....","...kkbwbwbwbkk..","..kbkwbwbwbwkgk.","..kskbwbwbwbkggk","...kkbbbbbbkkGgk",
          "....kbbkkbbk.kk.","...kbbk...kbbk..","...kkk.....kkk..","................"],
  guard0:["................","....kkkkkkkk....","...knnnnnnnnk...","...knnnyynnnk...","..kkkkkkkkkkkk..","...kssssssssk...",
          "...kskssskssk...","...kssssssssk...","....kkSSSSkk....","..kkuuuuuuuukk..",".kuukuuyuuukuuk.",".kskuuuuuuuuksk.",
          "..kkUUUUUUUUkk..","...kUUUkkUUUk...","...kkkk..kkkk...","................"],
  guard1:["................","....kkkkkkkk....","...knnnnnnnnk...","...knnnyynnnk...","..kkkkkkkkkkkk..","...kssssssssk...",
          "...kskssskssk...","...kssssssssk...","....kkSSSSkk....","..kkuuuuuuuukk..",".kuukuuyuuukuuk.",".kskuuuuuuuuksk.",
          "..kkUUUUUUUUkk..","..kUUUk..kUUUk..","..kkkk....kkkk..","................"],
  cash:  ["................","................","................","................","................","....kkkkkkkk....",
          "...kggggggggk...","...kgGGyyGGgk...","...kggggggggk...","...kkkkkkkkkk...","...kggggggggk...","...kkkkkkkkkk...",
          "................","................","................","................"],
  gold:  ["................","................","................","................","................","................",
          "......kkkk......",".....kcccck.....","....kccwcccck...","...kccccccccck..","...kLLLLLLLLLk..","...kkkkkkkkkkk..",
          "................","................","................","................"],
  heart: ["........",".kk..kk.","krrkkrrk","krwrrrrk","krrrrrrk",".krrrrk.","..krrk..","...kk..."],
  heartE:["........",".kk..kk.","kLLkkLLk","kLLLLLLk","kLLLLLLk",".kLLLLk.","..kLLk..","...kk..."],
};
const DAZE = { u:"#8fa0c4", U:"#5d6a8a", n:"#3a4560" };
function makeSprite(rows, over){
  const c=document.createElement("canvas"); c.width=rows[0].length; c.height=rows.length;
  const x=c.getContext("2d");
  rows.forEach((r,y)=>[...r].forEach((ch,i)=>{ if(ch!=="."){ x.fillStyle=(over&&over[ch])||PAL[ch]; x.fillRect(i,y,1,1);} }));
  return c;
}
const SPR = {};
for (const k in ART) SPR[k]=makeSprite(ART[k]);
SPR.guardD0=makeSprite(ART.guard0,DAZE); SPR.guardD1=makeSprite(ART.guard1,DAZE);

// Board: connected counters/desks with a lighter top, checker floor, wall shadows, cash, bobbing gold.
function drawFloor(ctx, grid, theme, T, t){
  const H=grid.length, W=grid[0].length, q=Math.max(1,T>>3);
  const isWall=(x,y)=>y<0||y>=H||x<0||x>=W||grid[y][x]==="#";
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const c=grid[y][x], px=x*T, py=y*T;
    if (c==="#"){
      ctx.fillStyle=theme.wall; ctx.fillRect(px,py,T,T);
      const l=isWall(x-1,y)?0:q, r=isWall(x+1,y)?0:q, u=isWall(x,y-1)?0:q, d=isWall(x,y+1)?0:q*2;
      ctx.fillStyle=theme.top; ctx.fillRect(px+l,py+u,T-l-r,T-u-d);
      if (u){ ctx.fillStyle=theme.hi; ctx.fillRect(px+l,py+u,T-l-r,q); }
    } else {
      ctx.fillStyle=((x+y)&1)?theme.f1:theme.f2; ctx.fillRect(px,py,T,T);
      ctx.fillStyle=theme.line; ctx.fillRect(px,py,T,1); ctx.fillRect(px,py,1,T);
      if (isWall(x,y-1)){ ctx.fillStyle="rgba(0,0,0,.22)"; ctx.fillRect(px,py,T,q*2); }
      if (c==="G"){ ctx.fillStyle="#3b62b8"; ctx.fillRect(px,py+T*0.4,T,q*2); ctx.fillStyle="#f2c94c"; ctx.fillRect(px+T/2-q,py+T*0.4,q*2,q*2); }
      if (c===".") ctx.drawImage(SPR.cash,px,py,T,T);
      if (c==="o"){ const bob=Math.round(Math.sin(t*5)*q); ctx.drawImage(SPR.gold,px,py+bob,T,T); }
    }
  }
}
// One actor; also draws the wrapped copy while crossing a side tunnel.
function drawActor(ctx, a, T, t, power, isLocal, W){
  if (a.out>0) return;
  const one=(px,py)=>{
    const f=(a.moving && Math.floor(t*8)%2)?1:0;
    ctx.fillStyle=COLORS[a.slot]+"aa"; ctx.beginPath(); ctx.ellipse(px+T/2,py+T*0.9,T*0.36,T*0.13,0,0,7); ctx.fill();
    let s;
    if (a.role==="thief") s=SPR["thief"+f];
    else { const dz=power>0 && !(power<1.5 && Math.floor(t*8)%2); s=SPR[(dz?"guardD":"guard")+f]; }
    ctx.save();
    if (a.face<0){ ctx.translate(px+T,py); ctx.scale(-1,1); ctx.drawImage(s,0,0,T,T); } else ctx.drawImage(s,px,py,T,T);
    ctx.restore();
    if (isLocal){
      ctx.fillStyle="#fff"; const cx=px+T/2, ty=py-T*0.15;
      ctx.beginPath(); ctx.moveTo(cx-T*0.15,ty-T*0.18); ctx.lineTo(cx+T*0.15,ty-T*0.18); ctx.lineTo(cx,ty); ctx.fill();
    }
  };
  const px=a.x*T, py=a.y*T;
  one(px,py);
  if (a.x<0) one(px+W*T,py); else if (a.x>W-1) one(px-W*T,py);
}
root.CGArt = { COLORS, PAL, ART, SPR, makeSprite, drawFloor, drawActor };
})(typeof self!=="undefined"?self:this);
