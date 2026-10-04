import * as THREE from 'three';

// Cartoon interpretation of the existing red/yellow/blue obstacle-slide gallery photo.
// No event or route information.
export function createBounceRide3D(host) {
  const scene = new THREE.Scene();
  scene.background = null;
  const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true, powerPreference:'high-performance'});
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  host.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(55, 1, .08, 180);
  scene.add(new THREE.HemisphereLight('#fff4da','#415780',3));
  const sun = new THREE.DirectionalLight('#fff3dc',4.5); sun.position.set(-12,25,16); scene.add(sun);
  const fill = new THREE.DirectionalLight('#ffd0eb',2); fill.position.set(12,9,-15); scene.add(fill);
  const materials = {};
  for(const [name,color] of Object.entries({pink:'#d81b30',yellow:'#ffd21a',navy:'#172e62',cream:'#fff6d7',blue:'#1555bd'})) {
    materials[name]=new THREE.MeshPhysicalMaterial({color,roughness:.32,metalness:0,clearcoat:.75,clearcoatRoughness:.26});
  }
  const v=(x,y,z)=>new THREE.Vector3(x,y,z);
  function mesh(geometry, material, position) {
    const item=new THREE.Mesh(geometry, materials[material]);item.position.copy(position);scene.add(item);return item;
  }
  function pillow(a,b,r,color) {
    const direction=b.clone().sub(a);const length=direction.length();
    const item=mesh(new THREE.CapsuleGeometry(r,Math.max(.01,length-2*r),6,14),color,a.clone().add(b).multiplyScalar(.5));
    item.quaternion.setFromUnitVectors(v(0,1,0),direction.normalize());return item;
  }
  function sphere(x,y,z,r,color){return mesh(new THREE.SphereGeometry(r,16,12),color,v(x,y,z));}
  function curve(points){return new THREE.CatmullRomCurve3(points.map(p=>v(...p)),false,'centripetal');}
  function tube(path,r,color,segments=90){
    const item=mesh(new THREE.TubeGeometry(path,segments,r,12,false),color,v(0,0,0));
    for(const t of [0,1]){const p=path.getPoint(t);sphere(p.x,p.y,p.z,r,color);}return item;
  }
  // Broad red/yellow entrance arches and blue base, matching our real obstacle slide.
  for(const side of [-1,1]){
    pillow(v(side*7.6,.25,4),v(side*7.6,5.8,4),1.05,'yellow');
    pillow(v(side*7.6,.25,-12),v(side*7.6,.25,6),1,'blue');
    pillow(v(side*7.6,1.35,-12),v(side*7.6,1.35,4),.75,'pink');
  }
  const doorway=[];
  for(let i=0;i<=40;i++){const a=Math.PI-i*Math.PI/40;doorway.push(v(Math.cos(a)*7.6,4.8+Math.sin(a)*3.5,4));}
  tube(new THREE.CatmullRomCurve3(doorway),.95,'pink',64);
  for(const z of [3.1,-1,-5,-9]){
    pillow(v(-7.6,6,z),v(7.6,6,z),.55,'yellow');
  }
  // Padded blue entry apron and yellow/red inflated threshold.
  for(let x=-7;x<=7;x++)pillow(v(x,-.05,4),v(x,-.05,8),.6,'blue');
  pillow(v(-7,.35,4),v(7,.35,4),.65,'yellow');
  for(const side of [-1,1]){
    pillow(v(side*5.6,.5,3),v(side*5.6,5.5,3),1.45,'yellow');
    pillow(v(side*6,.4,-12),v(side*6,.4,3),.8,'pink');
    pillow(v(side*6,4.4,-12),v(side*6,4.4,3),.65,'yellow');
    for(let z=2;z>=-12;z-=3.5)pillow(v(side*6,.4,z),v(side*6,4.5,z),.45,'pink');
    const wall=mesh(new THREE.BoxGeometry(.16,3.5,15),'navy',v(side*6,2.5,-4.5));
    for(let z=2;z>=-12;z-=.65)pillow(v(side*5.88,1,z),v(side*5.88,4,z),.027,'blue');
    for(let y=1;y<=4;y+=.65)pillow(v(side*5.88,y,-12),v(side*5.88,y,3),.027,'blue');
  }
  // Quilted bounce floor and rounded roof ribs passing over the camera.
  for(let x=-5;x<=5;x+=1)pillow(v(x,-.05,-13),v(x,-.05,7),.55,x%2?'yellow':'blue');
  for(let z=1;z>=-12;z-=4){
    const arch=[];for(let i=0;i<=24;i++){const a=Math.PI-i*Math.PI/24;arch.push(v(Math.cos(a)*6,4.5+Math.sin(a)*2,z));}
    tube(new THREE.CatmullRomCurve3(arch),.42,z===-7?'pink':'yellow',40);
  }
  // A single center lane climbs to the slide crest, then falls away beneath you.
  const slidePath=curve([[0,.15,-12],[0,1.1,-16],[0,4,-21],[0,6.9,-26],[0,7.4,-30],[0,6.6,-34],[0,3.3,-40],[0,.5,-46],[0,.1,-54]]);
  for(let x=-2.3;x<=2.3;x+=.46){
    const pts=slidePath.getPoints(120).map(p=>v(x,p.y,p.z));tube(new THREE.CatmullRomCurve3(pts),.29,'blue',120);
  }
  for(const side of [-1,1]){
    const pts=slidePath.getPoints(120).map(p=>v(side*2.95,p.y+.8,p.z));tube(new THREE.CatmullRomCurve3(pts),.8,'yellow',120);
    const trim=slidePath.getPoints(120).map(p=>v(side*3.25,p.y+1.35,p.z));tube(new THREE.CatmullRomCurve3(trim),.22,'pink',120);
  }
  // Cheerful hoops on the climb; the descending slide is open to the sky.
  for(const t of [.14,.28,.42]){
    const p=slidePath.getPoint(t),arch=[];
    for(let i=0;i<=24;i++){const a=Math.PI-i*Math.PI/24;arch.push(v(Math.cos(a)*3,p.y+1.4+Math.sin(a)*3.1,p.z));}
    tube(new THREE.CatmullRomCurve3(arch),.4,t===.28?'pink':'yellow',40);
  }
  // Transparent surroundings let the real homepage remain the destination.
  const exit=[];for(let i=0;i<=24;i++){const a=Math.PI-i*Math.PI/24;exit.push(v(Math.cos(a)*4,1+Math.sin(a)*5,-57));}
  tube(new THREE.CatmullRomCurve3(exit),.7,'yellow',48);
  const glow=new THREE.PointLight('#ffdb71',40,25);glow.position.set(0,4,-54);scene.add(glow);
  const cameraPath=curve([[0,4.3,12],[0,3.9,9],[0,3.1,5],[0,2.8,-3],[0,2.7,-11],[0,3.6,-17],[0,6.6,-24],[0,9,-29],[0,7.6,-35],[0,4.3,-42],[0,2,-49],[0,2,-57]]);
  let raf=0,disposed=false,playing=false;
  function resize(){const r=host.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();if(!playing)draw(0);}
  function draw(t,bounce=0,phase=0){
    const position=cameraPath.getPoint(t);camera.position.copy(position);
    if(camera.aspect<1)camera.position.z+=4*Math.max(0,1-t/.25)**2;
    const look=cameraPath.getPoint(Math.min(1,t+.045));
    if(t===0)look.set(0,camera.aspect<1?2.7:4.2,-2);else if(t>.96)look.set(0,1.5,-65);
    // Full-height jumps with visible airtime and a springy compression at landing.
    camera.position.y+=bounce;
    camera.position.x+=Math.sin(phase*Math.PI*2)*.36*Math.min(1,Math.max(0,bounce));
    look.y+=bounce;
    camera.lookAt(look);
    camera.rotateZ(Math.sin(phase*Math.PI*2)*.035*Math.min(1,Math.max(0,bounce)));
    camera.rotateX(Math.sin(phase*Math.PI*2)*.065*Math.min(1,Math.max(0,bounce)));
    renderer.render(scene,camera);
  }
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  return {
    start(onLanding,onDone){
      cancelAnimationFrame(raf);playing=true;let started=null,landed=false;
      const frame=now=>{
        if(disposed)return;if(started===null)started=now;
        const elapsed=now-started,progress=Math.min(1,elapsed/10500);
        // Enter, slow down for three actual jumps, then climb and slide.
        let travel,bounce=0,phase=0;
        const smooth=x=>x*x*(3-2*x);
        if(elapsed<1800)travel=.20*smooth(elapsed/1800);
        else if(elapsed<5100){
          phase=(elapsed-1800)/1100;
          travel=.20+.14*smooth((elapsed-1800)/3300);
          const jump=phase-Math.floor(phase);
          bounce=3.2*Math.sin(Math.PI*jump)**2;
          if(jump>.84)bounce-=.32*Math.sin(Math.PI*(jump-.84)/.16)**2;
        }else travel=.34+.66*smooth(Math.min(1,(elapsed-5100)/5400));
        draw(travel,bounce,phase);
        if(elapsed>=9350&&!landed){landed=true;onLanding();}
        if(progress<1)raf=requestAnimationFrame(frame);else{playing=false;onDone();}
      };raf=requestAnimationFrame(frame);
    },
    reset(){cancelAnimationFrame(raf);playing=false;draw(0);},
    dispose(){disposed=true;cancelAnimationFrame(raf);observer.disconnect();scene.traverse(o=>o.geometry?.dispose());Object.values(materials).forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();}
  };
}
