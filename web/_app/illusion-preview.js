import { pyramidModel, faceMesh, triTexture } from './illusion-engine.js';

// Adaptación del librito 3D de Kyro Zine Generator: mismo canvas 2D con
// texturas trianguladas, mat en perspectiva, órbita amortiguada y gestos.
export function createPyramidPreview(canvas,stage,{onSweep=()=>{}}={}){
  const view={yaw:-.35,pitch:.45,tyaw:-.35,tpitch:.45,dist:5,drag:null,orbitRaf:0,sweep:null,plain:false,sheetZoom:1,panX:0,panY:0};
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let model=null,texture=null,meshes=[],destroyed=false,refDist=5;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function draw(){
    if(!model||destroyed||!stage.classList.contains('is-3d')||!stage.clientWidth||!stage.clientHeight)return;
    const dpr=Math.min(2,devicePixelRatio||1),cw=Math.round(stage.clientWidth*dpr),ch=Math.round(stage.clientHeight*dpr);
    if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}
    const ctx=canvas.getContext('2d');ctx.fillStyle='#262422';ctx.fillRect(0,0,cw,ch);
    const c=model.config,w=c.width,H=c.height/w,D=view.dist;
    const cy=Math.cos(view.yaw),sy=Math.sin(view.yaw),cp=Math.cos(view.pitch),sp=Math.sin(view.pitch);
    const k=Math.min(cw*.74,ch*.62/H)*(refDist/D);
    const rot=(x,y,z)=>{const x1=x*cy+z*sy,z1=-x*sy+z*cy;return[x1,y*cp-z1*sp,y*sp+z1*cp];};
    const screen=r=>{const s=D/Math.max(.4,D-r[2]);return{x:cw/2+k*r[0]*s,y:ch*.49-k*r[1]*s,z:r[2],cx:r[0],cy:r[1],cz:r[2]};};
    const proj=p=>screen(rot(...p));
    const poly=(pts,fill,stroke,lw=1)=>{
      ctx.beginPath();pts.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));ctx.closePath();
      if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke();}
    };
    // Mesa y grilla: el mismo plano recortado en la cámara que usa Zine.
    const TY=-H/2-.025,TT=Math.max(9,H*2),NEAR=D-.45;
    const quad=[[-TT,TY,-TT],[TT,TY,-TT],[TT,TY,TT],[-TT,TY,TT]].map(p=>rot(...p)),out=[];
    for(let i=0;i<quad.length;i++){
      const a=quad[i],b=quad[(i+1)%quad.length],ain=a[2]<NEAR,bin=b[2]<NEAR;
      if(ain)out.push(a);
      if(ain!==bin){const t=(NEAR-a[2])/(b[2]-a[2]);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,NEAR]);}
    }
    const night=document.documentElement.classList.contains('night');
    if(out.length>2)poly(out.map(screen),night?'#16130f':'#2b6b58');
    ctx.strokeStyle='rgba(255,250,240,.1)';ctx.lineWidth=Math.max(1,dpr);ctx.beginPath();
    const seg=(A,B)=>{
      let a=rot(...A),b=rot(...B);const ain=a[2]<NEAR,bin=b[2]<NEAR;if(!ain&&!bin)return;
      if(ain!==bin){const t=(NEAR-a[2])/(b[2]-a[2]),m=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,NEAR];if(ain)b=m;else a=m;}
      const P=screen(a),Q=screen(b);ctx.moveTo(P.x,P.y);ctx.lineTo(Q.x,Q.y);
    };
    for(let g=-TT;g<=TT+1e-6;g+=.4){seg([g,TY,-TT],[g,TY,TT]);seg([-TT,TY,g],[TT,TY,g]);}ctx.stroke();
    poly([[-.56,TY+.002,-.1],[.58,TY+.002,-.1],[.7,TY+.002,.4],[-.42,TY+.002,.4]].map(proj),'rgba(0,0,0,.24)');

    const normalized=p=>p.map(v=>v/w),margin=0,thickness=1/w;
    const board=[[-.5-margin,H/2+margin,0],[.5+margin,H/2+margin,0],[.5+margin,-H/2-margin,0],[-.5-margin,-H/2-margin,0]];
    const objects=[
      {points:board.map(p=>[p[0],p[1],-.001]),normal:[0,0,1],paper:true},
      {points:board.map(p=>[p[0],p[1],-thickness]),normal:[0,0,-1],paper:true,back:true},
      ...model.faces.map((face,i)=>({points:face.vertices.map(normalized),normal:face.normal,mesh:meshes[i],id:i})),
    ];
    board.forEach((p,i)=>{
      const b=board[(i+1)%4],normals=[[0,1,0],[1,0,0],[0,-1,0],[-1,0,0]];
      objects.push({points:[[p[0],p[1],0],[b[0],b[1],0],[b[0],b[1],-thickness],[p[0],p[1],-thickness]],normal:normals[i],paper:true});
    });
    const visible=objects.map(object=>{
      const pts=object.points.map(proj),normal=rot(...object.normal),mid=pts.reduce((a,p)=>[a[0]+p.cx/pts.length,a[1]+p.cy/pts.length,a[2]+p.cz/pts.length],[0,0,0]);
      return {...object,pts,normal,depth:mid[2],visible:normal[0]*-mid[0]+normal[1]*-mid[1]+normal[2]*(D-mid[2])>0};
    }).filter(o=>o.visible).sort((a,b)=>{
      // La pirámide siempre queda delante del tablero mirando el frente.
      // Ordenar ese tablero completo por su centro taparía caras inferiores al orbitar.
      const layer=o=>o.back?2:o.paper?0:1;
      return layer(a)-layer(b)||a.depth-b.depth;
    });
    for(const object of visible){
      const n=object.normal,lit=Math.max(0,n[0]*-.3+n[1]*.4+n[2]*.85);
      if(object.paper){const g=Math.round((1-lit)*30);poly(object.pts,`rgb(${255-g},${250-g},${240-g})`,'rgba(22,19,15,.5)',dpr);continue;}
      if(view.plain||!texture){
        const colors=['#ffe14d','#d9381a','#e2d9c3','#fffaf0','#2b6b58'];poly(object.pts,colors[object.id],'#16130f',dpr);
        poly(object.pts,`rgba(0,0,0,${(1-lit)*.25})`);continue;
      }
      // el recorte de cada cara se agranda un píxel hacia afuera: sin hilo del fondo donde se juntan dos caras
      const mid=object.pts.reduce((a,p)=>[a[0]+p.x/object.pts.length,a[1]+p.y/object.pts.length],[0,0]);
      ctx.save();poly(object.pts.map(p=>{const dx=p.x-mid[0],dy=p.y-mid[1],l=Math.hypot(dx,dy)||1;return {x:p.x+dx/l*dpr,y:p.y+dy/l*dpr};}));ctx.clip();
      for(const triangle of object.mesh){
        const points=triangle.map(v=>proj(normalized(v.p))),uv=triangle.map(v=>[v.uv[0]*texture.width,v.uv[1]*texture.height]);
        triTexture(ctx,texture,...points.map(p=>[p.x,p.y]),...uv,1.3*dpr); // un poco más de superposición: sin líneas entre triángulos
      }
      ctx.restore();
      // Luz tenue: conservar las claves de profundidad de la fotografía.
      poly(object.pts,`rgba(0,0,0,${Math.min(.1,(1-lit)*.1).toFixed(3)})`);
    }
  }
  function kickOrbit(){
    if(destroyed||view.orbitRaf)return;
    if(reduced.matches&&!view.sweep){view.yaw=view.tyaw;view.pitch=view.tpitch;draw();return;}
    const step=now=>{
      view.orbitRaf=0;if(destroyed)return;
      if(view.sweep){view.tyaw=Math.sin((now-view.sweep.t0)/6200*Math.PI*2)*.25;view.tpitch=0;}
      const dy=view.tyaw-view.yaw,dp=view.tpitch-view.pitch;view.yaw+=dy*.2;view.pitch+=dp*.2;draw();
      if(view.sweep||Math.abs(dy)>.0008||Math.abs(dp)>.0008)view.orbitRaf=requestAnimationFrame(step);
    };
    view.orbitRaf=requestAnimationFrame(step);
  }
  function stopSweep(){if(view.sweep){view.sweep=null;onSweep(false);}}
  function set(config,image,{reset=false}={}){
    model=pyramidModel(config);texture=image;meshes=model.faces.map(f=>faceMesh(f,model.config,12));
    const previous=refDist;refDist=model.config.distance/model.config.width;
    if(reset)view.dist=refDist;
    else view.dist=clamp(view.dist*refDist/previous,Math.max(1.6,model.config.depth/model.config.width*1.6),Math.max(8,refDist*3));
    draw();
  }
  function reset(front=false){stopSweep();view.tyaw=front?0:-.35;view.tpitch=front?0:.45;view.dist=refDist;kickOrbit();}
  function sweep(){if(view.sweep){stopSweep();return false;}if(reduced.matches)return false;view.dist=refDist;view.sweep={t0:performance.now()};onSweep(true);kickOrbit();return true;}
  let wheelT=0,pvSwipe=false;const pointers=new Map();let pinch=null;
  const sheetTransform=()=>{canvas.style.transform=`translate(${view.panX}px,${view.panY}px) scale(${view.sheetZoom})`;canvas.style.cursor=view.sheetZoom>1?'grab':'';};
  function resetSheet(){view.sheetZoom=1;view.panX=view.panY=0;canvas.style.transform='';canvas.style.cursor='';}
  function wheel(e){
    e.preventDefault();
    if(!stage.classList.contains('is-3d'))return; // las hojas las maneja illusion-board.js
    stopSweep();const k=e.deltaMode===1?16:e.deltaMode===2?400:1,now=performance.now(),dt=now-wheelT;wheelT=now;if(dt>160)pvSwipe=false;
    const step=e.deltaY*k,notch=!e.ctrlKey&&Math.abs(step)>=40&&e.deltaX===0&&dt>40&&!pvSwipe;if(!e.ctrlKey&&!notch&&dt<40)pvSwipe=true;
    if(e.ctrlKey||notch){view.dist=clamp(view.dist*Math.exp(step*(Math.abs(step)>=40?.0012:.008)),Math.max(1.6,(model?.config.depth||1)/(model?.config.width||1)*1.6),Math.max(8,refDist*3));draw();}
    else{view.tyaw-=e.deltaX*k*.009;view.tpitch=clamp(view.tpitch-e.deltaY*k*.009,-1.25,1.25);kickOrbit();}
  }
  function down(e){if(e.button!==0||!stage.classList.contains('is-3d'))return;stopSweep();pointers.set(e.pointerId,[e.clientX,e.clientY]);stage.setPointerCapture(e.pointerId);view.drag={x:e.clientX,y:e.clientY};if(pointers.size===2){const a=[...pointers.values()];pinch={length:Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1]),dist:view.dist,zoom:view.sheetZoom};}}
  function move(e){
    if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,[e.clientX,e.clientY]);
    if(!stage.classList.contains('is-3d'))return;
    if(pointers.size===2&&pinch){const a=[...pointers.values()],d=Math.max(1,Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1]));view.dist=clamp(pinch.dist*pinch.length/d,1.6,Math.max(8,refDist*3));draw();return;}
    if(view.drag){view.tyaw+=(e.clientX-view.drag.x)*.009;view.tpitch=clamp(view.tpitch+(e.clientY-view.drag.y)*.009,-1.25,1.25);view.drag={x:e.clientX,y:e.clientY};kickOrbit();}
  }
  function up(e){pointers.delete(e.pointerId);pinch=null;view.drag=null;try{stage.releasePointerCapture(e.pointerId);}catch{}}
  const dbl=()=>{if(stage.classList.contains('is-3d'))reset(false);},key=e=>{if(!stage.classList.contains('is-3d'))return;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();stopSweep();if(e.key==='Home')return reset(true);view.tyaw+=(e.key==='ArrowLeft'?-.12:e.key==='ArrowRight'?.12:0);view.tpitch=clamp(view.tpitch+(e.key==='ArrowUp'?-.12:e.key==='ArrowDown'?.12:0),-1.25,1.25);kickOrbit();};
  stage.addEventListener('wheel',wheel,{passive:false});stage.addEventListener('pointerdown',down);stage.addEventListener('pointermove',move);stage.addEventListener('pointerup',up);stage.addEventListener('pointercancel',up);stage.addEventListener('dblclick',dbl);stage.addEventListener('keydown',key);
  const resize=new ResizeObserver(draw);resize.observe(stage);
  return {view,set,draw,reset,resetSheet,sweep,stopSweep,flip(){stopSweep();view.tyaw+=Math.PI;kickOrbit();},plain(value){view.plain=value;draw();},destroy(){destroyed=true;stopSweep();cancelAnimationFrame(view.orbitRaf);resize.disconnect();stage.removeEventListener('wheel',wheel);stage.removeEventListener('pointerdown',down);stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerup',up);stage.removeEventListener('pointercancel',up);stage.removeEventListener('dblclick',dbl);stage.removeEventListener('keydown',key);}};
}
