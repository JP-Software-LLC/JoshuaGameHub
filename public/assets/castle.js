// Class castles: every saved Teacher Mode game adds bricks to the castle of the teacher who ran it.
// Castle.level(bricks) → level info · Castle.svg(bricks) → inline SVG · Castle.card({name,bricks,games,mine}) → HTML card.
// Each level adds one piece; the NEXT piece is drawn as a faint grey blueprint so kids can see what's coming.
(function(){
"use strict";
const NAMES=["","Campsite","Wooden Fort","Stone Wall","Watchtowers","Tower Roofs","The Keep","The Moat","Drawbridge","Twin Turrets","Golden Keep","Castle Town","Royal Castle"];
const start=n=>500*n*(n-1);                       // bricks needed to reach level n: 0, 1k, 3k, 6k, 10k, 15k …
function level(bricks){
  bricks=Math.max(0,Math.floor(+bricks||0));
  let n=1; while (bricks>=start(n+1)) n++;
  const a=start(n), b=start(n+1);
  return { level:n, name:n<NAMES.length?NAMES[n]:`Legendary Castle ★${n-NAMES.length+1}`, bricks, start:a, next:b, toNext:b-bricks, progress:(bricks-a)/(b-a),
    nextName:n+1<NAMES.length?NAMES[n+1]:"Legendary Castle" };
}

// ---- drawing (viewBox 320×200, ground at y≈156)
const C={ stone:"#a9b2c1", stone2:"#8b95a6", line:"#6d7789", dark:"#2c2430", wood:"#b07a43", wood2:"#8a5a2e", roof:"#4a78db", roof2:"#3359ad",
  gold:"#f5c542", gold2:"#d79b1f", flag:"#ff5d73", flag2:"#ffd23f", purple:"#7d55d9", water:"#45aef5", water2:"#2f8fd6" };
const merlons=(x0,x1,y,w=9,gap=6)=>{ let s=""; for (let x=x0;x+w<=x1+0.1;x+=w+gap) s+=`<rect x="${x}" y="${y}" width="${w}" height="9" fill="${C.stone}" stroke="${C.line}" stroke-width="1.2"/>`; return s; };
const bricksPat=(x0,x1,y0,y1)=>{ let s=""; for (let y=y0+9,r=0;y<y1;y+=9,r++){ s+=`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`; for (let x=x0+(r%2?8:16);x<x1;x+=18) s+=`<line x1="${x}" y1="${y}" x2="${x}" y2="${y+9>y1?y1:y+9}"/>`; }
  return `<g stroke="${C.line}" stroke-width=".8" opacity=".55">${s}</g>`; };
const flag=(x,y,c=C.flag,h=16)=>`<line x1="${x}" y1="${y}" x2="${x}" y2="${y-h}" stroke="#5b4a3a" stroke-width="2"/><path d="M${x},${y-h} l15,4.5 l-15,4.5Z" fill="${c}"/>`;
const cone=(cx,base,w,apex,c1,c2)=>`<path d="M${cx-w/2},${base} L${cx},${apex} L${cx+w/2},${base}Z" fill="${c1}"/><path d="M${cx},${apex} L${cx+w/2},${base} L${cx+w*0.12},${base}Z" fill="${c2}"/>`;
const tower=(x0,x1,top,roofed)=>`<rect x="${x0}" y="${top}" width="${x1-x0}" height="${156-top}" fill="${C.stone}" stroke="${C.line}" stroke-width="1.5"/>${bricksPat(x0,x1,top,156)}
  <rect x="${(x0+x1)/2-3}" y="${top+16}" width="6" height="14" rx="3" fill="${C.dark}"/>${roofed?"":merlons(x0,x1,top-9,8,6)}`;
const house=(x,c)=>`<rect x="${x}" y="137" width="24" height="18" fill="#f3e2bd" stroke="#b89a68" stroke-width="1"/><path d="M${x-3},138 L${x+12},124 L${x+27},138Z" fill="${c}"/><rect x="${x+9}" y="145" width="6" height="10" fill="${C.wood2}"/>`;
const tree=(x,s=1)=>`<rect x="${x-2}" y="${156-12*s}" width="4" height="${12*s}" fill="${C.wood2}"/><circle cx="${x}" cy="${156-17*s}" r="${9*s}" fill="#3f9d48"/><circle cx="${x-3}" cy="${156-20*s}" r="${4*s}" fill="#63bf5b"/>`;
const burst=(x,y,c)=>{ let s=""; for (let i=0;i<10;i++){ const a=i/10*Math.PI*2; s+=`<line x1="${x+Math.cos(a)*4}" y1="${y+Math.sin(a)*4}" x2="${(x+Math.cos(a)*11).toFixed(1)}" y2="${(y+Math.sin(a)*11).toFixed(1)}"/>`; }
  return `<g stroke="${c}" stroke-width="2" stroke-linecap="round">${s}</g><circle cx="${x}" cy="${y}" r="2" fill="#fff"/>`; };

// pieces in back-to-front order: [level it arrives at, draw(L)]
const PIECES=[
  [11,()=>house(12,"#d0643a")+house(42,"#4a78db")+house(256,"#7d55d9")+house(286,"#d0643a")+tree(8,.8)+tree(74,.7)+tree(246,.7)+tree(312,.8)],
  [6, L=>`<rect x="128" y="58" width="64" height="98" fill="${C.stone}" stroke="${C.line}" stroke-width="1.5"/>${bricksPat(128,192,58,156)}
        <path d="M151,98 v-14 a9,9 0 0 1 18,0 v14Z" fill="${C.dark}"/><rect x="136" y="70" width="5" height="10" rx="2.5" fill="${C.dark}"/><rect x="179" y="70" width="5" height="10" rx="2.5" fill="${C.dark}"/>
        ${L>=10?"":merlons(128,192,49,9,5.5)}`],
  [10,()=>cone(160,58,76,18,C.gold,C.gold2)+`<circle cx="160" cy="44" r="4" fill="#fff6d1" opacity=".8"/>`],
  [12,()=>`<line x1="160" y1="18" x2="160" y2="-2" stroke="#5b4a3a" stroke-width="2.5"/><path d="M160,-1 h26 l-6,7 l6,7 h-26Z" fill="${C.purple}"/>
        <path d="M167,8 l2,-4 l2,3 l2,-3 l2,3 l2,-3 l2,4 Z" fill="${C.gold}"/>`],
  [9, L=>tower(104,124,82,true)+tower(196,216,82,true)+cone(114,82,26,52,C.roof,C.roof2)+cone(206,82,26,52,C.roof,C.roof2)+flag(114,52,C.flag2,12)+flag(206,52,C.flag2,12)],
  [4, L=>tower(36,74,84,L>=5)+tower(246,284,84,L>=5)],
  [5, ()=>cone(55,84,46,40,C.roof,C.roof2)+cone(265,84,46,40,C.roof,C.roof2)+flag(55,40)+flag(265,40)],
  [1, L=>L>=3?"":`<path d="M136,156 L160,121 L184,156Z" fill="#ffb627" stroke="#c9771a" stroke-width="1.5"/><path d="M160,121 L153,156 L167,156Z" fill="#c9771a"/>${flag(160,121,C.flag,13)}`],
  [2, L=>{ if (L>=3) return ""; let s=""; for (let x=58;x<=254;x+=9){ if (x>146&&x<170) continue; s+=`<path d="M${x},156 V118 l4,-7 l4,7 V156Z" fill="${C.wood}" stroke="${C.wood2}" stroke-width="1.2"/>`; }
        return s+`<rect x="56" y="128" width="208" height="4" fill="${C.wood2}" opacity=".7"/>`; }],
  [3, ()=>`<path d="M60,156 V110 H260 V156 H176 V134 a16,16 0 0 0 -32,0 V156Z" fill="${C.stone}" stroke="${C.line}" stroke-width="1.5"/>${bricksPat(60,260,110,156)}
        ${merlons(60,260,101,10,6.4)}<path d="M144,156 V134 a16,16 0 0 1 32,0 V156Z" fill="${C.dark}"/>
        <g stroke="#5c5360" stroke-width="2">${[150,156,162,168,174].map(x=>`<line x1="${x}" y1="${x===150||x===174?128:121}" x2="${x}" y2="146"/>`).join("")}<line x1="145" y1="132" x2="175" y2="132"/><line x1="145" y1="141" x2="175" y2="141"/></g>`],
  [1, ()=>{ let s=""; for (let x=58;x<262;x+=17) s+=`<rect x="${x}" y="150" width="16" height="7" rx="2" fill="${C.stone2}" stroke="${C.line}" stroke-width="1"/>`; return s; }],
  [10,()=>[88,232].map(x=>`<path d="M${x},113 h14 v24 l-7,-5 l-7,5Z" fill="${C.purple}" stroke="#5a37ad" stroke-width="1"/><circle cx="${x+7}" cy="${123}" r="3" fill="${C.gold}"/>`).join("")],
  [7, ()=>`<path d="M14,166 Q160,150 306,166 L306,178 Q160,194 14,178Z" fill="${C.water}"/><path d="M14,166 Q160,150 306,166" stroke="${C.water2}" stroke-width="2" fill="none"/>
        <g stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"><path d="M44,172 q6,-3 12,0"/><path d="M98,170 q6,-3 12,0"/><path d="M214,170 q6,-3 12,0"/><path d="M268,172 q6,-3 12,0"/></g>`],
  [8, ()=>`<path d="M144,156 L176,156 L182,184 L138,184Z" fill="${C.wood}" stroke="${C.wood2}" stroke-width="1.5"/>
        <g stroke="${C.wood2}" stroke-width="1">${[162,168,174,180].map(y=>`<line x1="${144-(y-156)*0.21}" y1="${y}" x2="${176+(y-156)*0.21}" y2="${y}"/>`).join("")}</g>
        <g stroke="#4b4b55" stroke-width="1.6" stroke-dasharray="2 2"><line x1="146" y1="122" x2="139" y2="182"/><line x1="174" y1="122" x2="181" y2="182"/></g>`],
];
let uid=0;
function svg(bricks,opt={}){
  const L=level(bricks).level, id="cs"+(++uid);
  const fw=L>12?Math.min(8,L-12):0, spots=[[40,30,"#ff5d73"],[100,22,"#ffd23f"],[222,24,"#7ee0ff"],[290,40,"#b48cff"],[70,58,"#7ee0ff"],[250,62,"#ffd23f"],[20,70,"#b48cff"],[300,82,"#ff5d73"]];
  let body="";
  for (const [lv,draw] of PIECES){
    if (lv<=L) body+=draw(L);
    else if (lv===L+1 && opt.blueprint!==false) body+=`<g filter="url(#${id}g)" opacity=".26">${draw(L+1)}</g>`;
  }
  return `<svg class="castle-svg" viewBox="0 -6 320 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Castle, level ${L}">
  <defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L>12?"#3b3f8f":"#8fd3ff"}"/><stop offset="1" stop-color="${L>12?"#9b8fe0":"#e2f5ff"}"/></linearGradient>
    <filter id="${id}g"><feColorMatrix type="saturate" values="0"/></filter></defs>
  <rect x="0" y="-6" width="320" height="200" fill="url(#${id}s)"/>
  ${L>12?"":`<circle cx="284" cy="26" r="14" fill="#ffd65a"/>`}
  <g fill="#fff" opacity=".9"><ellipse cx="54" cy="30" rx="22" ry="8"/><ellipse cx="68" cy="24" rx="14" ry="9"/><ellipse cx="236" cy="50" rx="18" ry="6"/></g>
  ${spots.slice(0,fw).map(([x,y,c])=>burst(x,y,c)).join("")}
  <path d="M0,150 Q60,120 120,142 Q190,114 250,140 Q290,126 320,136 V194 H0Z" fill="#9fd57c"/>
  <rect x="0" y="154" width="320" height="40" fill="#6cbf4f"/><rect x="0" y="186" width="320" height="8" fill="#5aa841"/>
  ${body}</svg>`;
}

// ---- card (self-styled so it looks the same on the hub, the teacher page and admin)
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=n=>Math.round(n).toLocaleString();
function css(){
  if (document.getElementById("castle-css")) return;
  const s=document.createElement("style"); s.id="castle-css";
  s.textContent=`.castle-card{background:#141a26;border:1px solid #2b3550;border-radius:18px;overflow:hidden;color:#eef2fb;display:flex;flex-direction:column;min-width:0}
  .castle-card.mine{border-color:#f5c542;box-shadow:0 0 0 2px rgba(245,197,66,.25)}
  .castle-card .castle-svg{display:block;width:100%;height:auto;aspect-ratio:320/200;background:#8fd3ff}
  .castle-card .cc-b{padding:12px 14px 14px;display:flex;flex-direction:column;gap:6px}
  .castle-card .cc-n{font-weight:700;font-size:17px;line-height:1.2;overflow-wrap:anywhere}
  .castle-card .cc-l{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:#aab6cf;flex-wrap:wrap}
  .castle-card .cc-l b{color:#f5c542;font-weight:700}
  .castle-card .cc-bar{height:9px;border-radius:9px;background:#0b0f18;overflow:hidden}
  .castle-card .cc-bar i{display:block;height:100%;border-radius:9px;background:linear-gradient(90deg,#f5c542,#ffdf7e)}
  .castle-card .cc-next{font-size:12.5px;color:#8d9ab5}
  .castle-card .cc-rank{position:absolute;top:10px;left:10px;background:rgba(10,14,24,.78);color:#fff;border-radius:999px;padding:3px 10px;font-weight:700;font-size:13px}
  .castle-card .cc-pic{position:relative}
  .castle-card .cc-lv{position:absolute;top:8px;right:8px;min-width:58px;padding:5px 9px 7px;border-radius:12px 12px 22px 22px;text-align:center;
    background:linear-gradient(#ffe07a,#f0b62a);color:#3a2500;border:2px solid #b8800f;box-shadow:0 4px 0 rgba(0,0,0,.25);line-height:1}
  .castle-card .cc-lv small{display:block;font-size:10px;font-weight:800;letter-spacing:1.5px}
  .castle-card .cc-lv b{display:block;font-size:30px;font-weight:900;margin-top:2px}
  .castle-card .cc-ln{font-size:14px;color:#f5c542;font-weight:700}`;
  document.head.appendChild(s);
}
function card(o){
  css();
  const lv=level(o.bricks);
  return `<div class="castle-card${o.mine?" mine":""}"><div class="cc-pic">${svg(o.bricks)}${o.rank?`<span class="cc-rank">#${o.rank}</span>`:""}<span class="cc-lv" aria-label="Level ${lv.level}"><small>LEVEL</small><b>${lv.level}</b></span></div>
    <div class="cc-b"><div class="cc-n">${esc(o.name)}${o.name&&!o.noSuffix?"'s Castle":""}</div>
      <div class="cc-l"><span class="cc-ln">${esc(lv.name)}</span><span>🧱 ${fmt(lv.bricks)} bricks</span></div>
      <div class="cc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lv.progress*100)}"><i style="width:${(lv.progress*100).toFixed(1)}%"></i></div>
      <div class="cc-next">${fmt(lv.toNext)} more bricks to build: ${esc(lv.nextName)}${o.games!=null?` · ${o.games} game${o.games===1?"":"s"} played`:""}</div></div></div>`;
}
window.Castle={ level, svg, card, start };
})();
