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
//   deck   { d, x=0, r, top=0, h=3, c }                       ROUND floor (centre d,x; radius r)
//   HAZARDS (hot pink + white = it moves / pushes; motion is a pure function of race time; shared/stumble.js hazardShape):
//   sweeper  { d, x=0, top=0, len, y=0.55, thick=0.3, speed rad/s, phase rad, arms=1, hub=0.8, hubH=1.6 }  low spinning arm(s)
//   pendulum { d, x=0, py, rope, amp rad, period s, phase 0..1, r }      wrecking ball swinging across the path
//   gate     { d, top=0, w, h=1.9, thick=0.8, xA, xB, period, hold=0.2, phase=0, gap=0 }   sliding box (gap>0 = wall with an opening)
//   MAP 2 pieces (full field docs in shared/stumble.js, "MOVING FOOTING"; the race SEED picks fake tiles, gumball times and
//   the lucky doors, so every screen agrees with no server):
//   disc { d,x,r,top,speed } turning platform that carries you · seesaw { d0,d1,x,w,top,amp,period,hold,phase } rocking plank
//   tiles { d0,x0,rows,cols,tw,td,gap,fake } Tip-Toe · traps { d0,x0,rows,cols,tw,td,period,up,blink,gone,rise,wave,checker }
//   bumper { d,x,r,top,h,kick } pinball post · luckydoors { d,x0,x1,n,lane,… } "?" doors: chute / jelly / normal
//   piston { d,side,edge,reach,period,phase } (hazard) · gumball { d0,d1,top0,top1,lanes,r,speed,every } (hazard)
// checkpoints: { d, veil?:k, xs?:[x…], sw? }  xs = respawn spots (nearest to where you fell), sw = sideways spread (±m)
// rooms[i].bot = { safe:[[d,x,w]…], fast?:[[d,x,w]…], mirror? }  solo-bot lines (x to aim for, ±w freedom); fast = risky split
//   route (better bots pick it more often); mirror = each bot flips the line to the other side half the time
//   tiles/traps rooms: the fast route = across the field (bots plan tiles/trapdoors themselves), safe = the slow belt lane.
//   low?:[[d,x,w]…] + lowY: the line to follow while below lowY (the lucky chute) · nojump?:[[d0,d1]] never jump holes here
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

  // ---------------- Test room: Hazard Lab (open edges; feel + tune knock-back. Open with ?play=bots&map=hazard-lab) ----------------
  const hazardLab=(()=>{
    const P=[];
    const floor=(d0,d1,x0,x1,o={})=>P.push({ type:"floor", d0, d1, x0, x1, top:o.top??0, h:o.h??3, c:o.c||"main" });
    const rails=(d0,d1,x0,x1,top=0)=>{ P.push({ type:"rail", d0, d1, x0:x0-0.6, x1:x0, top:top+0.7, h:1.2 }, { type:"rail", d0, d1, x0:x1, x1:x1+0.6, top:top+0.7, h:1.2 }); };
    // start pad (railed) → narrow bridge onto the first deck
    floor(-8,10,-5,5); rails(-8,10,-5,5);
    P.push({ type:"sign", d:4, text:"1 · SPIN START" });
    floor(10,16,-2.2,2.2,{ c:"alt" });
    // 1 · sweeper deck: one slow arm, open edges (a hit near the rim throws you off; in the middle it doesn't)
    P.push({ type:"deck", d:25, r:9, c:"main" });
    P.push({ type:"sweeper", d:25, len:8.2, speed:0.75, phase:Math.PI/2, arms:1 });
    floor(33,39,-3,3,{ c:"alt" });
    // 2 · pendulum bridge: 3 wrecking balls over a 7 m bridge, no rails, out of step so there's always a gap
    P.push({ type:"sign", d:36.5, text:"2 · PENDULUM BRIDGE" });
    floor(39,63,-3.5,3.5);                                              // 7 m wide: a centre hit is a scare, an edge hit is a fall (3rd-grade tuning)
    P.push({ type:"pendulum", d:45, py:8.2, rope:7, amp:0.72, period:3.4, phase:0, r:1 });
    P.push({ type:"pendulum", d:51.5, py:8.2, rope:7, amp:0.72, period:3.8, phase:0.33, r:1 });
    P.push({ type:"pendulum", d:58, py:8.2, rope:7, amp:0.72, period:3.6, phase:0.66, r:1 });
    // 3 · gate crash: three rows of sliding gates on a wide open slab
    floor(63,71,-4.5,4.5,{ c:"alt" });
    P.push({ type:"sign", d:66, text:"3 · GATE CRASH" });
    floor(71,97,-5,5);
    P.push({ type:"gate", d:76, w:3, xA:-3.5, xB:-0.6, period:4, phase:0 });        // two gates, out of step
    P.push({ type:"gate", d:76, w:3, xA:0.6, xB:3.5, period:4, phase:0 });
    P.push({ type:"gate", d:84, w:16, gap:3, xA:-3, xB:3, period:5, phase:0.25 });  // a wall with a sliding doorway
    P.push({ type:"gate", d:92, w:5, xA:-2.5, xB:2.5, period:4.4, phase:0.6 });     // one big gate: go round it
    floor(97,102,-2.5,2.5,{ c:"alt" });
    // 4 · double sweeper: two opposite arms (a full bar), turning the other way
    P.push({ type:"sign", d:95.5, text:"4 · DOUBLE SPIN" });
    P.push({ type:"deck", d:111, r:10, c:"main" });
    P.push({ type:"sweeper", d:111, len:9.2, speed:-0.7, phase:0, arms:2 });
    floor(120.5,126,-2.5,2.5,{ c:"alt" });
    // calm veil pad (railed, no hazard within 6 m) → finish
    floor(126,152,-5,5); rails(126,152,-5,5);
    const veils=[133];
    const checkpoints=[ { d:0, sw:1.6 }, { d:36, sw:1 }, { d:67, sw:1.4 }, { d:99.5, sw:0.8 }, { d:134.5, veil:0, sw:1.6 } ];
    const L=(...pts)=>pts;
    const rooms=[
      { name:"Spin Start", d0:0, d1:36, bot:{ mirror:true, safe:L([0,0,1.5],[10,0,1],[17,-2.5,0.6],[33,-2.5,0.6],[36,0,1]) } },
      { name:"Pendulum Bridge", d0:36, d1:66, bot:{ safe:L([36,0,1],[66,0,0.8]) } },
      { name:"Gate Crash", d0:66, d1:99, bot:{ safe:L([66,0,2],[99,0,1]) } },
      { name:"Double Spin", d0:99, d1:126, bot:{ mirror:true, safe:L([99,0,1],[104,-3,0.6],[118,-3,0.6],[122,0,1]) } },
      { name:"Finish", d0:126, d1:140, bot:{ safe:L([126,0,2],[140,0,2]) } },
    ];
    return {
      id:"hazard-lab", name:"Hazard Lab", length:140, test:true,
      veils, rooms, checkpoints, pieces:P,
      spawn:{ d:1.5, cols:6, gap:1.5, rows:5 },
      theme:jellybean.theme,
    };
  })();

  // ---------------- Map 2: Gumdrop Gauntlet (docs/stumble-map2-plan.md) ----------------
  // 9 rooms, a moving hazard in every room, open edges (rails only on the veil landings), two gambles (Tip-Toe Tiles,
  // Lucky Doors) each with a slower safe lane beside it. Every veil sits on a calm railed pad with nothing moving within
  // 6 m; every room has a quiet mid-room flag, so a fall costs ~5 s. Floors change colour room by room (theme keys).
  const gumdrop=(()=>{
    const P=[];
    const floor=(d0,d1,x0,x1,o={})=>P.push({ type:"floor", d0, d1, x0, x1, top:o.top??0, h:o.h??3, c:o.c||"main" });
    const rails=(d0,d1,x0,x1,top=0)=>{ P.push({ type:"rail", d0, d1, x0:x0-0.6, x1:x0, top:top+0.7, h:1.2 }, { type:"rail", d0, d1, x0:x1, x1:x1+0.6, top:top+0.7, h:1.2 }); };
    const ramp=(d0,d1,x0,x1,top0,top1,c="main",h=1.2)=>P.push({ type:"ramp", d0, d1, x0, x1, top0, top1, h, c });
    const hop=(d,x0,x1,base=0)=>P.push({ type:"wall", d0:d, d1:d+0.7, x0, x1, top:base+0.45, h:0.75 });
    const block=(d0,d1,x0,x1,top,h)=>P.push({ type:"block", d0, d1, x0, x1, top, h:h??top+0.3 });
    const sign=(d,text)=>P.push({ type:"sign", d, text });
    const landing=(d0,d1,c="lilac",w=6)=>{ floor(d0,d1,-w,w,{ c }); rails(d0+2,d1-2,-w,w); };   // calm, railed veil pad

    // ===== 1 · Spin Start (0–64): a slow sweeper arm on a wide round deck, open edges; then up and over an island =====
    sign(5,"1 · SPIN START");
    floor(-12,10,-7,7,{ c:"main" }); rails(-12,8,-7,7);
    floor(9.5,15.8,-2.5,2.5,{ c:"lilac" });
    P.push({ type:"deck", d:25, r:9.5, c:"azure" });
    P.push({ type:"sweeper", d:25, len:8.8, speed:0.75, phase:Math.PI/2, arms:1 });
    floor(34.2,40,-2.5,2.5,{ c:"lilac" });
    floor(40,44,-6,6,{ c:"main" }); ramp(44,48,-6,6,0,1.6,"main"); floor(48,52,-6,6,{ top:1.6, h:4.6, c:"berry" }); hop(49.6,-6,6,1.6);
    ramp(52,56,-6,6,1.6,0,"main");
    landing(56,72);

    // ===== 2 · Tip-Toe Tiles (64–128): two fields of tiles, ~45 % fake (from the seed). Safe lane: a slow belt on the left =====
    sign(66.5,"2 · TIP-TOE TILES");
    floor(70,73,-9.2,6,{ c:"lilac" });
    P.push({ type:"tiles", d0:73, x0:-5.6, rows:6, cols:4, tw:2.6, td:2.4, gap:0.3, fake:0.45 });
    P.push({ type:"belt", d0:73, d1:88.9, x0:-9.2, x1:-7.4, top:0, h:3, vd:-1.6 });
    floor(88.9,94,-9.2,6,{ c:"berry" });
    P.push({ type:"tiles", d0:94, x0:-5.6, rows:6, cols:4, tw:2.6, td:2.4, gap:0.3, fake:0.45 });
    P.push({ type:"belt", d0:94, d1:109.9, x0:-9.2, x1:-7.4, top:0, h:3, vd:-1.6 });
    floor(109.9,113,-9.2,6,{ c:"berry" }); ramp(113,117,-6,6,0,1.2,"main"); floor(117,119,-6,6,{ top:1.2, h:4.2, c:"main" }); ramp(119,122,-6,6,1.2,0,"main");
    landing(122,138,"azure");

    // ===== 3 · Pendulum Alley (128–194): four wrecking balls over a 5 m bridge, no rails, out of step =====
    sign(131,"3 · PENDULUM ALLEY");
    floor(136,170,-3.25,3.25,{ c:"ocean" });                               // 6.5 m: a centre hit is a scare, an edge hit is a fall
    for (const [d,per,ph] of [[142,3.4,0],[148.5,3.8,0.33],[159,3.6,0.66],[165.5,3.3,0.15]])
      P.push({ type:"pendulum", d, py:8.2, rope:7, amp:0.72, period:per, phase:ph, r:1 });
    floor(170,178,-5,5,{ top:-1, h:2, c:"main" }); hop(173.5,-5,5,-1);
    ramp(178,184,-5,5,-1,0,"main");
    landing(184,202);

    // ===== 4 · Gate Crash (194–260): sliding pink gates on three islands, stepping up, with gaps to jump =====
    sign(197,"4 · GATE CRASH");
    floor(202,212,-5,5,{ c:"azure" });
    P.push({ type:"gate", d:207, w:3, xA:-3.5, xB:-0.6, period:4, phase:0 }, { type:"gate", d:207, w:3, xA:0.6, xB:3.5, period:4, phase:0 });
    floor(214.5,224,-5,5,{ top:0.6, h:3.6, c:"berry" });
    P.push({ type:"gate", d:220, top:0.6, w:12, gap:3, xA:-2.5, xB:2.5, period:5, phase:0.25 });
    floor(226.5,236,-5,5,{ top:1.2, h:4.2, c:"azure" });
    P.push({ type:"gate", d:231.5, top:1.2, w:5, xA:-2.5, xB:2.5, period:4.4, phase:0.6 });
    ramp(238,244,-5,5,1.2,0,"main"); floor(244,252,-6,6,{ c:"main" }); hop(247.5,-6,6);
    landing(252,268);

    // ===== 5 · Spin Cycle (260–326): three turning discs that carry you; a sweeper on the big one =====
    sign(263,"5 · SPIN CYCLE");
    floor(267,271.2,-2.5,2.5,{ c:"lilac" });
    P.push({ type:"disc", d:276, r:5, speed:0.55, c:"ocean" });
    floor(282.6,286.4,-3,3,{ c:"lilac" });
    P.push({ type:"disc", d:295, r:7, top:0.6, h:1.8, speed:-0.4, c:"ocean" });
    P.push({ type:"sweeper", d:295, top:0.6, len:6.3, speed:0.9, phase:0, arms:1, hub:0.8 });
    P.push({ type:"disc", d:308.6, r:5, speed:0.6, c:"ocean" });
    floor(315.2,320,-4,4,{ c:"main" });
    landing(318,334);

    // ===== 6 · Seesaw Sea (326–392): four planks rocking side to side on timers, each its own rhythm =====
    sign(329,"6 · SEESAW SEA");
    floor(333,337.4,-3,3,{ c:"main" });
    P.push({ type:"seesaw", d0:338, d1:345, w:4.4, amp:0.25, period:5, hold:0.2, phase:0 });
    P.push({ type:"seesaw", d0:346.2, d1:353.2, w:4.4, amp:0.27, period:4.4, hold:0.2, phase:0.35 });
    floor(354.4,358,-3,3,{ c:"lilac" });
    P.push({ type:"seesaw", d0:359.2, d1:366.2, w:4.4, amp:0.29, period:5.6, hold:0.2, phase:0.6 });
    P.push({ type:"seesaw", d0:367.4, d1:374.4, w:4.4, amp:0.29, period:4.6, hold:0.2, phase:0.15 });
    floor(375.6,384,-5,5,{ c:"ocean" }); hop(379.5,-5,5);
    landing(384,400);

    // ===== 7 · Gumball Hill (392–458): uphill, gumballs roll down three lanes (times from the seed), pinball bumpers =====
    sign(395,"7 · GUMBALL HILL");
    floor(400,403,-6.5,6.5,{ c:"grape" });
    ramp(403,433,-6.5,6.5,0,4.5,"grape");
    P.push({ type:"gumball", d0:403, d1:433, top0:0, top1:4.5, lanes:[-4.2,0,4.2], r:0.9, speed:4, every:[1.7,2.9] });
    const hill=d=>(d-403)/30*4.5;
    for (const [d,x] of [[409,-5.8],[414,5.8],[419,-5.8],[424,5.8],[429,-5.8],[416.5,-2.1],[426.5,2.1]]) P.push({ type:"bumper", d, x, r:0.7, top:hill(d), h:1.4, kick:8 });
    floor(433,439,-6.5,6.5,{ top:4.5, h:6, c:"grape" });
    ramp(439,449,-5,5,4.5,0.8,"main"); floor(449,452,-5,5,{ top:0.8, h:3.8, c:"main" });
    landing(452,466.5); floor(464,466.5,-7.4,7.4,{ c:"lilac" });

    // ===== 8 · Lucky Doors & Trapdoors (458–524): blinking trapdoors, then 4 "?" doors =====
    //  doors (seed): 1 = shortcut chute (drop to the low belt → pad back up), 2 = normal (walk round the sides), 1 = jelly
    sign(461,"8 · LUCKY DOORS");
    P.push({ type:"traps", d0:466.5, x0:-5.1, rows:5, cols:3, tw:3.3, td:3.4, gap:0.2, period:6, up:4, blink:0.7, gone:0.9, rise:0.4, wave:-0.1, checker:true });
    // wave −0.1: each row runs 0.6 s AHEAD of the one behind it, so if you set off as a panel comes back and keep running
    // you surf the wave; checker = the next column is half a cycle out, so there's always a panel up beside you
    for (const s of [-1,1]) P.push({ type:"belt", d0:466.5, d1:484.3, x0:s<0?-7.4:5.7, x1:s<0?-5.7:7.4, top:0, h:3, vd:-2.6 });   // safe (slow) lanes
    floor(484.3,490,-7.4,7.4,{ c:"berry" });
    floor(490,497.8,-8,8,{ c:"main" });
    P.push({ type:"luckydoors", d:498, x0:-8, x1:8, n:4, h:2.8, wallTop:4.2, post:0.5, thick:0.6, lane:6, laneH:0.5, roof:false, bounce:5 });   // no roof: the 4.2 m wall already hides the corridors from the chase camera
    floor(504.3,507.5,-11,11,{ h:0.5, c:"main" });
    block(507.5,508.1,-8,8,1.6,2.1);                                              // fence: the low lane is only for the chute
    for (const s of [-1,1]){ floor(507.5,516,s<0?-11:8,s<0?-8:11,{ h:0.5, c:"lilac" }); block(508.1,516,s<0?-8.5:8,s<0?-8:8.5,1.6,2.1); hop(511,s<0?-11:8.5,s<0?-8.5:11); }
    P.push({ type:"belt", d0:498, d1:510, x0:-8, x1:8, top:-3, h:1, vd:4.5 });  // the chute's low belt …
    P.push({ type:"pad", d0:510, d1:512.5, x0:-8, x1:8, top:-2.85, h:0.3, vy:14, vd:7 });   // … and the pad back up
    floor(516,520,-11,11,{ c:"main" });
    landing(518,532,"azure",7);

    // ===== 9 · Hammer Finale (524–600): pistons punch from both edges, then a big double sweeper before the arch =====
    sign(527,"9 · HAMMER FINALE");
    floor(531,535,-3,3,{ c:"lilac" });
    floor(535,560,-6,6,{ c:"ocean" });
    for (const [d,side,per,ph] of [[539.5,-1,3.4,0],[544.5,1,3.4,0.5],[549.5,-1,3,0.25],[554.5,1,3,0.75]]){
      P.push({ type:"piston", d, side, edge:6, reach:5.5, thick:2, h:1.8, period:per, phase:ph });
      block(d-1.35,d+1.35,side<0?-13.1:7.4,side<0?-7.4:13.1,2.2,4.2); }               // the housing it punches out of (pulls back into it)
    floor(560,566.6,-3,3,{ c:"lilac" });
    P.push({ type:"deck", d:576, r:9.5, c:"berry" });
    P.push({ type:"sweeper", d:576, len:8.8, speed:-0.7, phase:0, arms:2 });
    floor(585.4,590,-4,4,{ c:"main" });
    P.push({ type:"pad", d0:588,d1:590, x0:-4, x1:4, top:0.15, h:0.3, vy:10, vd:10 });   // one big bounce to the finish
    floor(594,616,-7,7,{ c:"main" }); rails(598,616,-7,7);

    const veils=[64,128,194,260,326,392,458,524];
    const checkpoints=[
      { d:0, sw:1.6 },
      { d:37, sw:0.8 },  { d:65.5, veil:0 },
      { d:91.5, xs:[0,-8.3], sw:0.7 },  { d:129.5, veil:1 },
      { d:153.75, sw:1.2 }, { d:195.5, veil:2 },
      { d:216.5, sw:1.4 }, { d:261.5, veil:3 },
      { d:284.5, sw:0.8 }, { d:327.5, veil:4 },
      { d:356.2, sw:0.8 }, { d:393.5, veil:5 },
      { d:435.5, sw:1.6 }, { d:459.5, veil:6 },
      { d:487, sw:1.6 },  { d:525.5, veil:7 },
      { d:562.5, sw:0.8 },
    ];
    const L=(...pts)=>pts;
    const rooms=[
      { name:"Spin Start", d0:0, d1:64, bot:{ mirror:true, safe:L([0,0,1.5],[9,0,1],[16.5,-2.6,0.6],[33.5,-2.6,0.6],[36,0,1],[64,0,2]) } },
      { name:"Tip-Toe Tiles", d0:64, d1:128, bot:{ tiles:true,
          safe:L([64,0,2],[70.6,-6,0.3],[72.5,-8.3,0.3],[110,-8.3,0.3],[113,0,2],[128,0,2]), fast:L([64,0,2],[72,0,1],[110,0,1],[128,0,2]) } },
      { name:"Pendulum Alley", d0:128, d1:194, bot:{ safe:L([128,0,1.5],[136,0,0.8],[170,0,0.8],[194,0,2]) } },
      { name:"Gate Crash", d0:194, d1:260, bot:{ safe:L([194,0,2],[260,0,1.5]) } },
      { name:"Spin Cycle", d0:260, d1:326, bot:{ mirror:true, safe:L([260,0,1.5],[268,0,0.8],[286,0,1],[289,-2.6,0.7],[301,-2.6,0.7],[303.6,0,1],[326,0,2]) } },
      { name:"Seesaw Sea", d0:326, d1:392, bot:{ safe:L([326,0,1.5],[334,0,0.3],[375,0,0.3],[392,0,2]) } },
      { name:"Gumball Hill", d0:392, d1:458, bot:{ safe:L([392,0,2],[458,0,2]) } },
      { name:"Lucky Doors", d0:458, d1:524, bot:{ mirror:true, nojump:[[496,505]], lowY:-1.5, low:L([498,0,1],[524,0,2]),
          safe:L([458,0,2],[464.5,-5,0.3],[466.5,-6.55,0.2],[484,-6.55,0.2],[489,0,3],[504.3,9.75,0.2],[515,9.75,0.2],[518,0,3],[524,0,2]),
          fast:L([458,0,2],[466,0,1],[485,0,1],[489,0,3],[504.3,9.75,0.2],[515,9.75,0.2],[518,0,3],[524,0,2]) } },
      { name:"Hammer Finale", d0:524, d1:600, bot:{ mirror:true, safe:L([524,0,2],[532,0,1],[535,0,2],[560,0,1],[566,0,1],[568,-2.8,0.6],[584,-2.8,0.6],[588,0,2],[600,0,2]) } },
    ];
    return {
      id:"gumdrop-gauntlet", name:"Gumdrop Gauntlet", length:600,
      veils, rooms, checkpoints, pieces:P,
      spawn:{ d:1.5, cols:8, gap:1.6, rows:5 },
      theme:{ ...jellybean.theme,
        sky:["#2a2fc9","#7b83ff","#f6a6dd"], fog:"#c4c2ff",
        berry:["#c084fc","#e9d5ff","#9333ea"],     // orchid
        ocean:["#4f7cf7","#818cf8","#1e3a8a"],     // deep blue
        grape:["#7c3aed","#9f67ff","#4c1d95"],     // dark grape (Gumball Hill)
        azure:["#60a5fa","#93c5fd","#2563eb"],     // sky blue
        tile:["#a5f3fc","#c4b5fd","#4338ca"],      // tip-toe tiles: [colour A, colour B (checker), side]
        trap:["#93c5fd","#ffffff","#1d4ed8"],      // trapdoors: [panel, blink, side]
      },
    };
  })();

  const MAPS={ "jellybean-skyway":jellybean, "hazard-lab":hazardLab, "gumdrop-gauntlet":gumdrop };
  const DEFAULT="jellybean-skyway";
  const get=id=>MAPS[id]||MAPS[DEFAULT];
  // MAP PICKER: the maps players may choose (lobby map{id} + solo menu), in menu order, with a short blurb each.
  // Test rooms (hazard-lab) are never offered; ids not in MAPS yet are skipped.
  const BLURB={ "jellybean-skyway":"classic, gentle", "gumdrop-gauntlet":"wild, more spills" };
  const PICKABLE=Object.keys(BLURB).filter(id=>MAPS[id] && !MAPS[id].test);
  const pickable=id=>PICKABLE.includes(id);
  return { MAPS, DEFAULT, get, PICKABLE, BLURB, pickable };
});
