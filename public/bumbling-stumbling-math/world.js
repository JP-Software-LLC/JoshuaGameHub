// Bumbling Stumbling Math — the 3D world: scene, course, beans, Rapier physics, camera.
// Loaded by index.html with a dynamic import() (after the vendored files have been prefetched for the progress bar).
// Course coordinates (shared/stumble.js): d = metres forward, x = sideways, y = height.  World: X = x, Y = y, Z = -d.
// The page owns rules/HUD/network; this module owns everything you see and the physics of your own bean (+ solo bots).
import * as THREE from "three";
import { mergeGeometries } from "../assets/vendor/three/addons/utils/BufferGeometryUtils.js";
import RAPIER from "../assets/vendor/rapier/rapier.es.js";

const S=window.STUMBLE, T=S.T, C=S.COURSE;
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
// a: 0 idle · 1 run · 2 air · 3 fallen. full=false → cheap animation (far beans).
function animBean(b,{ a, speed, vy, dt, t, full }){
  const p=b.pivot;
  if (a===3){ b.spin+=dt*11; p.rotation.set(b.spin,0,b.spin*0.6); const s=Math.max(0.05,p.scale.x-dt*0.9); p.scale.set(s,s,s); p.position.y=0; return; }
  if (b.spin){ b.spin=0; p.rotation.set(0,0,0); p.scale.set(0.2,0.2,0.2); b.squash=-0.4; }        // pop back in after a respawn
  const run=Math.min(1,speed/T.run);
  b.phase+=dt*(4+speed*1.9);
  if (!full){ p.position.y=a===1?Math.abs(Math.sin(b.phase))*0.15:0; p.rotation.set(-0.2*run,0,0); p.scale.set(1,1,1); return; }
  b.squash*=Math.exp(-dt*9);
  let sy=1, lean=0, roll=0, y=0;
  if (a===1){ y=Math.abs(Math.sin(b.phase))*0.2; sy=1+0.07*Math.cos(b.phase*2); lean=-0.28*run; roll=Math.sin(b.phase)*0.16; }
  else if (a===2){ sy=1+Math.max(-0.12,Math.min(0.16,(vy||0)*0.02)); lean=-0.15*run; roll=Math.sin(t*9+b.color)*0.08; }
  else { sy=1+0.035*Math.sin(t*3.2+b.color); roll=Math.sin(t*1.7+b.color)*0.05; }
  sy-=b.squash*0.5;
  const sx=1/Math.sqrt(Math.max(0.4,sy));
  const grow=Math.min(1,p.scale.x<0.99&&!b.spin?p.scale.x+dt*5:1);
  p.position.y=y; p.rotation.set(lean,0,roll); p.scale.set(sx*grow,sy*grow,sx*grow);
}

// ============================================================
//  WORLD
// ============================================================
export async function createWorld({ canvas, onProgress=()=>{} }){
  await RAPIER.init(); onProgress(0.88);
  const R=new THREE.WebGLRenderer({ canvas, antialias:(devicePixelRatio||1)<1.5, powerPreference:"high-performance" });
  R.setPixelRatio(Math.min(1.5,devicePixelRatio||1));
  const scene=new THREE.Scene();
  const FOG=new THREE.Color("#c9b8ff"); scene.fog=new THREE.Fog(FOG,70,190);
  const cam=new THREE.PerspectiveCamera(58,1,0.1,600); cam.rotation.order="YXZ";
  scene.add(new THREE.HemisphereLight("#e9e3ff","#6d3fd6",1.9));
  const sun=new THREE.DirectionalLight("#fff6e8",1.9); sun.position.set(-6,14,6); scene.add(sun);

  // ---- sky dome (vertical gradient) + the purple goo far below ----
  {
    const g=new THREE.SphereGeometry(400,24,12);
    const m=new THREE.ShaderMaterial({ side:THREE.BackSide, depthWrite:false, fog:false,
      uniforms:{ top:{ value:new THREE.Color("#3b2bd6") }, mid:{ value:new THREE.Color("#8f7dff") }, low:{ value:new THREE.Color("#ffb3e6") } },
      vertexShader:"varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:"uniform vec3 top,mid,low; varying vec3 vP; void main(){ float h=normalize(vP).y; vec3 c=h>0.12?mix(mid,top,smoothstep(0.12,0.75,h)):mix(low,mid,smoothstep(-0.25,0.12,h)); gl_FragColor=vec4(c,1.0); }" });
    const sky=new THREE.Mesh(g,m); sky.renderOrder=-10; scene.add(sky); scene.userData.sky=sky;
    const goo=new THREE.Mesh(new THREE.PlaneGeometry(900,900).rotateX(-Math.PI/2),new THREE.MeshLambertMaterial({ color:"#a855f7", emissive:"#5b21b6" }));
    goo.position.y=-14; scene.add(goo); scene.userData.goo=goo;
  }

  // ---- textures ----
  const texCache=new Map();
  function stripes(a,b,n=2,dir="v"){
    const k=a+b+n+dir; if (texCache.has(k)) return texCache.get(k);
    const cv=document.createElement("canvas"); cv.width=cv.height=64; const x=cv.getContext("2d");
    for (let i=0;i<n;i++){ x.fillStyle=i%2?b:a; if (dir==="v") x.fillRect(0,i*64/n,64,64/n); else x.fillRect(i*64/n,0,64/n,64); }
    x.fillStyle="rgba(255,255,255,.18)"; if (dir==="v") x.fillRect(0,0,64,3); else x.fillRect(0,0,3,64);
    const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=4; texCache.set(k,t); return t;
  }
  const PAL={
    main:{ top:["#8b5cf6","#a78bfa"], side:"#6d28d9" },
    alt:{ top:["#3b82f6","#6aa5ff"], side:"#1d4ed8" },
    edge:{ top:["#ff5fb7","#ffffff"], side:"#ec4899" },
    block:{ top:["#22d3ee","#a5f3fc"], side:"#0891b2" },
    mover:{ top:["#f0abfc","#ffffff"], side:"#c026d3" },
  };
  function boxMesh(b,key){
    const P=PAL[key]||PAL.main, len=b.d1-b.d0, w=b.x1-b.x0;
    const top=stripes(P.top[0],P.top[1],2,key==="edge"?"v":"v").clone(); top.needsUpdate=true;
    top.repeat.set(key==="edge"?1:Math.max(1,Math.round(w/3.5)),Math.max(1,Math.round(len/(key==="edge"?1.6:3.5))));
    const side=new THREE.MeshLambertMaterial({ color:P.side });
    const mats=[side,side,new THREE.MeshLambertMaterial({ map:top }),side,side,side];
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,b.h,len),mats);
    m.position.set((b.x0+b.x1)/2,b.top-b.h/2,-(b.d0+b.d1)/2); return m;
  }

  // static boxes are batched: per colour key ONE striped top mesh + ONE side mesh (few draw calls on Chromebooks)
  const batch=new Map();
  function addBox(b,key){
    const len=b.d1-b.d0, w=b.x1-b.x0, cx=(b.x0+b.x1)/2, cz=-(b.d0+b.d1)/2;
    const rx=key==="edge"?1:Math.max(1,Math.round(w/3.5)), ry=Math.max(1,Math.round(len/(key==="edge"?1.6:3.5)));
    const top=new THREE.PlaneGeometry(w,len).rotateX(-Math.PI/2).translate(cx,b.top+0.004,cz);
    const uv=top.attributes.uv; for (let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*rx,uv.getY(i)*ry);
    const side=new THREE.BoxGeometry(w,b.h,len).translate(cx,b.top-b.h/2,cz); side.deleteAttribute("uv");
    top.deleteAttribute("normal"); top.setAttribute("normal",new THREE.Float32BufferAttribute(new Array(uv.count).fill([0,1,0]).flat(),3));
    if (!batch.has(key)) batch.set(key,{ tops:[], sides:[] }); const B=batch.get(key); B.tops.push(top); B.sides.push(side);
  }
  function flushBoxes(parent){
    for (const [key,B] of batch){ const P=PAL[key]||PAL.main;
      parent.add(new THREE.Mesh(mergeGeometries(B.tops),new THREE.MeshLambertMaterial({ map:stripes(P.top[0],P.top[1],2,"v") })));
      parent.add(new THREE.Mesh(mergeGeometries(B.sides),new THREE.MeshLambertMaterial({ color:P.side }))); }
    batch.clear();
  }

  // ---- physics world ----
  const world=new RAPIER.World({ x:0, y:-T.gravity, z:0 });
  const kcc=world.createCharacterController(0.02);
  kcc.enableSnapToGround(0.3); kcc.enableAutostep(0.3,0.15,false); kcc.setMaxSlopeClimbAngle(50*Math.PI/180); kcc.setSlideEnabled(true);
  kcc.setApplyImpulsesToDynamicBodies(false);
  const BEAN_GROUPS=0x00020001;          // membership 2, collides with the course (1) only: beans never touch each other
  const course=new THREE.Group(); scene.add(course);
  const solid=b=>{ world.createCollider(RAPIER.ColliderDesc.cuboid((b.x1-b.x0)/2,b.h/2,(b.d1-b.d0)/2).setTranslation((b.x0+b.x1)/2,b.top-b.h/2,-(b.d0+b.d1)/2)); };
  for (const b of C.FLOORS){ solid(b); addBox(b,b.c); }
  for (const b of C.BLOCKS){ solid(b); addBox(b,b.top<0.9?"edge":"block"); }
  for (const b of C.RAILS){ solid(b); addBox(b,"edge"); }
  flushBoxes(course);
  // invisible end wall + side walls high up so nobody runs off the end of the world
  solid({ d0:T.dist+15, d1:T.dist+16, x0:-8, x1:8, top:6, h:6 });
  onProgress(0.92);
  // moving platforms (kinematic bodies driven by race time)
  const movers=C.MOVERS.map(m=>{
    const p=S.moverPos(m,0);
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x,p.top-m.h/2,-p.d));
    world.createCollider(RAPIER.ColliderDesc.cuboid(m.w/2,m.h/2,m.len/2),body);
    const mesh=boxMesh({ d0:-m.len/2, d1:m.len/2, x0:-m.w/2, x1:m.w/2, top:m.h/2, h:m.h },"mover"); mesh.position.set(0,0,0);
    const g=new THREE.Group(); g.add(mesh);
    // glowing rim + little arrow so it reads as "ride me"
    const rim=new THREE.Mesh(new THREE.BoxGeometry(m.w+0.3,0.18,m.len+0.3),new THREE.MeshBasicMaterial({ color:"#fff3a8" })); rim.position.y=-m.h/2+0.05; g.add(rim);
    course.add(g); return { m, body, g };
  });
  function placeMovers(t){ for (const v of movers){ const p=S.moverPos(v.m,t); v.body.setNextKinematicTranslation({ x:p.x, y:p.top-v.m.h/2, z:-p.d }); v.g.position.set(p.x,p.top-v.m.h/2,-p.d); } }
  placeMovers(0); world.step();

  // ---- arches: start, checkpoints, finish ----
  function bannerTex(text,bg,fg,checker){
    const cv=document.createElement("canvas"); cv.width=512; cv.height=96; const x=cv.getContext("2d");
    if (checker){ for (let i=0;i<32;i++) for (let j=0;j<6;j++){ x.fillStyle=(i+j)%2?"#1b1440":"#ffffff"; x.fillRect(i*16,j*16,16,16); } x.fillStyle=bg; x.fillRect(70,8,372,80); }
    else { x.fillStyle=bg; x.fillRect(0,0,512,96); }
    x.font="64px 'Lilita One', system-ui, sans-serif"; x.textAlign="center"; x.textBaseline="middle";
    x.lineWidth=10; x.strokeStyle="rgba(40,10,90,.85)"; x.strokeText(text,256,52); x.fillStyle=fg; x.fillText(text,256,52);
    const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; return t;
  }
  function arch(d,text,{ bg="#7c3aed", fg="#ffcf33", checker=false, w=C.W+0.6, h=8.6, pillar="#ff5fb7" }={}){
    const g=new THREE.Group(); g.position.z=-d;
    const pm=new THREE.MeshLambertMaterial({ map:stripes(pillar,"#ffffff",4,"v") });
    for (const s of [-1,1]){ const p=new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.55,h,10),pm); p.position.set(s*w,h/2,0); g.add(p);
      const ball=new THREE.Mesh(new THREE.SphereGeometry(0.7,12,8),new THREE.MeshLambertMaterial({ color:"#ffcf33", emissive:"#7a5200" })); ball.position.set(s*w,h+0.4,0); g.add(ball); }
    const ban=new THREE.Mesh(new THREE.BoxGeometry(w*2,2.1,0.35),new THREE.MeshLambertMaterial({ color:bg })); ban.position.y=h-0.5; g.add(ban);
    const face=new THREE.Mesh(new THREE.PlaneGeometry(w*2,2.1),new THREE.MeshBasicMaterial({ map:bannerTex(text,bg,fg,checker) })); face.position.set(0,h-0.5,0.18); g.add(face);
    scene.add(g); return g;
  }
  arch(0,"START",{ bg:"#2563eb" });
  for (const cp of C.CHECKPOINTS.slice(1)){
    arch(cp,"CHECKPOINT",{ bg:"#9333ea", pillar:"#22d3ee" });
    const strip=new THREE.Mesh(new THREE.PlaneGeometry(C.W*2,0.7).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({ color:"#fff3a8", transparent:true, opacity:0.85 }));
    strip.position.set(0,S.groundAt(cp,0,0)+0.03,-cp); scene.add(strip);
  }
  const finishArch=arch(T.dist,"FINISH",{ bg:"#ff3d9a", fg:"#ffffff", checker:true, h:9 });
  { const fl=new THREE.Mesh(new THREE.PlaneGeometry(C.W*2,1.2).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({ map:(()=>{ const t=stripes("#ffffff","#1b1440",8,"h").clone(); t.needsUpdate=true; t.repeat.set(3,1); return t; })() }));
    fl.position.set(0,0.03,-T.dist); scene.add(fl); }

  // ---- decoration: candy islands, rings, clouds, lollipops (deterministic) ----
  const deco=new THREE.Group(); scene.add(deco); const spinners=[], floaters=[];
  {
    const r=S.rng(1234);
    const cols=["#f472b6","#22d3ee","#a78bfa","#60a5fa","#facc15","#fb7185","#34d399"];
    // bake many small decorations into a few vertex-coloured meshes (one draw call each)
    const tint=(g,col)=>{ g=g.index?g.toNonIndexed():g.clone(); const c=new THREE.Color(col), n=g.attributes.position.count, a=new Float32Array(n*3);
      for (let i=0;i<n;i++){ a[i*3]=c.r; a[i*3+1]=c.g; a[i*3+2]=c.b; } g.setAttribute("color",new THREE.BufferAttribute(a,3)); return g; };
    const place=(g,{ x=0,y=0,z=0,sx=1,sy=1,sz=1,ry=0 })=>g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,ry,0)),new THREE.Vector3(sx,sy,sz)));
    const solidParts=[], cloudParts=[], popParts=[];
    const ringGeo=new THREE.TorusGeometry(3.2,0.55,8,24);
    for (let i=0;i<8;i++){ const ring=new THREE.Mesh(ringGeo,new THREE.MeshLambertMaterial({ color:cols[i%cols.length], emissive:cols[i%cols.length], emissiveIntensity:0.25 }));
      ring.position.set((i%2?1:-1)*(15+r()*6),3+r()*5,-(i*22+5)); ring.rotation.y=r()*3; deco.add(ring); spinners.push(ring); }
    const isl=new THREE.CylinderGeometry(1,0.25,1,7), cap=new THREE.SphereGeometry(1,8,6,0,Math.PI*2,0,Math.PI/2);
    for (let i=0;i<26;i++){ const s=2+r()*5, side=i%2?1:-1, x=side*(24+r()*50), y=-10+r()*16, z=-(r()*(T.dist+60)-20);
      solidParts.push(place(tint(isl,"#7c3aed"),{ x, y:y-s*0.7, z, sx:s, sy:s*1.4, sz:s }), place(tint(cap,cols[(i*3)%cols.length]),{ x, y, z, sx:s*1.05, sy:s*0.45, sz:s*1.05 })); }
    const cloudGeo=new THREE.IcosahedronGeometry(1,0);
    for (let i=0;i<22;i++){ const s=2+r()*3, x=(r()*2-1)*90, y=14+r()*26, z=-(r()*(T.dist+120)-40);
      for (let k=0;k<4;k++){ const q=s*(0.6+r()*0.6); cloudParts.push(place(tint(cloudGeo,"#ffffff"),{ x:x+(k-1.5)*s*0.9, y:y+r()*s*0.4, z:z+r()*s*0.5, sx:q, sy:q, sz:q })); } }
    const stick=new THREE.CylinderGeometry(0.25,0.25,1,6), pop=new THREE.CylinderGeometry(1,1,0.5,16).rotateX(Math.PI/2);
    for (let i=0;i<14;i++){ const h=10+r()*14, c=cols[i%cols.length], x=(i%2?1:-1)*(15+r()*8), y=-4+r()*6, z=-(i*12+r()*6), q=2.2+r()*1.5;
      solidParts.push(place(tint(stick,"#ffffff"),{ x, y:y-h/2, z, sy:h }));
      popParts.push(place(tint(pop,c),{ x, y, z, sx:q, sy:q, sz:q, ry:(r()-0.5)*0.8 })); }
    const solidMesh=new THREE.Mesh(mergeGeometries(solidParts),new THREE.MeshLambertMaterial({ vertexColors:true, flatShading:true })); deco.add(solidMesh);
    const clouds=new THREE.Mesh(mergeGeometries(cloudParts),new THREE.MeshLambertMaterial({ vertexColors:true, emissive:"#d8ccff", emissiveIntensity:0.45, flatShading:true })); deco.add(clouds);
    const pops=new THREE.Mesh(mergeGeometries(popParts),new THREE.MeshLambertMaterial({ vertexColors:true, map:stripes("#ffffff","#b9b4d6",6,"h") })); deco.add(pops);
    floaters.push({ o:solidMesh, y:0, ph:0 }, { o:pops, y:0, ph:2 }, { o:clouds, y:0, ph:1, cloud:true });
  }
  onProgress(0.96);

  // ============================================================
  //  BEANS IN PHYSICS (my bean + solo bots)
  // ============================================================
  function makeBody(st){
    const c=world.createCollider(RAPIER.ColliderDesc.capsule(T.halfH,T.radius).setCollisionGroups(BEAN_GROUPS).setTranslation(st.x,st.y+T.halfH+T.radius,-st.d));
    return c;
  }
  // st: { d,x,y, vd,vx,vy, grounded, air, coyote, jbuf, cp, falls, fallen, fin, bonk, landed }
  function newState(i){ const sp=S.spawn(i); return { d:sp.d, x:sp.x, y:0, vd:0, vx:0, vy:0, grounded:true, coyote:0, jbuf:0, cp:0, falls:0, fallen:0, fin:false, bonk:0, landed:0, a:0, spIdx:i }; }
  const moverUnder=(st,t)=>{ for (const v of movers){ const p=S.moverPos(v.m,t); if (Math.abs(st.d-p.d)<=v.m.len/2+0.3 && Math.abs(st.x-p.x)<=v.m.w/2+0.3 && Math.abs(st.y-p.top)<0.25) return v; } return null; };
  // one fixed physics step for one bean. inp = { mx, mz, jump(bool, edge) }. Returns an event string or "".
  function stepBean(st,col,inp,mt,ev){
    if (st.fallen>0){ st.fallen-=DT; st.a=3;
      if (st.fallen<=0){ const cp=C.CHECKPOINTS[st.cp], g=Math.max(0,S.groundAt(cp+1,0,mt));
        Object.assign(st,{ d:cp+1.2, x:((st.spIdx%5)-2)*1.3, y:g+1.6, vd:0, vx:0, vy:0, grounded:false });
        col.setTranslation({ x:st.x, y:st.y+T.halfH+T.radius, z:-st.d }); ev.push("respawn"); }
      return; }
    let mx=inp.mx, mz=inp.mz; const l=Math.hypot(mx,mz); if (l>1){ mx/=l; mz/=l; }
    if (st.bonk>0){ st.bonk-=DT; mx*=0.2; mz*=0.2; }
    const tvx=mx*T.run, tvd=mz*T.run, acc=st.grounded?(l>0.05?T.accel:T.friction):T.airAccel;
    const ap=(v,tv)=>{ const dv=tv-v, m=acc*DT; return v+Math.max(-m,Math.min(m,dv)); };
    st.vx=ap(st.vx,tvx); st.vd=ap(st.vd,tvd);
    // jump (coyote time + input buffer)
    st.coyote=st.grounded?T.coyote:Math.max(0,st.coyote-DT);
    st.jbuf=inp.jump?T.jumpBuffer:Math.max(0,st.jbuf-DT);
    let jumped=false;
    if (st.jbuf>0 && st.coyote>0){ st.vy=T.jumpV; st.jbuf=0; st.coyote=0; st.grounded=false; jumped=true; ev.push("jump"); }
    st.vy-=T.gravity*DT; if (st.vy<-30) st.vy=-30;
    // ride the moving platform
    let cx=0, cd=0; const mv=st.grounded&&!jumped?moverUnder(st,mt-DT):null;
    if (mv){ const a=S.moverPos(mv.m,mt-DT), b=S.moverPos(mv.m,mt); cx=b.x-a.x; cd=b.d-a.d; }
    const want={ x:st.vx*DT+cx, y:st.vy*DT, z:-(st.vd*DT+cd) };
    kcc.computeColliderMovement(col,want,undefined,BEAN_GROUPS);
    const got=kcc.computedMovement(), wasG=st.grounded;
    st.grounded=kcc.computedGrounded() && st.vy<=0.01;
    st.x+=got.x; st.y+=got.y; st.d-=got.z;
    col.setTranslation({ x:st.x, y:st.y+T.halfH+T.radius, z:-st.d });
    if (st.grounded){ if (!wasG && st.airT>0.15){ st.landed=Math.min(1,-st.vy/14); ev.push("land"); } st.vy=0; st.airT=0; }
    else { st.airT=(st.airT||0)+DT; if (st.vy>0 && got.y<want.y*0.5) st.vy=0; }                         // bumped the head
    // run into a wall at speed → bonk back (the "stumbling")
    const wh=Math.hypot(want.x-cx,want.z+cd), gh=((got.x-cx)*(want.x-cx)+(got.z+cd)*(want.z+cd))/(wh*wh||1);
    let wall=false;
    if (wh>T.run*DT*0.75 && gh<0.25 && st.bonk<=0) for (let i=0,n=kcc.numComputedCollisions();i<n;i++){
      const c=kcc.computedCollision(i); if (!c) continue; const nn=c.normal1;
      if (Math.abs(nn.y)<0.35 && Math.abs(nn.x*(want.x-cx)+nn.z*(want.z+cd))>0.6*wh) wall=true; }
    if (wall){ st.vx*=-0.55; st.vd*=-0.55; st.bonk=0.38; ev.push("bonk"); }
    // checkpoints, finish, falling
    if (st.grounded) for (let i=st.cp+1;i<C.CHECKPOINTS.length;i++) if (st.d>=C.CHECKPOINTS[i]){ st.cp=i; ev.push("checkpoint"); }
    if (!st.fin && st.d>=T.dist){ st.fin=true; ev.push("finish"); }
    if (st.y<T.killY){ st.fallen=T.respawnT; st.falls++; st.vx=st.vd=st.vy=0; ev.push("fall"); }
    const sp=Math.hypot(st.vx,st.vd);
    st.a=st.fallen>0?3:!st.grounded?2:sp>0.6?1:0;
  }

  // ============================================================
  //  STATE: my bean, bots, ghosts (online relay), camera
  // ============================================================
  const W={ R, scene, cam, mode:"menu", me:null, bots:[], ghosts:new Map(), snaps:[], players:new Map(), acc:0, mt:0,
    teacher:false, onEvent:()=>{}, camPos:new THREE.Vector3(0,8,12), lastNow:performance.now() };
  function clearBeans(){
    if (W.me){ W.me.bean.dispose(); world.removeCollider(W.me.col,false); W.me=null; }
    for (const b of W.bots){ b.bean.dispose(); world.removeCollider(b.col,false); }
    W.bots=[]; for (const g of W.ghosts.values()) g.bean.dispose(); W.ghosts.clear(); W.snaps=[];
  }
  function addBean(b){ scene.add(b.root); scene.add(b.shadow); }
  // race setup. me = { pid, color, name } or null (teacher). moverT0 = performance.now() at race time 0.
  W.startRace=({ me, players, teacher=false, moverT0, startAt })=>{
    clearBeans(); W.mode="race"; W.teacher=teacher; W.moverT0=moverT0; W.startAt=startAt; W.acc=0;
    W.players=new Map(players.map(p=>[p.pid,p]));
    if (me){ const st=newState(me.color); const bean=makeBean(me.color,{ name:"YOU", me:true }); addBean(bean);
      W.me={ pid:me.pid, st, col:makeBody(st), bean, prev:{ x:st.x, d:st.d } }; W.camPos.set(st.x*0.6,6,-st.d+10); }
    else W.camPos.set(0,22,18);
  };
  W.addBot=({ pid, color, name, skill, seed })=>{
    const st=newState(color), bean=makeBean(color,{ name }); addBean(bean);
    W.bots.push({ pid, st, col:makeBody(st), bean, brain:S.makeBot(seed,skill) });
  };
  W.menu=()=>{ clearBeans(); W.mode="menu"; };
  W.pushSnap=rows=>{ W.snaps.push({ t:performance.now(), rows }); if (W.snaps.length>30) W.snaps.shift(); };
  W.setPlayer=p=>W.players.set(p.pid,p);
  // respawn at a known point (rejoin)
  W.placeMe=(d,fin)=>{ const m=W.me; if (!m) return; let cp=0; C.CHECKPOINTS.forEach((c,i)=>{ if (c<=d) cp=i; });
    Object.assign(m.st,{ cp, d:C.CHECKPOINTS[cp]+1.2, x:0, y:1, fin:!!fin }); m.col.setTranslation({ x:0, y:1+T.halfH+T.radius, z:-m.st.d }); };

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
  W.input={ mx:0, mz:0, jump:false };

  function resize(){ const w=innerWidth, h=innerHeight; R.setSize(w,h,false); cam.aspect=w/h; cam.fov=w<h?72:58; cam.updateProjectionMatrix(); }
  addEventListener("resize",resize); resize();

  const tmpV=new THREE.Vector3();
  function placeBean(b,s, dt, t, full, prev){
    const { d,x,y,a,vy }=s;
    b.root.position.set(x,y,-d);
    const dx=x-prev.x, dd=d-prev.d, sp=Math.hypot(dx,dd)/Math.max(dt,1e-3);
    // face where you're going (bonked beans keep facing forward while they bounce back; ghosts need a clear move)
    const own=s.bonk!=null, bonked=own&&s.bonk>0;
    if (sp>(own?0.8:2.2) && a!==3 && !bonked){ const yaw=Math.atan2(-dx,dd); let dy=yaw-b.yaw; dy=Math.atan2(Math.sin(dy),Math.cos(dy)); b.yaw+=dy*Math.min(1,dt*(own?12:6)); }
    b.root.rotation.y=b.yaw;
    animBean(b,{ a, speed:a===1?Math.min(T.run,sp):0, vy, dt, t, full });
    prev.x=x; prev.d=d;
    const g=S.groundAt(d,x,W.mt,y);
    if (g>-50 && a!==3){ const hgt=Math.max(0,y-g), s=Math.max(0.35,1.15-hgt*0.12); b.shadow.visible=true; b.shadow.position.set(x,g+0.03,-d); b.shadow.scale.set(s,1,s); b.shadow.material.opacity=1; }
    else b.shadow.visible=false;
  }

  // ============================================================
  //  FRAME
  // ============================================================
  W.frame=(now)=>{
    const dt=Math.min(0.1,(now-W.lastNow)/1000); W.lastNow=now; const t=now/1000;
    W.mt=W.mode==="race"?Math.max(0,(now-W.moverT0)/1000):t;
    // decoration
    for (const s of spinners) s.rotation.z+=dt*0.6;
    for (const f of floaters){ f.o.position.y=f.y+Math.sin(t*0.5+f.ph)*(f.cloud?0.6:1.2); if (f.cloud) f.o.position.x=Math.sin(t*0.03)*25; }
    const evs=[];
    if (W.mode==="race"){
      const racing=now>=W.startAt;
      W.acc+=dt; let n=0;
      while (W.acc>=DT && n<6){ W.acc-=DT; n++;
        const mt=Math.max(0,(now-W.moverT0)/1000-W.acc);
        placeMovers(mt); world.step();
        if (W.me){ const ev=[]; const inp=racing&&!W.me.st.fin?W.input:{ mx:0, mz:0, jump:false };
          stepBean(W.me.st,W.me.col,inp,mt,ev); W.input.jump=false; for (const e of ev) W.onEvent(e,W.me.pid,W.me.st); }
        for (const b of W.bots){ const ev=[]; const inp=racing&&!b.st.fin?S.botInput(b.brain,b.st,mt,DT):{ mx:0, mz:0, jump:false };
          stepBean(b.st,b.col,inp,mt,ev); for (const e of ev) W.onEvent(e,b.pid,b.st); }
      }
      if (n===6) W.acc=0;
      // draw: me, bots (full anim), ghosts (full for the nearest 12)
      const focus=W.me?W.me.st:W.lead||{ d:0, x:0, y:0 };
      if (W.me) placeBean(W.me.bean,W.me.st,dt,t,true,W.me.prev);
      for (const b of W.bots){ b.prev=b.prev||{ x:b.st.x, d:b.st.d }; placeBean(b.bean,b.st,dt,t,true,b.prev); }
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
        const st=W.me.st, fy=st.fallen>0?Math.max(-1,st.y):Math.max(-1.5,st.y);
        tmpV.set(st.x*0.55,fy+5.6,-st.d+9.2);
        const k=1-Math.exp(-dt*(st.fallen>0?2:6)); W.camPos.lerp(tmpV,k);
        cam.rotation.set(-0.42,0,0);
      } else {
        // teacher drone: high, slowly following the leading pack (median of the front half)
        const ds=rows.map(r=>r.d).sort((a,b)=>b-a), half=ds.slice(0,Math.max(1,Math.ceil(ds.length/2)));
        const target=half.length?half[Math.floor(half.length/2)]:0;
        tmpV.set(0,20,-target+17); W.camPos.lerp(tmpV,1-Math.exp(-dt*0.9)); cam.rotation.set(-0.78,0,0);
      }
      cam.position.copy(W.camPos);
    } else {
      // menu backdrop: a slow fly-over of the course
      const d=(t*5)%(T.dist+10)-5; tmpV.set(Math.sin(t*0.2)*3,11,-d+14); W.camPos.lerp(tmpV,0.05); cam.position.copy(W.camPos); cam.rotation.set(-0.46,0,0);
    }
    scene.userData.sky.position.copy(cam.position); scene.userData.goo.position.x=cam.position.x; scene.userData.goo.position.z=cam.position.z;
    R.render(scene,cam);
    return evs;
  };
  // solo: run the bots on (no rendering) until they finish or maxT race-seconds pass. Used after you finish.
  W.fastForwardBots=(fromT,maxT,onFin)=>{
    let mt=fromT; const ev=[];
    while (mt<maxT && W.bots.some(b=>!b.st.fin)){ mt+=DT; placeMovers(mt); world.step();
      for (const b of W.bots){ if (b.st.fin) continue; ev.length=0; stepBean(b.st,b.col,S.botInput(b.brain,b.st,mt,DT),mt,ev); if (ev.includes("finish")) onFin(b,mt); } }
    return mt;
  };
  W.finishLine=finishArch;
  onProgress(1);
  return W;
}
