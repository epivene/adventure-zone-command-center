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
  renderer.toneMappingExposure = 1.12;
  host.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(55, 1, .08, 180);
  scene.add(new THREE.HemisphereLight('#fff4da','#415780',2.4));
  const sun = new THREE.DirectionalLight('#fff3dc',3.2); sun.position.set(-12,25,16); scene.add(sun);
  const fill = new THREE.DirectionalLight('#ffd0eb',2); fill.position.set(12,9,-15); scene.add(fill);
  const materials = {};
  for(const [name,color] of Object.entries({pink:'#d81b30',yellow:'#ffd21a',navy:'#172e62',cream:'#fff6d7',blue:'#1555bd'})) {
    materials[name]=new THREE.MeshPhysicalMaterial({color,roughness:.48,metalness:0,clearcoat:.4,clearcoatRoughness:.4});
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
  // One welded deck joins the bounce floor to the climb, crest and descent.
  const slidePath=curve([[0,.25,-10],[0,.5,-13],[0,1.3,-16],[0,4,-21],[0,6.9,-26],[0,7.4,-30],[0,6.6,-34],[0,3.3,-40],[0,.5,-46],[0,.1,-54]]);
  const samples=slidePath.getPoints(160),vertices=[],indices=[];
  for(const p of samples)vertices.push(-2.6,p.y+.28,p.z,2.6,p.y+.28,p.z);
  for(let i=0;i<samples.length-1;i++){const n=i*2;indices.push(n,n+2,n+1,n+1,n+2,n+3);}
  const deck=new THREE.BufferGeometry();deck.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));deck.setIndex(indices);deck.computeVertexNormals();
  materials.slide=new THREE.MeshPhysicalMaterial({color:'#1764c4',roughness:.52,clearcoat:.3,side:THREE.DoubleSide});
  mesh(deck,'slide',v(0,0,0));
  for(const x of [-1.3,0,1.3])tube(new THREE.CatmullRomCurve3(samples.map(p=>v(x,p.y+.29,p.z))),.024,'blue',160);
  for(const side of [-1,1]){
    tube(new THREE.CatmullRomCurve3(samples.map(p=>v(side*2.85,p.y+.65,p.z))),.72,'yellow',160);
    tube(new THREE.CatmullRomCurve3(samples.map(p=>v(side*3.15,p.y+.15,p.z))),.5,'pink',160);
    tube(new THREE.CatmullRomCurve3(samples.map(p=>v(side*3.13,p.y+1.16,p.z))),.11,'cream',160);
  }
  // Padded steps visibly connect the play area to the slide summit.
  for(const p of samples.filter((p,i)=>i%5===0&&p.z<-14&&p.z>-28))pillow(v(-2.1,p.y+.38,p.z),v(2.1,p.y+.38,p.z),.13,'pink');
  for(const t of [.25,.40,.54]){
    const p=slidePath.getPoint(t),arch=[];
    for(let i=0;i<=32;i++){const a=Math.PI-i*Math.PI/32;arch.push(v(Math.cos(a)*3,p.y+1.5+Math.sin(a)*3.4,p.z));}
    tube(new THREE.CatmullRomCurve3(arch),.35,t===.40?'pink':'yellow',48);
  }
  // Transparent surroundings let the real homepage remain the destination.
  const exit=[];for(let i=0;i<=24;i++){const a=Math.PI-i*Math.PI/24;exit.push(v(Math.cos(a)*4,1+Math.sin(a)*5,-57));}
  tube(new THREE.CatmullRomCurve3(exit),.7,'yellow',48);
  const glow=new THREE.PointLight('#ffdb71',40,25);glow.position.set(0,4,-54);scene.add(glow);
  const entryPath=curve([[0,4.3,12],[0,3.1,6],[0,2.1,1],[0,2.1,-3]]);
  // The climbing camera follows the exact deck geometry, with eye clearance.
  const ridePath=curve([[0,2.1,-8],[0,2.1,-10],...samples.filter((p,i)=>i%8===0).map(p=>[p.x,p.y+1.9,p.z]),[0,2,-57]]);
  let raf=0,disposed=false,playing=false;
  // A glimpse of your own padded shoes makes each jump read as first-person airtime.
  const feet=new THREE.Group();camera.add(feet);scene.add(camera);feet.visible=false;
  for(const side of [-1,1]){
    const shoe=new THREE.Mesh(new THREE.CapsuleGeometry(.085,.18,6,12),materials.cream);
    shoe.rotation.x=Math.PI/2;shoe.position.set(side*.19,-.39,-.66);feet.add(shoe);
    const cuff=new THREE.Mesh(new THREE.SphereGeometry(.073,12,8),materials.blue);cuff.position.set(side*.19,-.35,-.56);feet.add(cuff);
  }
  function resize(){const r=host.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();if(!playing)draw(0);}
  function draw(elapsed){
    const smooth=x=>x*x*(3-2*x);let position,look;
    feet.visible=false;
    if(elapsed<1800){
      const t=smooth(elapsed/1800);position=entryPath.getPoint(t);look=position.clone().add(v(0,-.1,-8));
      if(camera.aspect<1)position.z+=4*(1-t)**2;
      if(!elapsed)look.set(0,camera.aspect<1?2.7:4.2,-2);
    }else if(elapsed<5100){
      const phase=(elapsed-1800)/1100,jump=phase%1;
      let height;
      if(jump<.12)height=-.2*Math.sin(Math.PI*jump/.12);
      else if(jump<.84){const airtime=(jump-.12)/.72;height=2.6*4*airtime*(1-airtime);}
      else height=-.24*Math.sin(Math.PI*(jump-.84)/.16);
      // Jump in the open floor area, never through the doorway or ceiling bars.
      position=v(0,2.1+height,-3-5*smooth(phase/3));
      const gaze=smooth(Math.min(1,phase/.15))*smooth(Math.min(1,(3-phase)/.15));
      look=position.clone().add(v(0,-.1-1.15*gaze,-6));
      feet.visible=height>.3;feet.position.y=-Math.max(0,1-height/2.6)*.12;
      for(const child of feet.children)child.rotation.z=0;
    }else{
      const t=smooth(Math.min(1,(elapsed-5100)/5400));position=ridePath.getPoint(t);
      look=ridePath.getPoint(Math.min(1,t+.035));if(t>.98)look=position.clone().add(v(0,-.2,-8));
    }
    camera.position.copy(position);camera.lookAt(look);renderer.render(scene,camera);
  }
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  return {
    start(onLanding,onDone){
      cancelAnimationFrame(raf);playing=true;let started=null,landed=false;
      const frame=now=>{
        if(disposed)return;if(started===null)started=now;
        const elapsed=now-started,progress=Math.min(1,elapsed/10500);
        draw(elapsed);
        if(elapsed>=9350&&!landed){landed=true;onLanding();}
        if(progress<1)raf=requestAnimationFrame(frame);else{playing=false;onDone();}
      };raf=requestAnimationFrame(frame);
    },
    reset(){cancelAnimationFrame(raf);playing=false;draw(0);},
    dispose(){disposed=true;cancelAnimationFrame(raf);observer.disconnect();scene.traverse(o=>o.geometry?.dispose());Object.values(materials).forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();}
  };
}
