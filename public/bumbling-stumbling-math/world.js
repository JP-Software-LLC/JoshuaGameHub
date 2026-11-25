// Bumbling Stumbling Math — the 3D world: scene, course, beans, Rapier physics, camera.
// Loaded by index.html with a dynamic import() (after the vendored files have been prefetched for the progress bar).
// Course coordinates (shared/stumble.js): d = metres forward, x = sideways, y = height.  World: X = x, Y = y, Z = -d.
// The page owns rules/HUD/network; this module owns everything you see and the physics of your own bean (+ solo bots).
//
// MAPS: the course is built from map DATA (shared/stumble-maps.js → STUMBLE.compile). createWorld() builds
//   STUMBLE_MAPS.DEFAULT (or createWorld({ mapId })). W.setMap(id) rebuilds the course for another map (no-op when it
//   is already loaded; unknown ids fall back to the default). Call it BEFORE W.startRace(). W.map = the map object,
//   W.course = its compiled course. Each piece type has ONE builder below (BUILDERS), so a new map is mostly data.
// VEILS: my bean freezes at veil k (st.quiz=k, a=5, event "veil"); W.passVeil() lets it through (event "veilPass" +
//   "checkpoint", the curtain fades on MY screen only). Solo bots wait W.qpv × (2.5–6 s) at each veil, then pass.
// EVENTS (W.onEvent(e,pid,st)): jump land bonk fall respawn checkpoint finish dive · veil veilPass pad flag
import * as THREE from "three";
import { mergeGeometries } from "../assets/vendor/three/addons/utils/BufferGeometryUtils.js";
import RAPIER from "../assets/vendor/rapier/rapier.es.js";

const S=window.STUMBLE, T=S.T, MAPS=window.STUMBLE_MAPS||S.MAPS;
const DT=1/60;
export const pcol=i=>`hsl(${(i*137.508+275)%360},78%,58%)`;   // player colour (starts in the purples)

// ============================================================
//  BEAN — placeholder capsule character. Swap makeBean() for a GLB later: the rest of the code only uses
//  { root, pivot, setLabel, dispose } + the anim fields it keeps on the object.
// ============================================================
const BEAN={ body:null, eyes:null, eyeMat:null, eyeGhost:null, shadowGeo:null, shadowMat:null, mats:new Map() };
function beanShared(){
  if (BEAN.body) return;
  BEAN.body=new THREE.CapsuleGeometry(T.radius,T.halfH*2,4,12); BEAN.body.translate(0,T.halfH+T.radius,0);
  const parts=[];
  const add=(g,col)=>{ const c=new THREE.Color(col), n=g.attributes.position.count, a=new Float32Array(n*3); for (let i=0;i<n;i++){ a[i*3]=c.r; a[i*3+1]=c.g; a[i*3+2]=c.b; } g.setAttribute("color",new THREE.BufferAttribute(a,3)); g.deleteAttribute("uv"); parts.push(g); };
  for (const s of [-1,1]){
    add(new THREE.SphereGeometry(0.16,10,8).translate(s*0.17,1.28,-0.33),"#ffffff");
    add(new THREE.SphereGeometry(0.08,8,6).translate(s*0.16,1.28,-0.47),"#14112b");
    add(new THREE.SphereGeometry(0.025,5,4).translate(s*0.14,1.31,-0.545),"#ffffff");     // glint
  }
  add(new THREE.TorusGeometry(0.1,0.025,4,10,Math.PI).rotateZ(Math.PI).translate(0,1.06,-0.43),"#14112b"); // smile
  BEAN.eyes=mergeGeometries(parts);
  BEAN.eyeMat=new THREE.MeshBasicMaterial({ vertexColors:true });
  BEAN.eyeGhost=new THREE.MeshBasicMaterial({ vertexColors:true, transparent:true, opacity:0.5, depthWrite:false });
  BEAN.shadowGeo=new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);
  const cv=document.createElement("canvas"); cv.width=cv.height=64; const x=cv.getContext("2d");
  const g=x.createRadialGradient(32,32,2,32,32,31); g.addColorStop(0,"rgba(30,10,60,.55)"); g.addColorStop(0.6,"rgba(30,10,60,.3)"); g.addColorStop(1,"rgba(30,10,60,0)");
  x.fillStyle=g; x.fillRect(0,0,64,64);
  BEAN.shadowMat=new THREE.MeshBasicMaterial({ map:new THREE.CanvasTexture(cv), transparent:true, depthWrite:false });
}
function beanMat(color,ghost){
  const k=color+(ghost?"g":""); let m=BEAN.mats.get(k); if (m) return m;
  m=new THREE.MeshLambertMaterial({ color:new THREE.Color(pcol(color)), emissive:new THREE.Color(pcol(color)).multiplyScalar(0.18) });
  if (ghost){ m.transparent=true; m.opacity=0.5; }           // depthWrite stays on so the eyes on the far side never show through
  BEAN.mats.set(k,m); return m;
}
function labelSprite(text,me){
  const cv=document.createElement("canvas"), x=cv.getContext("2d"), fs=44;
  x.font=`900 ${fs}px Nunito, system-ui, sans-serif`; const w=Math.ceil(x.measureText(text).width)+40;
  cv.width=w; cv.height=fs+26;
  x.font=`900 ${fs}px Nunito, system-ui, sans-serif`; x.textAlign="center"; x.textBaseline="middle";
  x.fillStyle=me?"rgba(255,207,51,.95)":"rgba(28,16,64,.62)"; x.beginPath(); x.roundRect(2,2,w-4,cv.height-4,(cv.height-4)/2); x.fill();
  x.fillStyle=me?"#2a1260":"#fff"; x.fillText(text,w/2,cv.height/2+2);
  const tex=new THREE.CanvasTexture(cv); tex.colorSpace=THREE.SRGBColorSpace;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, depthWrite:false, transparent:true }));
  sp.userData.aspect=w/cv.height; sp.renderOrder=10; return sp;
}
export function makeBean(color,{ ghost=false, name="", me=false }={}){
  beanShared();
  const root=new THREE.Group(), pivot=new THREE.Group(); root.add(pivot);
  const body=new THREE.Mesh(BEAN.body,beanMat(color,ghost)), eyes=new THREE.Mesh(BEAN.eyes,ghost?BEAN.eyeGhost:BEAN.eyeMat);
  pivot.add(body,eyes); if (ghost){ body.renderOrder=2; eyes.renderOrder=3; }   // body first, so its depth hides the eyes from behind
  const shadow=new THREE.Mesh(BEAN.shadowGeo,BEAN.shadowMat); shadow.renderOrder=1;
  const b={ root, pivot, shadow, label:null, phase:Math.random()*6, squash:0, yaw:0, spin:0, ghost, color,
    setLabel(text,scale=1){ if (b.label){ root.remove(b.label); b.label.material.map.dispose(); b.label.material.dispose(); b.label=null; }
      if (!text) return; b.label=labelSprite(text,me); const h=0.42*scale; b.label.scale.set(h*b.label.userData.aspect,h,1); b.label.position.y=2.25+0.2*scale; root.add(b.label); },
    dispose(){ b.setLabel(""); root.removeFromParent(); shadow.removeFromParent(); } };
  if (name) b.setLabel(name);
  return b;
}
// a: 0 idle · 1 run · 2 air · 3 fallen · 4 diving · 5 solving a veil (stands still). full=false → cheap animation (far beans).
// Every pose value is a TARGET that the bean eases toward (b.cur), so switching state (run → air → dive → get up)
// never snaps the body: no flicker when the grounded flag blips, and the dive tips over / stands up smoothly.
const ease=(cur,tgt,rate,dt)=>cur+(tgt-cur)*(1-Math.exp(-rate*dt));
function animBean(b,{ a, speed, vy, dt, t, full }){
  const p=b.pivot, c=b.cur||(b.cur={ pitch:0, roll:0, y:0, sy:1 });
  if (a===3){ b.spin+=dt*11; p.rotation.set(b.spin,0,b.spin*0.6); const s=Math.max(0.05,p.scale.x-dt*0.9); p.scale.set(s,s,s); p.position.y=0; return; }
  if (b.spin){ b.spin=0; Object.assign(c,{ pitch:0, roll:0, y:0, sy:1 }); p.rotation.set(0,0,0); p.scale.set(0.2,0.2,0.2); b.squash=-0.4; }        // pop back in after a respawn
  b.spd=ease(b.spd||0,speed,10,dt);                       // smoothed speed: drives the stride, never jumps
  const run=Math.min(1,b.spd/T.run);
  b.phase+=dt*(4+b.spd*1.9);
  b.squash=(b.squash||0)*Math.exp(-dt*9);
  let pitch=0, roll=0, y=0, sy=1, rate=9;
  if (a===4){ pitch=-1.42; sy=0.92; rate=11; }                                          // dive: belly-flop, face first
  else if (a===1){ y=Math.abs(Math.sin(b.phase))*0.18*run; sy=1+0.06*Math.cos(b.phase*2)*run; pitch=-0.22*run; roll=Math.sin(b.phase)*0.12*run; }
  else if (a===2){ sy=1+Math.max(-0.1,Math.min(0.14,(vy||0)*0.018)); pitch=-0.12*run; }
  else { sy=1+0.03*Math.sin(t*3.2+b.color); roll=Math.sin(t*1.7+b.color)*0.04; }
  if (!full){ roll=0; sy=1; }
  c.pitch=ease(c.pitch,pitch,a===4||c.pitch<-0.6?rate:12,dt); c.roll=ease(c.roll,roll,12,dt);
  c.y=ease(c.y,y,18,dt); c.sy=ease(c.sy,sy,14,dt);
  const sq=c.sy-b.squash*0.5, sx=1/Math.sqrt(Math.max(0.4,sq));
  const grow=Math.min(1,p.scale.x<0.99&&!b.spin?p.scale.x+dt*5:1);
  // lying down: lift by the body radius so the belly rests ON the floor instead of sinking into it
  p.position.y=c.y+T.radius*Math.sin(-Math.min(0,c.pitch))*0.95;
  p.rotation.set(c.pitch,0,c.roll); p.scale.set(sx*grow,sq*grow,sx*grow);
}

// "?" thinking bubble over beans that are solving a veil (a=5): one shared sprite material
let QMAT=null;
function qBubble(){
  if (!QMAT){ const cv=document.createElement("canvas"); cv.width=cv.height=96; const x=cv.getContext("2d");
    x.fillStyle="#ffffff"; x.strokeStyle="#2563eb"; x.lineWidth=6; x.beginPath(); x.arc(48,44,36,0,Math.PI*2); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(36,74); x.lineTo(30,92); x.lineTo(54,78); x.closePath(); x.fill();
    x.font="900 54px Nunito, system-ui, sans-serif"; x.textAlign="center"; x.textBaseline="middle"; x.fillStyle="#2563eb"; x.fillText("?",48,48);
    const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; QMAT=new THREE.SpriteMaterial({ map:t, depthWrite:false, transparent:true }); }
  const s=new THREE.Sprite(QMAT); s.scale.set(0.75,0.75,1); s.renderOrder=11; return s;
}

// ============================================================
//  WORLD
// ============================================================
export async function createWorld({ canvas, onProgress=()=>{}, mapId }={}){
  await RAPIER.init(); onProgress(0.88);
  const R=new THREE.WebGLRenderer({ canvas, antialias:(devicePixelRatio||1)<1.5, powerPreference:"high-performance" });
  R.setPixelRatio(Math.min(1.5,devicePixelRatio||1));
  const scene=new THREE.Scene();
  scene.fog=new THREE.Fog(new THREE.Color("#c9b8ff"),70,190);
  const cam=new THREE.PerspectiveCamera(58,1,0.1,260); cam.rotation.order="YXZ";
  scene.add(new THREE.HemisphereLight("#e9e3ff","#6d3fd6",1.9));
  const sun=new THREE.DirectionalLight("#fff6e8",1.9); sun.position.set(-6,14,6); scene.add(sun);

  // ---- sky dome (vertical gradient) + the goo far below (colours come from the map theme) ----
  const skyMat=new THREE.ShaderMaterial({ side:THREE.BackSide, depthWrite:false, fog:false,
    uniforms:{ top:{ value:new THREE.Color("#3b2bd6") }, mid:{ value:new THREE.Color("#8f7dff") }, low:{ value:new THREE.Color("#ffb3e6") } },
    vertexShader:"varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader:"uniform vec3 top,mid,low; varying vec3 vP; void main(){ float h=normalize(vP).y; vec3 c=h>0.12?mix(mid,top,smoothstep(0.12,0.75,h)):mix(low,mid,smoothstep(-0.25,0.12,h)); gl_FragColor=vec4(c,1.0); }" });
  const sky=new THREE.Mesh(new THREE.SphereGeometry(240,24,12),skyMat); sky.renderOrder=-10; scene.add(sky);
  const gooMat=new THREE.MeshLambertMaterial({ color:"#1e2a8a", emissive:"#0b1250" });
  const goo=new THREE.Mesh(new THREE.PlaneGeometry(600,600).rotateX(-Math.PI/2),gooMat); goo.position.y=-14; scene.add(goo);

  // ---- textures ----
  const texCache=new Map();
  function canvasTex(key,draw,size=64){
    if (texCache.has(key)) return texCache.get(key);
    const cv=document.createElement("canvas"); cv.width=cv.height=size; draw(cv.getContext("2d"),size);
    const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=4; texCache.set(key,t); return t;
  }
  const stripes=(a,b,n=2,dir="v")=>canvasTex("s"+a+b+n+dir,(x)=>{
    for (let i=0;i<n;i++){ x.fillStyle=i%2?b:a; if (dir==="v") x.fillRect(0,i*64/n,64,64/n); else x.fillRect(i*64/n,0,64/n,64); }
    x.fillStyle="rgba(255,255,255,.18)"; if (dir==="v") x.fillRect(0,0,64,3); else x.fillRect(0,0,3,64); });
  // conveyor: white chevrons pointing +v (= the way the belt moves)
  const chevrons=(bg,fg)=>canvasTex("c"+bg+fg,(x)=>{ x.fillStyle=bg; x.fillRect(0,0,64,64); x.strokeStyle=fg; x.lineWidth=9; x.lineCap="round"; x.lineJoin="round";
    x.beginPath(); x.moveTo(14,44); x.lineTo(32,24); x.lineTo(50,44); x.stroke(); x.fillStyle="rgba(0,0,0,.12)"; x.fillRect(0,0,4,64); x.fillRect(60,0,4,64); });
  // bounce pad: yellow with a white ring + up arrow
  const padTex=(a,b)=>canvasTex("p"+a+b,(x)=>{ x.fillStyle=a; x.fillRect(0,0,128,128); x.strokeStyle=b; x.lineWidth=10; x.beginPath(); x.arc(64,64,44,0,Math.PI*2); x.stroke();
    x.fillStyle=b; x.beginPath(); x.moveTo(64,30); x.lineTo(88,62); x.lineTo(73,62); x.lineTo(73,94); x.lineTo(55,94); x.lineTo(55,62); x.lineTo(40,62); x.closePath(); x.fill(); },128);

  // ---- physics world ----
  const world=new RAPIER.World({ x:0, y:-T.gravity, z:0 });
  const kcc=world.createCharacterController(0.02);
  kcc.enableSnapToGround(0.3); kcc.enableAutostep(0.3,0.15,false); kcc.setMaxSlopeClimbAngle(50*Math.PI/180); kcc.setSlideEnabled(true);
  kcc.setApplyImpulsesToDynamicBodies(false);
  const BEAN_GROUPS=0x00020001;          // membership 2, collides with the course (1) only: beans never touch each other

  // ============================================================
  //  COURSE BUILD — one builder per piece type. CR = everything that belongs to the current map (torn down by setMap).
  // ============================================================
  let CR=null;
  function buildCourse(map){
    const c=S.compile(map), th=map.theme||{}, L=c.length;
    const group=new THREE.Group(); scene.add(group);
    const cr={ map, c, group, colliders:[], bodies:[], movers:[], pads:[], belts:[], panels:[], veils:[], flags:[], spinners:[], floaters:[], geos:[], mats:[] };
    const PAL=k=>th[k]||({ main:["#8b5cf6","#a78bfa","#6d28d9"], alt:["#b69cff","#d6c8ff","#7c5ce0"], block:["#22d3ee","#a5f3fc","#0891b2"], wall:["#5eead4","#ccfbf1","#0d9488"],
      edge:["#ff5fb7","#ffffff","#ec4899"], mover:["#ff4fa8","#ffffff","#c026d3"], belt:["#ff4fa8","#ffffff","#be185d"], pad:["#ffd23f","#fff6c2","#d69e00"] })[k]||["#8b5cf6","#a78bfa","#6d28d9"];
    if (th.sky){ skyMat.uniforms.top.value.set(th.sky[0]); skyMat.uniforms.mid.value.set(th.sky[1]); skyMat.uniforms.low.value.set(th.sky[2]); }
    if (th.goo){ gooMat.color.set(th.goo[0]); gooMat.emissive.set(th.goo[1]); }
    if (th.fog) scene.fog.color.set(th.fog);
    const own=o=>{ group.add(o); return o; };
    // --- physics helpers ---
    const box=(b)=>cr.colliders.push(world.createCollider(RAPIER.ColliderDesc.cuboid((b.x1-b.x0)/2,b.h/2,(b.d1-b.d0)/2).setTranslation((b.x0+b.x1)/2,b.top-b.h/2,-(b.d0+b.d1)/2)));
    const rampFrame=(r)=>{ const len=r.d1-r.d0, th2=Math.atan2(r.top1-r.top0,len), Ls=Math.hypot(len,r.top1-r.top0);
      const n=new THREE.Vector3(0,Math.cos(th2),Math.sin(th2)), top=new THREE.Vector3((r.x0+r.x1)/2,(r.top0+r.top1)/2,-(r.d0+r.d1)/2);
      return { th:th2, Ls, w:r.x1-r.x0, top, n, centre:top.clone().addScaledVector(n,-(r.h??1)/2), q:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),th2) }; };
    // --- batched static boxes: per colour key ONE striped top mesh + ONE side mesh ---
    const batch=new Map();
    const B=key=>{ if (!batch.has(key)) batch.set(key,{ tops:[], sides:[] }); return batch.get(key); };
    const topUV=(g,rx,ry)=>{ const uv=g.attributes.uv; for (let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*rx,uv.getY(i)*ry); };
    const flatNormals=g=>{ g.deleteAttribute("normal"); g.setAttribute("normal",new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill([0,1,0]).flat(),3)); };
    function addBox(b,key,{ tile=3.5, thin=false }={}){
      const len=b.d1-b.d0, w=b.x1-b.x0, cx=(b.x0+b.x1)/2, cz=-(b.d0+b.d1)/2;
      const top=new THREE.PlaneGeometry(w,len).rotateX(-Math.PI/2).translate(cx,b.top+0.004,cz);
      topUV(top,thin?1:Math.max(1,Math.round(w/tile)),Math.max(1,Math.round(len/(thin?1.6:tile)))); flatNormals(top);
      const side=new THREE.BoxGeometry(w,b.h,len).translate(cx,b.top-b.h/2,cz); side.deleteAttribute("uv");
      B(key).tops.push(top); B(key).sides.push(side);
    }
    function addRampBox(r,key,{ thin=false }={}){
      const F=rampFrame(r), m=new THREE.Matrix4().compose(F.centre,F.q,new THREE.Vector3(1,1,1));
      const side=new THREE.BoxGeometry(F.w,r.h??1,F.Ls).applyMatrix4(m); side.deleteAttribute("uv");
      const top=new THREE.PlaneGeometry(F.w,F.Ls).rotateX(-Math.PI/2).translate(0,(r.h??1)/2+0.004,0).applyMatrix4(m);
      topUV(top,thin?1:Math.max(1,Math.round(F.w/3.5)),Math.max(1,Math.round(F.Ls/(thin?1.6:3.5))));
      B(key).tops.push(top); B(key).sides.push(side);
    }
    function flush(){
      for (const [key,G] of batch){ const P=PAL(key);
        const tm=new THREE.MeshLambertMaterial({ map:stripes(P[0],P[1],2,"v") }), sm=new THREE.MeshLambertMaterial({ color:P[2] });
        if (G.tops.length) own(new THREE.Mesh(mergeGeometries(G.tops),tm)); if (G.sides.length) own(new THREE.Mesh(mergeGeometries(G.sides),sm)); cr.mats.push(tm,sm); }
      batch.clear();
    }
    // --- builders ---
    const BUILDERS={
      floor:p=>{ box(p); addBox(p,p.c||"main"); },
      block:p=>{ box(p); addBox(p,"block",{ tile:2 }); },
      wall:p=>{ box(p); addBox(p,"wall",{ thin:true }); },
      rail:p=>{ box(p); addBox(p,"edge",{ thin:true }); },
      ramp:p=>{ const F=rampFrame(p);
        cr.colliders.push(world.createCollider(RAPIER.ColliderDesc.cuboid(F.w/2,(p.h??1)/2,F.Ls/2).setTranslation(F.centre.x,F.centre.y,F.centre.z).setRotation({ x:F.q.x, y:F.q.y, z:F.q.z, w:F.q.w })));
        addRampBox(p,p.c||"main",{ thin:p.c==="edge" }); },
      pad:p=>{ box(p); const P=PAL("pad"), w=p.x1-p.x0, len=p.d1-p.d0;
        const t=padTex(P[0],P[1]).clone(); t.needsUpdate=true; t.repeat.set(Math.max(1,Math.round(w/3)),Math.max(1,Math.round(len/3)));
        const mat=new THREE.MeshLambertMaterial({ map:t, emissive:P[0], emissiveIntensity:0.35 });
        const side=new THREE.MeshLambertMaterial({ color:P[2], emissive:P[0], emissiveIntensity:0.2 });
        const m=own(new THREE.Mesh(new THREE.BoxGeometry(w,p.h??0.3,len),[side,side,mat,side,side,side])); m.position.set((p.x0+p.x1)/2,p.top-(p.h??0.3)/2,-(p.d0+p.d1)/2);
        cr.pads.push({ p, mat, side, ph:p.d0*0.7 }); cr.mats.push(mat,side); },
      belt:p=>{ box(p); const P=PAL("belt"), vx=p.vx||0, vd=p.vd||0, sp=Math.hypot(vx,vd)||1, ux=vx/sp, ud=vd/sp, tile=2;
        // top with UVs in metres along the belt's motion (v) and across it (u): chevrons point the way it pushes you
        const g=new THREE.PlaneGeometry(p.x1-p.x0,p.d1-p.d0).rotateX(-Math.PI/2).translate((p.x0+p.x1)/2,p.top+0.006,-(p.d0+p.d1)/2);
        const pos=g.attributes.position, uv=g.attributes.uv;
        for (let i=0;i<uv.count;i++){ const x=pos.getX(i), d=-pos.getZ(i); uv.setXY(i,(x*ud-d*ux)/tile,(x*ux+d*ud)/tile); }
        const t=chevrons(P[0],P[1]).clone(); t.needsUpdate=true;
        const mat=new THREE.MeshLambertMaterial({ map:t, emissive:"#5a0b35", emissiveIntensity:0.25 }); own(new THREE.Mesh(g,mat));
        const side=new THREE.BoxGeometry(p.x1-p.x0,p.h??3,p.d1-p.d0).translate((p.x0+p.x1)/2,p.top-(p.h??3)/2,-(p.d0+p.d1)/2); side.deleteAttribute("uv"); B("belt").sides.push(side);
        cr.belts.push({ p, t, sp, tile }); cr.mats.push(mat); },
      mover:m=>{ const p=S.moverPos(m,0), h=m.h??0.8;
        const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x,p.top-h/2,-p.d));
        world.createCollider(RAPIER.ColliderDesc.cuboid(m.w/2,h/2,m.len/2),body); cr.bodies.push(body);
        const P=PAL("mover"), t=stripes(P[0],P[1],2,"v").clone(); t.needsUpdate=true; t.repeat.set(Math.max(1,Math.round(m.w/2.5)),Math.max(1,Math.round(m.len/2.5)));
        const side=new THREE.MeshLambertMaterial({ color:P[2] }), top=new THREE.MeshLambertMaterial({ map:t });
        const g=new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(m.w,h,m.len),[side,side,top,side,side,side]));
        const rim=new THREE.Mesh(new THREE.BoxGeometry(m.w+0.3,0.18,m.len+0.3),new THREE.MeshBasicMaterial({ color:"#fff3a8" })); rim.position.y=-h/2+0.05; g.add(rim);
        own(g); cr.movers.push({ m, body, g, h }); cr.mats.push(side,top); },
      doors:p=>{ const D=c.doors.find(q=>q.src===p);
        for (const q of D.posts){ box(q); addBox(q,"block",{ tile:2 }); }
        const jm=new THREE.MeshLambertMaterial({ color:th.jelly||"#ffd84d", emissive:th.jelly||"#ffd84d", emissiveIntensity:0.75, transparent:true, opacity:0.9 });
        cr.mats.push(jm);
        for (const q of D.panels){ if (!q.open) box(q);
          const m=own(new THREE.Mesh(new THREE.BoxGeometry(q.x1-q.x0-0.06,q.top-0.04,0.28),jm)); m.position.set((q.x0+q.x1)/2,q.top/2,-D.d);
          // a few darker "jelly bubbles" so the panel reads as wobbly jelly rather than glass
          cr.panels.push({ q, m, wob:0, pop:0, popped:false }); } },
      sign:p=>{ const hw=S.halfWidthAt(c,p.d), cv=document.createElement("canvas"); cv.width=512; cv.height=112; const x=cv.getContext("2d");
        x.fillStyle="#2a1260"; x.beginPath(); x.roundRect(4,4,504,104,26); x.fill(); x.strokeStyle="#ffcf33"; x.lineWidth=6; x.stroke();
        x.font="54px 'Lilita One', system-ui, sans-serif"; x.textAlign="center"; x.textBaseline="middle"; x.fillStyle="#ffffff";
        let fs=54; while (x.measureText(p.text).width>470&&fs>28){ fs-=2; x.font=`${fs}px 'Lilita One', system-ui, sans-serif`; } x.fillText(p.text,256,60);
        const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; const mat=new THREE.MeshBasicMaterial({ map:t, transparent:true }); cr.mats.push(mat);
        const m=own(new THREE.Mesh(new THREE.PlaneGeometry(4.6,1.0),mat)); m.position.set(-hw-1.2,3.1,-p.d); m.rotation.y=0.25;
        poles.push(new THREE.CylinderGeometry(0.09,0.09,10,6).translate(-hw-1.2,-2.4,-p.d)); },
    };
    const poles=[];
    for (const p of map.pieces||[]){ const f=BUILDERS[p.type]; if (f) f(p); }
    flush();
    // invisible end wall so nobody runs off the end of the world
    box({ d0:L+15, d1:L+16, x0:-T.halfWidth, x1:T.halfWidth, top:6, h:6 });

    // --- veils: a full-width, full-height shimmering blue curtain per veil (fades on MY screen once I pass it) ---
    const vcol=new THREE.Color(th.veil||"#4aa8ff"), VW=2*T.halfWidth+3, VH=24;
    const vgeo=new THREE.PlaneGeometry(VW,VH);
    for (const v of c.veils){
      const mat=new THREE.ShaderMaterial({ transparent:true, depthWrite:false, side:THREE.DoubleSide, fog:false,
        uniforms:{ time:{ value:0 }, fade:{ value:1 }, col:{ value:vcol } },
        vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader:`uniform float time,fade; uniform vec3 col; varying vec2 vUv;
          void main(){ float x=vUv.x*${VW.toFixed(1)}, y=vUv.y*${VH.toFixed(1)};
            float w=sin(x*2.3+time*1.7+sin(y*0.9+time*1.3)*1.6)*0.5+0.5;
            float b=sin(y*2.6-time*2.4+x*0.5)*0.5+0.5;
            float s=pow(max(0.0,sin(x*7.1+y*3.3+time*3.0)*sin(x*2.9-y*5.7-time*2.0)),24.0);
            float edge=smoothstep(0.0,3.5,y)*smoothstep(${VH.toFixed(1)},${(VH-6).toFixed(1)},y);
            vec3 c=mix(col,vec3(0.85,0.95,1.0),w*0.45+b*0.25+s);
            gl_FragColor=vec4(c,(0.22+0.2*w+0.12*b+0.5*s)*edge*fade); }` });
      const m=own(new THREE.Mesh(vgeo,mat)); m.position.set(0,VH/2-6,-v.d); m.renderOrder=5;
      const q=own(qBubble()); q.material=q.material.clone(); q.scale.set(2.2,2.2,1); q.position.set(0,5.6,-v.d);
      for (const s of [-1,1]) poles.push(new THREE.CylinderGeometry(0.35,0.35,22,8).translate(s*(VW/2),5,-v.d));
      cr.veils.push({ v, m, mat, q, on:1, target:1 });
    }
    // --- quiet checkpoint flags (no arch): a pole on the right edge + a pennant that turns gold once I reach it ---
    c.checkpoints.forEach((cp,i)=>{ if (cp.veil!=null||cp.d<=0) return;
      const hw=S.halfWidthAt(c,cp.d), g=Math.max(0,S.groundAt(c,cp.d,hw-0.3,0)), x=hw+0.9;
      poles.push(new THREE.CylinderGeometry(0.08,0.08,3.6+6,6).translate(x,g+3.6-(3.6+6)/2,-cp.d));
      const sh=new THREE.Shape(); sh.moveTo(0,0); sh.lineTo(-1.5,-0.45); sh.lineTo(0,-0.9); sh.closePath();
      const mat=new THREE.MeshLambertMaterial({ color:"#c4b5fd", emissive:"#3b2a7a", side:THREE.DoubleSide }); cr.mats.push(mat);
      const f=own(new THREE.Mesh(new THREE.ShapeGeometry(sh),mat)); f.position.set(x,g+3.55,-cp.d); f.rotation.y=-0.5;
      cr.flags.push({ i, f, mat, got:false }); });
    if (poles.length){ const pm=new THREE.MeshLambertMaterial({ color:"#f5f3ff", emissive:"#7c6cff", emissiveIntensity:0.35 }); cr.mats.push(pm); own(new THREE.Mesh(mergeGeometries(poles),pm)); }

    // --- arches: start + finish (the finish gets a checkered strip on the floor) ---
    function bannerTex(text,bg,fg,checker){
      const cv=document.createElement("canvas"); cv.width=512; cv.height=96; const x=cv.getContext("2d");
      if (checker){ for (let i=0;i<32;i++) for (let j=0;j<6;j++){ x.fillStyle=(i+j)%2?"#1b1440":"#ffffff"; x.fillRect(i*16,j*16,16,16); } x.fillStyle=bg; x.fillRect(70,8,372,80); }
      else { x.fillStyle=bg; x.fillRect(0,0,512,96); }
      x.font="64px 'Lilita One', system-ui, sans-serif"; x.textAlign="center"; x.textBaseline="middle";
      x.lineWidth=10; x.strokeStyle="rgba(40,10,90,.85)"; x.strokeText(text,256,52); x.fillStyle=fg; x.fillText(text,256,52);
      const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; return t;
    }
    function arch(d,text,{ bg="#7c3aed", fg="#ffcf33", checker=false, h=12.5, pillar="#ff5fb7" }={}){
      const w=S.halfWidthAt(c,d)+0.6, g0=Math.max(0,S.groundAt(c,d,0,0));
      const g=new THREE.Group(); g.position.set(0,g0,-d);
      const pm=new THREE.MeshLambertMaterial({ map:stripes(pillar,"#ffffff",4,"v") });
      for (const s of [-1,1]){ const p=new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.55,h,10),pm); p.position.set(s*w,h/2,0); g.add(p);
        const ball=new THREE.Mesh(new THREE.SphereGeometry(0.7,12,8),new THREE.MeshLambertMaterial({ color:"#ffcf33", emissive:"#7a5200" })); ball.position.set(s*w,h+0.4,0); g.add(ball); }
      const ban=new THREE.Mesh(new THREE.BoxGeometry(w*2,2.1,0.35),new THREE.MeshLambertMaterial({ color:bg })); ban.position.y=h-0.5; g.add(ban);
      const face=new THREE.Mesh(new THREE.PlaneGeometry(w*2,2.1),new THREE.MeshBasicMaterial({ map:bannerTex(text,bg,fg,checker) })); face.position.set(0,h-0.5,0.18); g.add(face);
      return own(g);
    }
    arch(0,"START",{ bg:"#2563eb" });
    cr.finishArch=arch(L,"FINISH",{ bg:"#ff3d9a", fg:"#ffffff", checker:true, h:13 });
    { const hw=S.halfWidthAt(c,L), t=stripes("#ffffff","#1b1440",8,"h").clone(); t.needsUpdate=true; t.repeat.set(Math.round(hw*2/4),1);
      const fl=own(new THREE.Mesh(new THREE.PlaneGeometry(hw*2,1.2).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({ map:t }))); fl.position.set(0,Math.max(0,S.groundAt(c,L,0,0))+0.03,-L); }

    // --- decoration: candy islands, rings, clouds, lollipops (deterministic, merged into a few meshes) ---
    {
      const r=S.rng(1234);
      const cols=["#f472b6","#22d3ee","#a78bfa","#60a5fa","#facc15","#fb7185","#34d399"];
      const tint=(g,col)=>{ g=g.index?g.toNonIndexed():g.clone(); const cc=new THREE.Color(col), n=g.attributes.position.count, a=new Float32Array(n*3);
        for (let i=0;i<n;i++){ a[i*3]=cc.r; a[i*3+1]=cc.g; a[i*3+2]=cc.b; } g.setAttribute("color",new THREE.BufferAttribute(a,3)); if (g.attributes.uv) g.deleteAttribute("uv"); return g; };
      const place=(g,{ x=0,y=0,z=0,sx=1,sy=1,sz=1,ry=0,rx=0 })=>g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,0)),new THREE.Vector3(sx,sy,sz)));
      const solidParts=[], cloudParts=[], popParts=[], ringParts=[];
      const ringGeo=new THREE.TorusGeometry(3.2,0.55,8,24);
      for (let i=0;i<Math.round(L/38);i++) ringParts.push(place(tint(ringGeo,cols[i%cols.length]),{ x:(i%2?1:-1)*(19+r()*8), y:3+r()*6, z:-(i*38+12+r()*10), ry:(i%2?1:-1)*(0.5+r()*0.6) }));
      const isl=new THREE.CylinderGeometry(1,0.25,1,7), cap=new THREE.SphereGeometry(1,8,6,0,Math.PI*2,0,Math.PI/2);
      for (let i=0;i<Math.round(L/6);i++){ const s=2+r()*5, side=i%2?1:-1, x=side*(26+r()*50), y=-10+r()*16, z=-(r()*(L+60)-20);
        solidParts.push(place(tint(isl,"#7c3aed"),{ x, y:y-s*0.7, z, sx:s, sy:s*1.4, sz:s }), place(tint(cap,cols[(i*3)%cols.length]),{ x, y, z, sx:s*1.05, sy:s*0.45, sz:s*1.05 })); }
      const cloudGeo=new THREE.IcosahedronGeometry(1,0);
      for (let i=0;i<Math.round(L/7);i++){ const s=2+r()*3, x=(r()*2-1)*90, y=16+r()*26, z=-(r()*(L+120)-40);
        for (let k=0;k<4;k++){ const q=s*(0.6+r()*0.6); cloudParts.push(place(tint(cloudGeo,"#ffffff"),{ x:x+(k-1.5)*s*0.9, y:y+r()*s*0.4, z:z+r()*s*0.5, sx:q, sy:q, sz:q })); } }
      const stick=new THREE.CylinderGeometry(0.25,0.25,1,6), pop=new THREE.CylinderGeometry(1,1,0.5,16).rotateX(Math.PI/2);
      for (let i=0;i<Math.round(L/13);i++){ const h=10+r()*14, cc=cols[i%cols.length], x=(i%2?1:-1)*(21+r()*8), y=-5+r()*5, z=-(i*13+r()*6), q=2.2+r()*1.5;
        solidParts.push(place(tint(stick,"#ffffff"),{ x, y:y-h/2, z, sy:h }));
        popParts.push(place(tint(pop,cc),{ x, y, z, sx:q, sy:q, sz:q, ry:(r()-0.5)*0.8 })); }
      const solidMesh=own(new THREE.Mesh(mergeGeometries(solidParts),new THREE.MeshLambertMaterial({ vertexColors:true, flatShading:true })));
      const rings=own(new THREE.Mesh(mergeGeometries(ringParts),new THREE.MeshLambertMaterial({ vertexColors:true, emissive:"#ffffff", emissiveIntensity:0.12 })));
      const clouds=own(new THREE.Mesh(mergeGeometries(cloudParts),new THREE.MeshLambertMaterial({ vertexColors:true, emissive:"#d8ccff", emissiveIntensity:0.45, flatShading:true })));
      const pops=own(new THREE.Mesh(mergeGeometries(popParts),new THREE.MeshLambertMaterial({ vertexColors:true })));
      cr.floaters.push({ o:solidMesh, ph:0 }, { o:pops, ph:2 }, { o:rings, ph:3 }, { o:clouds, ph:1, cloud:true });
    }
    return cr;
  }
  function destroyCourse(cr){
    if (!cr) return;
    for (const col of cr.colliders) world.removeCollider(col,false);
    for (const b of cr.bodies) world.removeRigidBody(b);
    cr.group.traverse(o=>{ if (o.geometry) o.geometry.dispose(); });
    for (const m of cr.mats) m.dispose();
    scene.remove(cr.group);
  }
  function placeMovers(t){ for (const v of CR.movers){ const p=S.moverPos(v.m,t); v.body.setNextKinematicTranslation({ x:p.x, y:p.top-v.h/2, z:-p.d }); v.g.position.set(p.x,p.top-v.h/2,-p.d); } }
  function loadMap(id){
    const map=MAPS?MAPS.get(id):null; if (!map) throw new Error("no map "+id);
    destroyCourse(CR); CR=buildCourse(map); W.map=map; W.course=CR.c; W.finishLine=CR.finishArch;
    placeMovers(0); world.step();
  }

  // ============================================================
  //  BEANS IN PHYSICS (my bean + solo bots)
  // ============================================================
  function makeBody(st){
    return world.createCollider(RAPIER.ColliderDesc.capsule(T.halfH,T.radius).setCollisionGroups(BEAN_GROUPS).setTranslation(st.x,st.y+T.halfH+T.radius,-st.d));
  }
  // st: { d,x,y, vd,vx,vy, grounded, coyote, jbuf, cp, falls, fallen, fin, bonk, landed, a, dive, quiz, veilsDone, padV }
  function newState(i){ const sp=S.spawn(i,W.course); return { d:sp.d, x:sp.x, y:0, vd:0, vx:0, vy:0, grounded:true, coyote:0, jbuf:0, cp:0, falls:0, fallen:0, fin:false, bonk:0, landed:0, a:0, spIdx:i, dive:0, diveT:0, airT:0,
    quiz:-1, veilsDone:0, wait:0, padV:0, jhit:null, snag:0 }; }
  const setCol=(st,col)=>col.setTranslation({ x:st.x, y:st.y+T.halfH+T.radius, z:-st.d });
  // let a bean through the veil it is stuck at (my bean: game.js calls W.passVeil(); bots: after their wait)
  function passVeilSt(st,ev,quiet){
    const c=W.course, k=st.quiz; if (k<0) return;
    st.veilsDone=k+1; const v=c.veils[k]; if (v&&v.cp>=0) st.cp=Math.max(st.cp,v.cp);
    st.quiz=-1; st.vd=4.5; st.vx=0; st.vy=5.5; st.grounded=false; st.coyote=0; st.airT=0.2;    // a little hop through the curtain
    if (!quiet) ev.push("veilPass","checkpoint");
  }
  // one fixed physics step for one bean. inp = { mx, mz, jump, press }. Pushes event strings into ev.
  function stepBean(st,col,inp,mt,ev,brain){
    const c=W.course;
    if (st.fallen>0){ st.fallen-=DT; st.a=3;
      if (st.fallen<=0){ const p=S.respawnAt(c,st.cp,st.fx??0,st.spIdx,mt);
        Object.assign(st,{ d:p.d, x:p.x, y:p.y, vd:0, vx:0, vy:0, grounded:false, dive:0, diveT:0, padV:0 });
        setCol(st,col); ev.push("respawn"); }
      return; }
    if (st.quiz>=0){                                   // solving a veil: frozen in place, standing
      st.vx=st.vd=st.vy=0; st.dive=0; st.padV=0; st.a=5; st.grounded=true; st.bonk=0;
      if (brain){ st.wait-=DT; if (st.wait<=0) passVeilSt(st,ev,true); }
      return; }
    let mx=inp.mx, mz=inp.mz; const l=Math.hypot(mx,mz); if (l>1){ mx/=l; mz/=l; }
    if (st.bonk>0){ st.bonk-=DT; mx*=0.2; mz*=0.2; }
    if (st.dive){ mx=0; mz=0; }                                                  // no steering mid-dive or while getting up
    if (st.dive===2){ st.diveT-=DT; if (st.diveT<=0) st.dive=0; }
    let tvd=mz*T.run; const tvx=mx*T.run;
    if (st.padV>0 && mz>=0) tvd=Math.max(tvd,st.padV);                          // a pad throw keeps its forward speed (unless you pull back)
    const acc=st.dive===1?0:st.dive===2?T.slideFriction:st.grounded?(l>0.05?T.accel:T.friction):T.airAccel;
    const ap=(v,tv)=>{ const dv=tv-v, m=acc*DT; return v+Math.max(-m,Math.min(m,dv)); };
    st.vx=ap(st.vx,tvx); st.vd=ap(st.vd,tvd);
    // jump (coyote time + input buffer)
    st.coyote=st.grounded?T.coyote:Math.max(0,st.coyote-DT);
    st.jbuf=inp.jump&&!st.dive?T.jumpBuffer:Math.max(0,st.jbuf-DT);
    let jumped=false;
    if (st.jbuf>0 && st.coyote>0 && !st.dive){ st.vy=T.jumpV; st.jbuf=0; st.coyote=0; st.grounded=false; jumped=true; ev.push("jump"); }
    else if (inp.press && !st.grounded && st.coyote<=0 && !st.dive){       // second Space in the air = DIVE
      let hx=st.vx, hd=st.vd, hl=Math.hypot(hx,hd);
      if (hl<1){ hx=inp.mx; hd=inp.mz; hl=Math.hypot(hx,hd); }
      if (hl<0.1){ hx=0; hd=1; hl=1; }
      st.vx=hx/hl*T.diveV; st.vd=hd/hl*T.diveV; st.vy=Math.max(st.vy,T.diveUp); st.dive=1; st.jbuf=0; ev.push("dive"); }
    // jelly doors: running into a closed one bounces you back gently (same for everyone: pure data)
    if (st.vd>0) for (const q of c.jelly){ if (st.d+T.radius+st.vd*DT>=q.d0-0.02 && st.d<q.d1 && st.x>q.x0-T.radius*0.5 && st.x<q.x1+T.radius*0.5 && st.y<q.top){
      st.vd=-q.bounce; st.vy=Math.max(st.vy,3.2); st.vx*=0.4; st.bonk=0.45; st.grounded=false; st.dive=0; st.jhit=q; ev.push("bonk"); break; } }
    st.vy-=T.gravity*DT; if (st.vy<-30) st.vy=-30;
    // what am I standing on? moving platforms carry you, belts push you
    let cx=0, cd=0;
    if (st.grounded&&!jumped){ const P=S.probe(c,st.d,st.x,mt-DT,st.y+0.1).p;
      if (P&&P.type==="mover"){ const a=S.moverPos(P,mt-DT), b=S.moverPos(P,mt); cx=b.x-a.x; cd=b.d-a.d; }
      else if (P&&P.type==="belt"){ cx=(P.vx||0)*DT; cd=(P.vd||0)*DT; } }
    const want={ x:st.vx*DT+cx, y:st.vy*DT, z:-(st.vd*DT+cd) };
    kcc.computeColliderMovement(col,want,undefined,BEAN_GROUPS);
    const got=kcc.computedMovement(), wasG=st.grounded;
    st.grounded=kcc.computedGrounded() && st.vy<=0.01;
    st.x+=got.x; st.y+=got.y; st.d-=got.z;
    setCol(st,col);
    if (st.grounded){ if (!wasG && st.airT>0.15){ st.landed=Math.min(1,-st.vy/14); ev.push("land"); } if (st.dive===1){ st.dive=2; st.diveT=T.diveGetUp; } st.vy=0; st.airT=0; st.padV=0; }
    else { st.airT=(st.airT||0)+DT; if (st.vy>0 && got.y<want.y*0.5) st.vy=0; }                         // bumped the head
    // run into a wall at speed → bonk back (the "stumbling")
    const wh=Math.hypot(want.x-cx,want.z+cd), gh=((got.x-cx)*(want.x-cx)+(got.z+cd)*(want.z+cd))/(wh*wh||1);
    let wall=false;
    if (wh>T.run*DT*0.75 && gh<0.25 && st.bonk<=0) for (let i=0,n=kcc.numComputedCollisions();i<n;i++){
      const k=kcc.computedCollision(i); if (!k) continue; const nn=k.normal1;
      if (Math.abs(nn.y)<0.35 && Math.abs(nn.x*(want.x-cx)+nn.z*(want.z+cd))>0.6*wh) wall=true; }
    if (wall){ st.vx*=-0.55; st.vd*=-0.55; st.bonk=0.38; ev.push("bonk"); }
    // snagged on a seam (e.g. a docked ferry meets the floor: the capsule catches the box edge, no wall normal):
    // pushing but not moving for a few steps → lift a few cm so the next step slides over it
    if (!wall && st.grounded && wh>T.run*DT*0.4 && gh<0.15){ if (++st.snag>3){ st.y+=0.07; setCol(st,col); st.snag=0; } } else st.snag=0;
    // bounce pads: touch one standing up → thrown up + forward
    if (st.grounded){ const P=S.probe(c,st.d,st.x,mt,st.y+0.1).p;
      if (P&&P.type==="pad"&&Math.abs(st.y-P.top)<0.25){ st.vy=P.vy; st.vd=P.vd; st.padV=P.vd; st.grounded=false; st.coyote=0; st.jbuf=0; st.dive=0; st.airT=0.01; ev.push("pad"); } }
    // math veil: the front of the bean touches the next curtain → freeze and ask (bots just wait)
    if (st.veilsDone<c.veils.length){ const v=c.veils[st.veilsDone];
      if (st.d>=v.d-T.radius){
        st.d=v.d-T.radius; st.vx=st.vd=st.vy=0; st.dive=0; st.padV=0; st.bonk=0;
        const g=S.groundAt(c,st.d,st.x,mt,st.y+0.3); if (g>-Infinity&&st.y-g<2.5) st.y=g;
        st.grounded=true; setCol(st,col); st.quiz=v.k; st.a=5;
        if (brain) st.wait=(W.qpv??T.qpv)*(2.5+brain.r()*3.5); else ev.push("veil");
        return; } }
    // quiet flags, finish, falling
    if (st.grounded) for (let i=st.cp+1;i<c.checkpoints.length;i++){ const cp=c.checkpoints[i]; if (cp.veil!=null) continue; if (st.d>=cp.d){ st.cp=i; ev.push("flag"); } }
    if (!st.fin && st.d>=c.length){ st.fin=true; ev.push("finish"); }
    if (st.y<T.killY){ st.fallen=T.respawnT; st.falls++; st.fx=st.x; st.vx=st.vd=st.vy=0; st.dive=0; st.padV=0; ev.push("fall"); }
    const sp=Math.hypot(st.vx,st.vd);
    st.a=st.fallen>0?3:st.dive?4:(!st.grounded&&(st.airT>0.1||st.vy>1))?2:sp>0.6?1:0;
  }

  // ============================================================
  //  STATE: my bean, bots, ghosts (online relay), camera
  // ============================================================
  const W={ R, scene, cam, mode:"menu", me:null, bots:[], ghosts:new Map(), snaps:[], players:new Map(), acc:0, mt:0, qpv:T.qpv,
    teacher:false, onEvent:()=>{}, camPos:new THREE.Vector3(0,8,12), lastNow:performance.now(), map:null, course:null };
  loadMap(mapId||(MAPS&&MAPS.DEFAULT));
  onProgress(0.96);
  function clearBeans(){
    if (W.me){ W.me.bean.dispose(); world.removeCollider(W.me.col,false); W.me=null; }
    for (const b of W.bots){ b.bean.dispose(); world.removeCollider(b.col,false); }
    W.bots=[]; for (const g of W.ghosts.values()) g.bean.dispose(); W.ghosts.clear(); W.snaps=[];
  }
  function addBean(b){ scene.add(b.root); scene.add(b.shadow); }
  function resetCourseLooks(){
    for (const v of CR.veils){ v.target=1; } for (const f of CR.flags){ f.got=false; f.mat.color.set("#c4b5fd"); f.mat.emissive.set("#3b2a7a"); }
    for (const p of CR.panels){ p.popped=false; p.pop=0; p.wob=0; p.m.visible=true; p.m.scale.set(1,1,1); }
  }
  // switch map (rebuilds the course). Call before startRace. Returns the map object.
  W.setMap=id=>{ const want=MAPS?MAPS.get(id):null; if (want&&W.map!==want){ clearBeans(); loadMap(want.id); } return W.map; };
  // race setup. me = { pid, color, name } or null (teacher). moverT0 = performance.now() at race time 0.
  W.startRace=({ me, players, teacher=false, moverT0, startAt })=>{
    clearBeans(); W.mode="race"; W.teacher=teacher; W.moverT0=moverT0; W.startAt=startAt; W.acc=0; resetCourseLooks();
    W.players=new Map(players.map(p=>[p.pid,p]));
    if (me){ const st=newState(me.color); const bean=makeBean(me.color,{ name:"YOU", me:true }); addBean(bean);
      W.me={ pid:me.pid, st, col:makeBody(st), bean, prev:{ x:st.x, d:st.d } }; W.camPos.set(st.x,8.4,-st.d+9); }
    else W.camPos.set(0,22,18);
  };
  W.addBot=({ pid, color, name, skill, seed })=>{
    const st=newState(color), bean=makeBean(color,{ name }), brain=S.makeBot(seed,skill,W.course); addBean(bean);
    W.bots.push({ pid, st, col:makeBody(st), bean, brain });
  };
  W.menu=()=>{ clearBeans(); W.mode="menu"; resetCourseLooks(); };
  W.pushSnap=rows=>{ W.snaps.push({ t:performance.now(), rows }); if (W.snaps.length>30) W.snaps.shift(); };
  W.setPlayer=p=>W.players.set(p.pid,p);
  function veilLook(k,on){ const v=CR.veils[k]; if (v) v.target=on?1:0.07; }
  // my bean answered enough questions: through the veil it's frozen at
  W.passVeil=()=>{ const m=W.me; if (!m||m.st.quiz<0) return false; const k=m.st.quiz, ev=[]; passVeilSt(m.st,ev); veilLook(k,false);
    for (const e of ev) W.onEvent(e,m.pid,m.st); return true; };
  // respawn at a known point (rejoin): the last checkpoint at or before d; veils before d count as passed
  W.placeMe=(d,fin)=>{ const m=W.me; if (!m) return; const c=W.course; let cp=0; c.checkpoints.forEach((q,i)=>{ if (q.d<=d) cp=i; });
    const done=c.veils.filter(v=>v.d<d).length;
    Object.assign(m.st,{ cp, veilsDone:done, quiz:-1, fin:!!fin, vx:0, vd:0, vy:0, fallen:0, dive:0, padV:0 });
    for (let k=0;k<c.veils.length;k++) veilLook(k,k>=done);
    const p=S.respawnAt(c,cp,0,m.st.spIdx,W.mt); Object.assign(m.st,{ d:p.d, x:p.x, y:p.y }); setCol(m.st,m.col); };

  // ghosts from relay snapshots (interpolated ~100 ms behind)
  function ghostRows(now){
    const S2=W.snaps; if (!S2.length) return [];
    const rt=now-110; let a=S2[0], b=S2[0];
    for (let i=S2.length-1;i>=0;i--) if (S2[i].t<=rt){ a=S2[i]; b=S2[i+1]||S2[i]; break; }
    const k=b.t>a.t?Math.min(1,Math.max(0,(rt-a.t)/(b.t-a.t))):1;
    const myPid=W.me?W.me.pid:W.selfPid;
    return b.rows.filter(q=>q[0]!==myPid).map(q=>{ const pa=a.rows.find(z=>z[0]===q[0])||q;
      const L=(i,dflt=0)=>{ const u=pa[i]??dflt, v=q[i]??dflt; return Math.abs(v-u)>12?v:u+(v-u)*k; };   // big jumps (respawn) snap
      return { pid:q[0], d:L(1), x:L(2), fin:!!q[3], y:L(4), a:q[5]|0 }; });
  }

  // ---- input (keyboard only; the page fills this) ----
  W.input={ mx:0, mz:0, jump:false, press:false };   // jump = Space held · press = Space just pressed (edge → dive)

  function resize(){ const w=innerWidth, h=innerHeight; R.setSize(w,h,false); cam.aspect=w/h; cam.fov=w<h?72:58; cam.updateProjectionMatrix(); }
  addEventListener("resize",resize); resize();

  const tmpV=new THREE.Vector3();
  // physics runs at a fixed DT; draw my bean and the bots BETWEEN the last two steps (alpha) so they glide
  // instead of stuttering when a frame gets 0 or 2 physics steps.
  function lerpSt(st,alpha){
    const p=st.prevPos; if (!p) return st;
    const far=Math.abs(st.d-p.d)>3||Math.abs(st.x-p.x)>3||Math.abs(st.y-p.y)>3;   // respawn teleport: no smear
    const k=far?1:alpha;
    return { d:p.d+(st.d-p.d)*k, x:p.x+(st.x-p.x)*k, y:p.y+(st.y-p.y)*k, a:st.a, vy:st.vy, vx:st.vx, vd:st.vd, bonk:st.bonk, dive:st.dive };
  }
  function placeBean(b,s, dt, t, full, prev){
    const { d,x,y,a,vy }=s;
    b.root.position.set(x,y,-d);
    const own=s.vx!=null;                                 // my bean / a bot: real velocity, not frame deltas
    const dx=own?s.vx:x-prev.x, dd=own?s.vd:d-prev.d;
    const sp=own?Math.hypot(dx,dd):Math.hypot(dx,dd)/Math.max(dt,1e-3);
    // face where you're going (bonked beans keep facing forward while they bounce back; ghosts need a clear move)
    const bonked=own&&s.bonk>0;
    if (a===5){ let dy=-b.yaw; dy=Math.atan2(Math.sin(dy),Math.cos(dy)); b.yaw+=dy*Math.min(1,dt*6); }   // solving: face the veil
    else if (sp>(own?0.8:2.2) && a!==3 && !bonked){ const yaw=Math.atan2(-dx,dd); let dy=yaw-b.yaw; dy=Math.atan2(Math.sin(dy),Math.cos(dy)); b.yaw+=dy*Math.min(1,dt*(a===4?16:own?12:6)); }
    b.root.rotation.y=b.yaw;
    animBean(b,{ a, speed:a===1?Math.min(T.run,sp):0, vy, dt, t, full });
    prev.x=x; prev.d=d;
    // "?" bubble over other beans that are answering a veil
    const ask=a===5&&b!==(W.me&&W.me.bean);
    if (ask&&!b.q){ b.q=qBubble(); b.root.add(b.q); }
    if (b.q){ b.q.visible=ask; if (ask){ const ly=b.label?b.label.position.y+b.label.scale.y/2+0.45:2.6; b.q.position.y=ly+Math.sin(t*3+b.color)*0.08; } }
    const g=S.groundAt(W.course,d,x,W.mt,y);
    if (g>-50 && a!==3){ const hgt=Math.max(0,y-g), s=Math.max(0.35,1.15-hgt*0.12); b.shadow.visible=true; b.shadow.position.set(x,g+0.03,-d); b.shadow.scale.set(s,1,s); b.shadow.material.opacity=1; }
    else b.shadow.visible=false;
  }
  // course animation: belts scroll, pads pulse (ferry pads glow when it's safe to go), veils shimmer/fade, jelly wobbles, flags
  function animCourse(dt,t,mt){
    const c=W.course;
    for (const b of CR.belts) b.t.offset.y=-(mt*b.sp/b.tile)%1;
    for (const p of CR.pads){ let e;
      if (p.p.wait){ const ok=S.padReady(c,p.p,mt+0.35); e=ok?0.9+0.25*Math.sin(t*9):0.08; p.mat.color.set(ok?"#ffffff":"#b9a57a"); }
      else e=0.35+0.2*Math.sin(t*4+p.ph);
      p.mat.emissiveIntensity=e; p.side.emissiveIntensity=e*0.6; }
    for (const v of CR.veils){ v.on+=(v.target-v.on)*(1-Math.exp(-dt*4)); v.mat.uniforms.time.value=t; v.mat.uniforms.fade.value=v.on;
      v.q.material.opacity=Math.max(0,(v.on-0.3)/0.7); v.q.visible=v.on>0.32; v.q.position.y=5.6+Math.sin(t*1.6+v.v.k)*0.25; }
    if (W.me) for (const f of CR.flags) if (!f.got&&W.me.st.cp>=f.i){ f.got=true; f.mat.color.set("#ffcf33"); f.mat.emissive.set("#7a5200"); }
    for (const f of CR.flags) f.f.rotation.y=-0.5+Math.sin(t*2.2+f.i)*0.25;
    // jelly: closed panels wobble when hit, open ones wobble as someone passes (and pop away once I go through)
    if (CR.panels.length){
      const who=[]; if (W.me) who.push([W.me.st,true]); for (const b of W.bots) who.push([b.st,false]); for (const r of W.rows||[]) who.push([r,false]);
      for (const [s,me] of who){ if (s.jhit){ const P=CR.panels.find(p=>p.q===s.jhit); if (P) P.wob=1; s.jhit=null; } }
      for (const P of CR.panels){ const q=P.q;
        for (const [s,me] of who){ if (Math.abs(s.d-(q.d0+q.d1)/2)<0.7&&s.x>q.x0&&s.x<q.x1&&s.y<q.top){ if (q.open){ P.wob=Math.max(P.wob,0.7); if (me&&s.d>(q.d0+q.d1)/2) P.popped=true; } else if (!me&&s.a!==3) P.wob=Math.max(P.wob,0.4); } }
        P.wob*=Math.exp(-dt*3); if (P.popped) P.pop=Math.min(1,P.pop+dt*4);
        const w=Math.sin(t*22)*P.wob, s=1-P.pop;
        P.m.visible=s>0.02; P.m.scale.set((1+0.06*w)*Math.max(0.02,s),(1-0.05*w)*Math.max(0.02,s),1+0.9*Math.abs(w)); }
    }
    for (const s of CR.floaters) s.o.position.y=Math.sin(t*0.5+s.ph)*(s.cloud?0.6:1.2), s.cloud&&(s.o.position.x=Math.sin(t*0.03)*25);
  }

  // ============================================================
  //  FRAME
  // ============================================================
  W.frame=(now)=>{
    const dt=Math.min(0.1,(now-W.lastNow)/1000); W.lastNow=now; const t=now/1000;
    W.mt=W.mode==="race"?Math.max(0,(now-W.moverT0)/1000):t;
    const evs=[];
    if (W.mode==="race"){
      const racing=now>=W.startAt;
      W.acc+=dt; let n=0;
      while (W.acc>=DT && n<6){ W.acc-=DT; n++;
        const mt=Math.max(0,(now-W.moverT0)/1000-W.acc);
        placeMovers(mt); world.step();
        for (const s of [W.me&&W.me.st,...W.bots.map(b=>b.st)]) if (s) s.prevPos={ d:s.d, x:s.x, y:s.y };
        if (W.me){ const ev=[]; const inp=racing&&!W.me.st.fin?W.input:{ mx:0, mz:0, jump:false };
          stepBean(W.me.st,W.me.col,inp,mt,ev); W.input.press=false; for (const e of ev) W.onEvent(e,W.me.pid,W.me.st); }
        for (const b of W.bots){ const ev=[]; const inp=racing&&!b.st.fin?S.botInput(b.brain,b.st,mt,DT):{ mx:0, mz:0, jump:false };
          stepBean(b.st,b.col,inp,mt,ev,b.brain); for (const e of ev) W.onEvent(e,b.pid,b.st); }
      }
      if (n===6) W.acc=0;
      // draw: me, bots (full anim), ghosts (full for the nearest 12)
      const focus=W.me?W.me.st:W.lead||{ d:0, x:0, y:0 };
      const alpha=Math.min(1,W.acc/DT);
      if (W.me) placeBean(W.me.bean,lerpSt(W.me.st,alpha),dt,t,true,W.me.prev);
      for (const b of W.bots){ b.prev=b.prev||{ x:b.st.x, d:b.st.d }; placeBean(b.bean,lerpSt(b.st,alpha),dt,t,true,b.prev); }
      const rows=ghostRows(now), seen=new Set();
      rows.sort((p,q)=>Math.abs(p.d-focus.d)-Math.abs(q.d-focus.d));
      rows.forEach((r,i)=>{ seen.add(r.pid); let g=W.ghosts.get(r.pid);
        if (!g){ const pl=W.players.get(r.pid); g={ bean:makeBean(pl?pl.color:0,{ ghost:!W.teacher, name:pl?pl.name:"" }), prev:{ x:r.x, d:r.d } };
          if (W.teacher) g.bean.setLabel(pl?pl.name:"",2.2); addBean(g.bean); W.ghosts.set(r.pid,g); }
        placeBean(g.bean,r,dt,t,i<12,g.prev); if (g.bean.label) g.bean.label.visible=W.teacher||i<12; });
      for (const [pid,g] of W.ghosts) if (!seen.has(pid)){ g.bean.dispose(); W.ghosts.delete(pid); }
      W.rows=rows;
      // camera: fixed orientation, follows forward/sideways smoothly, never rotates
      if (W.me){
        const st=lerpSt(W.me.st,alpha), fy=W.me.st.fallen>0?Math.max(-1,st.y):Math.max(-1.5,st.y);
        // centred on the bean left/right (tight), higher and steeper than a plain chase cam; height eases slower
        // so jumps don't bob the whole view
        const kx=1-Math.exp(-dt*14), kz=1-Math.exp(-dt*(W.me.st.fallen>0?2:8)), ky=1-Math.exp(-dt*(W.me.st.fallen>0?2:4));
        W.camPos.x+=(st.x-W.camPos.x)*kx; W.camPos.y+=(fy+8.4-W.camPos.y)*ky; W.camPos.z+=(-st.d+9-W.camPos.z)*kz;
        cam.rotation.set(-0.66,0,0);
      } else {
        // teacher drone: high, slowly following the leading pack (median of the front half)
        const ds=rows.map(r=>r.d).sort((a,b)=>b-a), half=ds.slice(0,Math.max(1,Math.ceil(ds.length/2)));
        const target=half.length?half[Math.floor(half.length/2)]:0;
        tmpV.set(0,20,-target+17); W.camPos.lerp(tmpV,1-Math.exp(-dt*0.9)); cam.rotation.set(-0.78,0,0);
      }
      cam.position.copy(W.camPos);
    } else {
      // menu backdrop: a slow fly-over of the course
      placeMovers(W.mt);
      const d=(t*5)%(W.course.length+10)-5; tmpV.set(Math.sin(t*0.2)*3,11,-d+14); W.camPos.lerp(tmpV,0.05); cam.position.copy(W.camPos); cam.rotation.set(-0.46,0,0);
    }
    animCourse(dt,t,W.mt);
    sky.position.copy(cam.position); goo.position.x=cam.position.x; goo.position.z=cam.position.z;
    R.render(scene,cam);
    return evs;
  };
  // solo: run the bots on (no rendering) until they finish or maxT race-seconds pass. Used after you finish.
  W.fastForwardBots=(fromT,maxT,onFin)=>{
    let mt=fromT; const ev=[];
    while (mt<maxT && W.bots.some(b=>!b.st.fin)){ mt+=DT; placeMovers(mt); world.step();
      for (const b of W.bots){ if (b.st.fin) continue; ev.length=0; stepBean(b.st,b.col,S.botInput(b.brain,b.st,mt,DT),mt,ev,b.brain); if (ev.includes("finish")) onFin(b,mt); } }
    return mt;
  };
  onProgress(1);
  return W;
}
