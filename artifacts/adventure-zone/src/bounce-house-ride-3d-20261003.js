import * as THREE from 'three';

// One continuous, fictional inflatable scene. No event or route information.
export function createBounceRide3D(host) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#12203d');
  scene.fog = new THREE.Fog('#12203d', 55, 110);
  const renderer = new THREE.WebGLRenderer({antialias:true, alpha:false, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  host.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(66, 1, .08, 180);
  scene.add(new THREE.HemisphereLight('#fff4da','#415780',3));
  const sun = new THREE.DirectionalLight('#fff3dc',4.5); sun.position.set(-12,25,16); scene.add(sun);
  const fill = new THREE.DirectionalLight('#ffd0eb',2); fill.position.set(12,9,-15); scene.add(fill);
  const materials = {};
  for(const [name,color] of Object.entries({pink:'#ff008e',yellow:'#ffcc00',navy:'#172e62',cream:'#fff6d7',blue:'#486aff'})) {
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
  // Big padded castle and a genuinely open central doorway.
  for(const x of [-7,7]){
    pillow(v(x,.4,3),v(x,9.2,3),1.15,'pink');
    pillow(v(x-1.5,8.3,3),v(x+1.5,8.3,3),.6,'yellow');
    for(let n=-1;n<=1;n++)pillow(v(x+n,8.5,3),v(x+n,10,3),.4,'yellow');
    sphere(x,10.7,3,.36,'yellow');
    const flag=mesh(new THREE.ConeGeometry(.58,1.5,4),'pink',v(x,10.5,3));flag.rotation.z=-.6;
  }
  for(const x of [-3.4,3.4])pillow(v(x,.35,4),v(x,6.8,4),.9,'pink');
  const doorway=[];for(let i=0;i<=24;i++){const a=Math.PI-i*Math.PI/24;doorway.push(v(Math.cos(a)*3.4,5.8+Math.sin(a)*1.5,4));}
  tube(new THREE.CatmullRomCurve3(doorway),.8,'yellow',48);
  pillow(v(-6,7.9,3),v(6,7.9,3),.55,'navy');
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
  for(let x=-5;x<=5;x+=1)pillow(v(x,-.05,-13),v(x,-.05,7),.55,x%2?'yellow':'pink');
  for(let z=1;z>=-12;z-=4){
    const arch=[];for(let i=0;i<=24;i++){const a=Math.PI-i*Math.PI/24;arch.push(v(Math.cos(a)*6,4.5+Math.sin(a)*2,z));}
    tube(new THREE.CatmullRomCurve3(arch),.42,z===-7?'pink':'yellow',40);
  }
  // A single center lane climbs to the slide crest, then falls away beneath you.
  const slidePath=curve([[0,.15,-12],[0,1.1,-16],[0,4,-21],[0,6.9,-26],[0,7.4,-30],[0,6.6,-34],[0,3.3,-40],[0,.5,-46],[0,.1,-54]]);
  for(let x=-2.3;x<=2.3;x+=.46){
    const pts=slidePath.getPoints(120).map(p=>v(x,p.y,p.z));tube(new THREE.CatmullRomCurve3(pts),.29,'yellow',120);
  }
  for(const side of [-1,1]){
    const pts=slidePath.getPoints(120).map(p=>v(side*2.95,p.y+.8,p.z));tube(new THREE.CatmullRomCurve3(pts),.8,'pink',120);
    const trim=slidePath.getPoints(120).map(p=>v(side*3.25,p.y+1.35,p.z));tube(new THREE.CatmullRomCurve3(trim),.14,'cream',120);
  }
  // Cheerful hoops on the climb; the descending slide is open to the sky.
  for(const t of [.14,.28,.42]){
    const p=slidePath.getPoint(t),arch=[];
    for(let i=0;i<=24;i++){const a=Math.PI-i*Math.PI/24;arch.push(v(Math.cos(a)*3,p.y+1.4+Math.sin(a)*3.1,p.z));}
    tube(new THREE.CatmullRomCurve3(arch),.4,t===.28?'pink':'yellow',40);
  }
  materials.ground=new THREE.MeshStandardMaterial({color:'#132e60',roughness:1});
  const ground=mesh(new THREE.PlaneGeometry(180,180),'ground',v(0,-1.1,-25));ground.rotation.x=-Math.PI/2;
  // Distant golden stars and an exit arch, all part of the same geometry.
  for(let i=0;i<18;i++){const x=(i%2?1:-1)*(10+(i*7)%18),z=-8-(i*9)%56;sphere(x,9+(i%5)*2,z,.14+(i%3)*.08,'yellow');}
  const exit=[];for(let i=0;i<=24;i++){const a=Math.PI-i*Math.PI/24;exit.push(v(Math.cos(a)*4,1+Math.sin(a)*5,-57));}
  tube(new THREE.CatmullRomCurve3(exit),.7,'yellow',48);
  const glow=new THREE.PointLight('#ffdb71',40,25);glow.position.set(0,4,-54);scene.add(glow);
  const cameraPath=curve([[0,4.3,13],[0,3.9,9],[0,3.1,5],[0,2.8,-3],[0,2.7,-11],[0,3.6,-17],[0,6.6,-24],[0,9,-29],[0,7.6,-35],[0,4.3,-42],[0,2,-49],[0,2,-57]]);
  let raf=0,disposed=false,playing=false;
  function resize(){const r=host.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();if(!playing)draw(0);}
  function draw(t){
    const position=cameraPath.getPoint(t);camera.position.copy(position);
    if(camera.aspect<1)camera.position.z+=2.5*Math.max(0,1-t/.25)**2;
    const look=cameraPath.getPoint(Math.min(1,t+.045));
    if(t===0)look.set(0,camera.aspect<1?2.7:4.2,-2);else if(t>.96)look.set(0,1.5,-65);
    camera.lookAt(look);renderer.render(scene,camera);
  }
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  return {
    start(onLanding,onDone){
      cancelAnimationFrame(raf);playing=true;let started=null,landed=false;
      const frame=now=>{
        if(disposed)return;if(started===null)started=now;
        const elapsed=now-started,progress=Math.min(1,elapsed/7400);
        // Smooth departure, then steady forward travel. No scene cuts.
        const eased=progress*progress*(3-2*progress);
        draw(eased);
        if(elapsed>=6250&&!landed){landed=true;onLanding();}
        if(progress<1)raf=requestAnimationFrame(frame);else{playing=false;onDone();}
      };raf=requestAnimationFrame(frame);
    },
    reset(){cancelAnimationFrame(raf);playing=false;draw(0);},
    dispose(){disposed=true;cancelAnimationFrame(raf);observer.disconnect();scene.traverse(o=>o.geometry?.dispose());Object.values(materials).forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();}
  };
}
