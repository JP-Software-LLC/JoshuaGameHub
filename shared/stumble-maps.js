// Bumbling Stumbling Math: map registry (UMD: window.STUMBLE_MAPS in the browser, require on the server; served at /stumble-maps.js).
// A map is PURE DATA. The server only reads id, name, length. Everything else is built by the client
// (public/bumbling-stumbling-math/world.js has one builder per piece type) and read by the solo bots.
// CONTRACT (owned by the integrator; the map agent fills in `pieces`, `checkpoints`, `spawn`):
//   id, name, length (m, start line d=0 → finish line d=length)
//   veils:  [d, ...]  track-wide, full-height math curtains (8 on Map 1). Every route crosses each veil at that depth.
//   checkpoints: [{ d, veil?:index }]  respawn points in order (veils are checkpoints + quiet mid-room flags)
//   rooms:  [{ name, d0, d1 }]  for the teacher board / debugging
//   pieces: [{ type, ... }]  floors, blocks, rails, gaps, movers, pads, belts, doors, flags… (see world.js builders)
//
// Coordinates: d = metres forward (start line 0), x = sideways (0 = centre, |x| ≤ STUMBLE.T.halfWidth), y = height.
// Boxes are { d0, d1, x0, x1, top, h } (top = walkable height, h = thickness below it). A GAP is simply where no
// piece is. PIECE TYPES (shared/stumble.js compile() turns them into physics; world.js has one builder per type):
//   floor  { d0,d1,x0,x1, top=0, h=3, c:"main"|"alt" }      purple / lilac walkable slab
//   block  { d0,d1,x0,x1, top, h }                          cyan solid obstacle (too tall to hop: go round)
//   wall   { d0,d1,x0,x1, top, h }                          cyan hop wall (≤ 0.5 m above the floor)
//   rail   { d0,d1,x0,x1, top, h }                          pink+white side bumper
//   ramp   { d0,d1,x0,x1, top0, top1, h=1, c }              sloped slab (top0 at d0 → top1 at d1); c:"edge" = sloped rail
//   pad    { d0,d1,x0,x1, top, vy, vd, wait?:{m} }          yellow bounce pad: launch up (vy) + forward (vd) on touch.
//                                                           wait.m = index of the mover it throws you onto (lights up when it's there)
//   belt   { d0,d1,x0,x1, top=0, h=3, vx=0, vd=0 }          conveyor: moves you (m/s) while you stand on it
//   doors  { d, x0,x1, n, open:[i…], h=2.8, wallTop=4.2, post=0.5, thick=0.6, bounce=5 }
//                                                           a wall of n doors; open ones let you through, the rest are jelly
//   mover  { x, xB?, dA, dB, len, w, top, h=0.8, period, hold=0, phase=0 }  moving platform: pure function of race time
//   sign   { d, text }                                       room name board at the left edge
// checkpoints: { d, veil?:k, xs?:[x…], sw? }  xs = respawn spots (nearest to where you fell), sw = sideways spread (±m)
// rooms[i].bot = { safe:[[d,x,w]…], fast?:[[d,x,w]…], mirror? }  solo-bot lines (x to aim for, ±w freedom); fast = risky split
//   route (better bots pick it more often); mirror = each bot flips the line to the other side half the time
(function(root,f){ if (typeof module==="object"&&module.exports) module.exports=f(); else root.STUMBLE_MAPS=f(); })(this,function(){
  "use strict";

  // ---------------- Map 1: Jellybean Skyway ----------------
  const jellybean=(()=>{
    const P=[];
    const floor=(d0,d1,x0,x1,o={})=>P.push({ type:"floor", d0, d1, x0, x1, top:o.top??0, h:o.h??3, c:o.c||"main" });
    // side bumpers just OUTSIDE [x0,x1] (so the walkable width stays x0..x1)
    const rails=(d0,d1,x0,x1,top=0,side="both")=>{
      if (side!=="r") P.push({ type:"rail", d0, d1, x0:x0-0.6, x1:x0, top:top+0.7, h:1.2 });
      if (side!=="l") P.push({ type:"rail", d0, d1, x0:x1, x1:x1+0.6, top:top+0.7, h:1.2 });
    };
    const rampRails=(d0,d1,x0,x1,top0,top1)=>{ for (const [a,b] of [[x0-0.6,x0],[x1,x1+0.6]]) P.push({ type:"ramp", d0, d1, x0:a, x1:b, top0:top0+0.7, top1:top1+0.7, h:1.2, c:"edge" }); };
    const hop=(d,x0=-7,x1=7,top=0.45)=>P.push({ type:"wall", d0:d, d1:d+0.7, x0, x1, top, h:top+0.3 });
    const block=(d0,d1,x0,x1,top=1.3)=>P.push({ type:"block", d0, d1, x0, x1, top, h:top+0.3 });
    const W=7;

    // ===== Room 1 · Launch Pad (0–66): wide plaza, three rows of low hop walls (teach jump) =====
    P.push({ type:"sign", d:5, text:"1 · LAUNCH PAD" });
    floor(-12,80,-W,W); rails(-12,80,-W,W);
    hop(14,-W,W,0.35); hop(29); hop(45);

    // ===== Room 2 · Jellybean Gaps (66–132): four 2.5–3 m gaps, a candy floor under the first =====
    P.push({ type:"sign", d:73, text:"2 · JELLYBEAN GAPS" });
    floor(80,82.5,-W,W,{ top:-0.8, c:"alt" }); rails(80,82.5,-W,W,0);                  // gap 1: safety floor 0.8 m down
    floor(82.5,92,-W,W,{ c:"alt" }); rails(82.5,92,-W,W);
    // gap 2: 92 → 94.5
    floor(94.5,104,-5,5); rails(94.5,104,-5,5);
    // gap 3: 104 → 107
    floor(107,115,-W,W,{ c:"alt" }); rails(107,115,-W,W);
    // gap 4: 115 → 118
    floor(118,138,-W,W); rails(118,138,-W,W);

    // ===== Room 3 · Bounce House (132–198): pads up onto a deck (fast) or the side lanes round it (easy) =====
    P.push({ type:"sign", d:139, text:"3 · BOUNCE HOUSE" });
    floor(138,192,-10,10,{ c:"alt" }); rails(138,192,-10,10);
    P.push({ type:"pad", d0:146.5, d1:149.5, x0:-3.2, x1:3.2, top:0.15, vy:13.5, vd:8 });
    floor(152,176,-3.5,3.5,{ top:3, h:3 });                                              // the upper deck
    P.push({ type:"rail", d0:152, d1:176, x0:-3.5, x1:-2.9, top:3.7, h:0.7 }, { type:"rail", d0:152, d1:176, x0:2.9, x1:3.5, top:3.7, h:0.7 });
    P.push({ type:"ramp", d0:176, d1:184, x0:-3.5, x1:3.5, top0:3, top1:0, h:4, c:"main" });   // thick: a solid wedge (no overhang above the side lanes)
    // side lanes: weave round cyan blocks
    for (const s of [-1,1]){ block(156,158,s<0?-7:3.5,s<0?-3.5:7); block(166,168,s<0?-10:6.5,s<0?-6.5:10); }
    floor(192,210,-W,W); rails(192,210,-W,W);

    // ===== Room 4 · Cloud Ferry (198–264): platforms carry you over two big gaps (two lanes, out of step) =====
    P.push({ type:"sign", d:205, text:"4 · CLOUD FERRY" });
    for (const [x,ph] of [[-3.5,0],[3.5,0.5]]) P.push({ type:"mover", x, dA:212.5, dB:223.5, len:5, w:5, top:0, h:0.8, period:8, hold:0.34, phase:ph });
    floor(226,232,-W,W,{ c:"alt" }); rails(226,232,-W,W);
    for (const [x,ph] of [[-3.5,0.25],[3.5,0.75]]) P.push({ type:"mover", x, dA:234.5, dB:243.5, len:5, w:5, top:0, h:0.8, period:7.5, hold:0.34, phase:ph });
    floor(246,272,-W,W); rails(246,342,-W,W);

    // ===== Room 5 · Treadmill Trouble (264–330): belts push you back, then sideways, then hop walls on a belt =====
    P.push({ type:"sign", d:269, text:"5 · TREADMILL TROUBLE" });
    P.push({ type:"belt", d0:272, d1:286, x0:-W, x1:W, top:0, h:3, vd:-2.5 });
    floor(286,290,-W,W,{ c:"alt" });
    P.push({ type:"belt", d0:290, d1:304, x0:-W, x1:W, top:0, h:3, vx:2.6 });
    floor(304,308,-W,W,{ c:"alt" });
    P.push({ type:"belt", d0:308, d1:322, x0:-W, x1:W, top:0, h:3, vd:-2.5 });
    hop(312.5); hop(317.5);
    floor(322,402,-W,W);

    // ===== Room 6 · Jelly Doors (330–396): two walls of 5 doors; jelly ones bounce you back gently =====
    P.push({ type:"sign", d:337, text:"6 · JELLY DOORS" });
    rails(342,402,-W,W);
    P.push({ type:"doors", d:348, x0:-W, x1:W, n:5, open:[1,3,4], h:2.8, wallTop:4.2, post:0.5, thick:0.6, bounce:5 });
    P.push({ type:"doors", d:373, x0:-W, x1:W, n:5, open:[0,3], h:2.8, wallTop:4.2, post:0.5, thick:0.6, bounce:5 });

    // ===== Room 7 · Fork in the Road (396–462): left = slow belt (safe) · right = beam with a gap + a dive shortcut =====
    P.push({ type:"sign", d:403, text:"7 · FORK IN THE ROAD" });
    floor(402,406,-10,10,{ c:"alt" }); rails(402,406,-10,10);
    P.push({ type:"belt", d0:406, d1:446, x0:-10, x1:-2, top:0, h:3, vd:-2.2 });
    P.push({ type:"rail", d0:406, d1:446, x0:-10.6, x1:-10, top:0.7, h:1.2 });
    P.push({ type:"rail", d0:406, d1:426, x0:-2, x1:-1.4, top:0.7, h:1.2 }, { type:"rail", d0:430, d1:446, x0:-2, x1:-1.4, top:0.7, h:1.2 });
    floor(406,416,4,8,{ c:"alt" });                    // beam A
    // gap 416 → 419 (3 m)
    floor(419,430,4,8,{ c:"alt" });                    // beam B
    floor(426,430,-1.4,4);                             // bridge back to the belt (no dive? take this)
    // dive shortcut: 430 → 436 (6 m: jump + dive)
    floor(436,446,-1.4,10); P.push({ type:"rail", d0:436, d1:446, x0:10, x1:10.6, top:0.7, h:1.2 });
    floor(446,457,-10,10); rails(446,457,-10,10);

    // ===== Room 8 · Bounce & Ferry (462–528): pads throw you onto moving platforms =====
    P.push({ type:"sign", d:468, text:"8 · BOUNCE & FERRY" });
    floor(457,478,-W,W); rails(457,478,-W,W);
    P.push({ type:"pad", d0:475, d1:477, x0:-6, x1:-1, top:0.15, vy:11, vd:7.5, wait:{ m:4 } });
    P.push({ type:"pad", d0:475, d1:477, x0:1, x1:6, top:0.15, vy:11, vd:7.5, wait:{ m:5 } });
    for (const [x,ph] of [[-3.5,0],[3.5,0.5]]) P.push({ type:"mover", x, dA:481.5, dB:497, len:6, w:5, top:2, h:0.8, period:9, hold:0.36, phase:ph });
    floor(500,506,-W,W,{ top:2, h:4, c:"alt" }); rails(500,506,-W,W,2);
    P.push({ type:"ramp", d0:506, d1:514, x0:-W, x1:W, top0:2, top1:0, h:1.2, c:"alt" }); rampRails(506,514,-W,W,2,0);
    floor(514,541,-W,W); rails(514,541,-W,W);

    // ===== Room 9 · Super Bounce → Finish Parade (528–600): a chain of pads over the last gap, then downhill =====
    P.push({ type:"sign", d:533, text:"9 · SUPER BOUNCE" });
    P.push({ type:"pad", d0:539, d1:541, x0:-W, x1:W, top:0.15, vy:12, vd:9 });
    floor(546,553,-W,W,{ top:1, c:"alt" }); P.push({ type:"pad", d0:546, d1:553, x0:-W, x1:W, top:1.15, vy:12, vd:9 });
    floor(554.5,561.5,-W,W,{ top:2, c:"alt" }); P.push({ type:"pad", d0:554.5, d1:561.5, x0:-W, x1:W, top:2.15, vy:12, vd:9 });
    floor(562.5,572,-W,W,{ top:3, h:5 }); rails(562.5,572,-W,W,3);
    P.push({ type:"ramp", d0:572, d1:590, x0:-W, x1:W, top0:3, top1:0, h:1.2, c:"alt" }); rampRails(572,590,-W,W,3,0);
    floor(590,616,-W,W); rails(590,616,-W,W);

    const veils=[66,132,198,264,330,396,462,528];
    const checkpoints=[
      { d:0 },
      { d:32 },  { d:67.5, veil:0 },
      { d:99 },  { d:133.5, veil:1 },
      { d:162, xs:[-8.5,0,8.5], sw:1 },  { d:199.5, veil:2 },
      { d:229 }, { d:265.5, veil:3 },
      { d:288 }, { d:331.5, veil:4 },
      { d:361 }, { d:397.5, veil:5 },
      { d:423, xs:[-6,6], sw:1 }, { d:463.5, veil:6 },
      { d:503 }, { d:529.5, veil:7 },
      { d:566 },
    ];
    const L=(...pts)=>pts;
    const rooms=[
      { name:"Launch Pad", d0:0, d1:66, bot:{ safe:L([0,0,5],[66,0,5]) } },
      { name:"Jellybean Gaps", d0:66, d1:132, bot:{ safe:L([66,0,4],[92,0,4],[96,0,3],[104,0,3],[108,0,4],[132,0,4]) } },
      { name:"Bounce House", d0:132, d1:198,
        bot:{ mirror:true, safe:L([132,0,4],[140,7.5,1],[150,8.2,0.7],[154,8.5,0.6],[159,8.5,0.6],[163,5,0.6],[169,5,0.6],[172,8,1],[188,6,2],[198,0,4]),
              fast:L([132,0,3],[143,0,1.5],[176,0,1.2],[184,0,2],[198,0,4]) } },
      { name:"Cloud Ferry", d0:198, d1:264, bot:{ mirror:true, safe:L([198,0,4],[204,-3.5,0.7],[247,-3.5,0.7],[252,0,4],[264,0,4]) } },
      { name:"Treadmill Trouble", d0:264, d1:330, bot:{ safe:L([264,0,4],[330,0,4]) } },
      { name:"Jelly Doors", d0:330, d1:396, bot:{ safe:L([330,0,4],[396,0,4]) } },
      { name:"Fork in the Road", d0:396, d1:462,
        bot:{ safe:L([396,0,3],[403,-6,1.2],[446,-6,1.5],[452,0,4],[462,0,4]),
              fast:L([396,0,3],[403,6,0.6],[436,6,0.6],[442,4,2],[452,0,4],[462,0,4]) } },
      { name:"Bounce & Ferry", d0:462, d1:528, bot:{ mirror:true, safe:L([462,0,4],[468,0,4],[471,-3.5,0.6],[499,-3.5,0.6],[504,0,4],[528,0,4]) } },
      { name:"Super Bounce", d0:528, d1:600, bot:{ safe:L([528,0,3],[600,0,3]) } },
    ];
    return {
      id:"jellybean-skyway", name:"Jellybean Skyway", length:600,
      veils, rooms, checkpoints, pieces:P,
      spawn:{ d:1.5, cols:8, gap:1.6, rows:5 },
      theme:{
        main:["#8b5cf6","#a78bfa","#6d28d9"],      // [stripe A, stripe B, side]  purple floor
        alt:["#b69cff","#d6c8ff","#7c5ce0"],       // lilac floor
        block:["#22d3ee","#a5f3fc","#0891b2"],     // cyan solids
        wall:["#5eead4","#ccfbf1","#0d9488"],      // cyan hop walls (a touch greener so they read as "hop me")
        edge:["#ff5fb7","#ffffff","#ec4899"],      // hot pink + white: rails
        mover:["#ff4fa8","#ffffff","#c026d3"],     // hot pink + white: moves
        belt:["#ff4fa8","#ffffff","#be185d"],      // hot pink + white chevrons: pushes
        pad:["#ffd23f","#fff6c2","#d69e00"],       // yellow: bouncy
        jelly:"#ffd84d", veil:"#4aa8ff", goo:["#1e2a8a","#0b1250"],
        fog:"#c9b8ff", sky:["#3b2bd6","#8f7dff","#ffb3e6"],
      },
    };
  })();

  const MAPS={ "jellybean-skyway":jellybean };
  const DEFAULT="jellybean-skyway";
  const get=id=>MAPS[id]||MAPS[DEFAULT];
  return { MAPS, DEFAULT, get };
});
