// Reverspectiva: una foto proyectada sobre una pirámide de cuatro caras, con punta o con un centro plano.
// La foto se reconstruye desde (0,0,distancia); las caras se despliegan sin cambiar sus longitudes.
// Referencias: Cornell CS4670/PA4/reverse.htm; Rogers & Hughes (2023), doi:10.1177/20416695231165623.
export const FACE_NAMES = ['Arriba', 'Derecha', 'Abajo', 'Izquierda'];
export const LETTERS = 'ABCD';
export const PAGE_MARGIN = { x: 10, y: 18 };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const number = (x, fallback) => Number.isFinite(+x) ? +x : fallback;
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const length = a => Math.hypot(...a);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => {const d=length(a)||1;return a.map(v=>v/d);};
export function normalizePyramid(value = {}) {
  const width=clamp(number(value.width,240),40,1000),height=clamp(number(value.height,180),40,1000);
  const depth=clamp(number(value.depth,Math.min(width,height)*.4),5,600);
  const distance=clamp(number(value.distance,1200),Math.max(300,depth*3+100,Math.max(width,height)*1.2),10000);
  const image={rot:((Math.round(number(value.image?.rot,0))%4)+4)%4};
  const c=value.image?.crop;
  if(c){const x=clamp(number(c.x,0),0,.99),y=clamp(number(c.y,0),0,.99);image.crop={x,y,w:clamp(number(c.w,1),.01,1-x),h:clamp(number(c.h,1),.01,1-y)};}
  // flatX/flatY: ancho y alto del centro plano respecto de la base (0 = punta). "flat" es el formato anterior (los dos iguales).
  let flatX=clamp(number(value.flatX,number(value.flat,0)),0,.8),flatY=clamp(number(value.flatY,number(value.flat,0)),0,.8);
  if(flatX<.005||flatY<.005)flatX=flatY=0;
  return {kind:'pyramid',version:1,width,height,depth,distance,u:clamp(number(value.u,.5),.05,.95),v:clamp(number(value.v,.5),.05,.95),flatX:+flatX.toFixed(4),flatY:+flatY.toFixed(4),tab:clamp(number(value.tab,8),3,15),base:value.base!==false,paper:value.paper==='A3'?'A3':'A4',image};
}
const proj = (p,c) => {const scale=c.distance/(c.distance-p[2]);return [.5+p[0]*scale/c.width,.5-p[1]*scale/c.height];};
export function projectUV(p, value) { return proj(p,normalizePyramid(value)); }
export function pyramidModel(value) {
  const c=normalizePyramid(value),w=c.width,h=c.height;
  const corners=[[-w/2,h/2,0],[w/2,h/2,0],[w/2,-h/2,0],[-w/2,-h/2,0]];
  const q=1-c.depth/c.distance,P=[(c.u-.5)*w,(.5-c.v)*h],apex=[P[0]*q,P[1]*q,c.depth];
  // Centro plano: rectángulo paralelo a la base a la altura de la punta. Desde el frente
  // se ve como la parte de la foto que rodea al punto de fuga, achicada hacia él.
  const top=c.flatX>0?corners.map(p=>[apex[0]+c.flatX*q*(p[0]-P[0]),apex[1]+c.flatY*q*(p[1]-P[1]),c.depth]):null;
  const faces=corners.map((a,i)=>{
    const b=corners[(i+1)%4],vertices=top?[a,b,top[(i+1)%4],top[i]]:[a,b,apex];
    return {id:i,name:FACE_NAMES[i],letter:LETTERS[i],vertices,normal:unit(cross(sub(vertices[2],a),sub(vertices[1],a)))};
  });
  if(top)faces.push({id:4,name:'Centro',letter:'Centro',vertices:top,normal:[0,0,1]});
  return {config:c,corners,apex,top,faces};
}
// Triángulos chicos de una cara (triángulo o trapecio), con su coordenada en la foto.
export function faceMesh(face, value, divisions=12) {
  const c=normalizePyramid(value),n=clamp(Math.round(divisions),1,64),V=face.vertices,triangles=[];
  for(let k=1;k<V.length-1;k++){
    const a=V[0],b=V[k],t=V[k+1];
    const at=(i,j)=>{const s=i/n,v=j/n,p=a.map((x,m)=>x*(1-s-v)+b[m]*s+t[m]*v);return {p,uv:proj(p,c),bary:[1-s-v,s,v]};};
    for(let j=0;j<n;j++)for(let i=0;i<n-j;i++){
      triangles.push([at(i,j),at(i+1,j),at(i,j+1)]);
      if(i+j<n-1)triangles.push([at(i+1,j),at(i+1,j+1),at(i,j+1)]);
    }
  }
  return triangles;
}

// Copiado del triTexture de la vista 3D de Kyro Zine Generator.
// Sólo se parametriza la expansión: píxeles en pantalla, centésimas de mm al imprimir.
export function triTexture(ctx,img,p0,p1,p2,t0,t1,t2,expand=.7){
  const d=t0[0]*(t1[1]-t2[1])+t1[0]*(t2[1]-t0[1])+t2[0]*(t0[1]-t1[1]);
  if(Math.abs(d)<1e-9)return;
  const cx=(p0[0]+p1[0]+p2[0])/3,cy=(p0[1]+p1[1]+p2[1])/3;
  const grow=q=>{const dx=q[0]-cx,dy=q[1]-cy,l=Math.hypot(dx,dy)||1;return[q[0]+dx/l*expand,q[1]+dy/l*expand];};
  const a0=grow(p0),a1=grow(p1),a2=grow(p2);
  const A=(p0[0]*(t1[1]-t2[1])+p1[0]*(t2[1]-t0[1])+p2[0]*(t0[1]-t1[1]))/d;
  const B=(p0[1]*(t1[1]-t2[1])+p1[1]*(t2[1]-t0[1])+p2[1]*(t0[1]-t1[1]))/d;
  const C=(p0[0]*(t2[0]-t1[0])+p1[0]*(t0[0]-t2[0])+p2[0]*(t1[0]-t0[0]))/d;
  const D=(p0[1]*(t2[0]-t1[0])+p1[1]*(t0[0]-t2[0])+p2[1]*(t1[0]-t0[0]))/d;
  const E=(p0[0]*(t1[0]*t2[1]-t2[0]*t1[1])+p1[0]*(t2[0]*t0[1]-t0[0]*t2[1])+p2[0]*(t0[0]*t1[1]-t1[0]*t0[1]))/d;
  const F=(p0[1]*(t1[0]*t2[1]-t2[0]*t1[1])+p1[1]*(t2[0]*t0[1]-t0[0]*t2[1])+p2[1]*(t0[0]*t1[1]-t1[0]*t0[1]))/d;
  ctx.save();ctx.beginPath();ctx.moveTo(...a0);ctx.lineTo(...a1);ctx.lineTo(...a2);ctx.closePath();ctx.clip();
  ctx.transform(A,B,C,D,E,F);ctx.drawImage(img,0,0);ctx.restore();
}

const photoCache=new WeakMap();
export function preparePhoto(image, transform={},maxPixels=4000000){
  const c=normalizePyramid({image:transform}).image,key=JSON.stringify([c,maxPixels]);
  let cache=photoCache.get(image);if(!cache){cache=new Map();photoCache.set(image,cache);}
  if(cache.has(key))return cache.get(key);
  const iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;
  if(!iw||!ih)throw Error('No se pudo leer la foto de la ilusión.');
  const r=c.crop||{x:0,y:0,w:1,h:1},sw=iw*r.w,sh=ih*r.h;
  const k=Math.min(1,Math.sqrt(maxPixels/(sw*sh))),odd=c.rot%2,cv=document.createElement('canvas');
  cv.width=Math.max(1,Math.round((odd?sh:sw)*k));cv.height=Math.max(1,Math.round((odd?sw:sh)*k));
  const ctx=cv.getContext('2d');ctx.translate(cv.width/2,cv.height/2);ctx.rotate(c.rot*Math.PI/2);
  ctx.drawImage(image,iw*r.x,ih*r.y,sw,sh,-sw*k/2,-sh*k/2,sw*k,sh*k);
  if(cache.size>=6)cache.delete(cache.keys().next().value);cache.set(key,cv);return cv;
}

// --- desplegado ---
const centroid=pts=>[0,1].map(k=>pts.reduce((s,p)=>s+p[k],0)/pts.length);
function bounds(points){return {x0:Math.min(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),x1:Math.max(...points.map(p=>p[0])),y1:Math.max(...points.map(p=>p[1]))};}
function hull(points){
  const P=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lo=[],up=[];
  for(const p of P){while(lo.length>=2&&cr(lo.at(-2),lo.at(-1),p)<=1e-9)lo.pop();lo.push(p);}
  for(const p of P.reverse()){while(up.length>=2&&cr(up.at(-2),up.at(-1),p)<=1e-9)up.pop();up.push(p);}
  return lo.slice(0,-1).concat(up.slice(0,-1));
}
const polyArea=P=>Math.abs(P.reduce((s,p,i)=>{const q=P[(i+1)%P.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2;
// Pestaña trapezoidal sobre la arista a→b, siempre hacia afuera de la pieza.
function tab(a,b,size,inside){
  const d=sub(b,a),len=length(d),u=d.map(x=>x/len);let n=[-u[1],u[0]];
  if(n[0]*(inside[0]-a[0])+n[1]*(inside[1]-a[1])>0)n=[-n[0],-n[1]];
  const inset=Math.min(size*.7,len*.18),s=Math.min(size,(len-2*inset)/2.5);
  const q0=a.map((x,i)=>x+u[i]*inset),q3=b.map((x,i)=>x-u[i]*inset);
  return [q0,q0.map((x,i)=>x+n[i]*s+u[i]*s*.3),q3.map((x,i)=>x+n[i]*s-u[i]*s*.3),q3];
}
// Plano de la cara: E1 sobre la arista de la base y E2 = E1 × normal. Así la hoja,
// mirada del lado impreso, coincide con la cara mirada desde afuera (sin espejar).
function facePiece(face,c,tabSpec){
  const a=face.vertices[0],E1=unit(sub(face.vertices[1],a)),E2=cross(E1,face.normal);
  const flat=face.vertices.map(p=>{const d=sub(p,a);return [dot(d,E1),dot(d,E2)];}),mid=centroid(flat);
  const tabs=tabSpec.map(([edge,label])=>({edge,label,points:tab(flat[edge],flat[(edge+1)%flat.length],c.tab,mid)}));
  return {kind:'face',face,frame:{O:a,E1,E2},flat,tabs,hull:hull([...flat,...tabs.flatMap(t=>t.points)])};
}
export function unfoldPyramid(value){
  const model=pyramidModel(value),c=model.config,pieces=[];
  for(const face of model.faces.slice(0,4)){
    const L=LETTERS[face.id],next=LETTERS[(face.id+1)%4];
    pieces.push({...facePiece(face,c,[[0,L+' · base'],[1,L+' → detrás de '+next]]),key:'face'+face.id,label:'Cara '+L+' · '+face.name});
  }
  if(model.top)pieces.push({...facePiece(model.faces[4],c,[0,1,2,3].map(i=>[i,'Centro → detrás de '+LETTERS[i]])),key:'top',label:'Centro plano'});
  if(c.base){const flat=[[0,0],[c.width,0],[c.width,c.height],[0,c.height]];pieces.push({kind:'base',key:'base',flat,tabs:[],hull:flat,label:'Base de apoyo'});}
  for(const p of pieces){const b=bounds(p.hull);p.w=b.x1-b.x0;p.h=b.y1-b.y0;}
  return pieces;
}

// --- piezas giradas sobre la hoja ---
const rotate=(p,a)=>{const c=Math.cos(a),s=Math.sin(a);return [p[0]*c-p[1]*s,p[0]*s+p[1]*c];};
export function rotatedBounds(piece,angle){return bounds(piece.hull.map(p=>rotate(p,angle)));}
// Contorno de la pieza en milímetros de la hoja (para tocarla en la vista previa).
export function placedHull(placement){
  const {piece,angle}=placement,b=rotatedBounds(piece,angle);
  return piece.hull.map(p=>{const r=rotate(p,angle);return [PAGE_MARGIN.x+placement.x-placement.offsetX+r[0]-b.x0,PAGE_MARGIN.y+placement.y-placement.offsetY+r[1]-b.y0];});
}
export function paperSize(paper){const [w,h]=paper==='A3'?[297,420]:[210,297];return {w,h,area:{w:w-2*PAGE_MARGIN.x,h:h-PAGE_MARGIN.y-20}};}
// Giros que vale la pena probar: cada arista apoyada sobre un lado de la hoja.
function candidateAngles(piece){
  const out=[],F=piece.flat,T=2*Math.PI;
  const add=a=>{a=((a%T)+T)%T;if(!out.some(b=>Math.min(Math.abs(b-a),T-Math.abs(b-a))<1e-4))out.push(a);};
  for(let k=0;k<4;k++)add(k*Math.PI/2);
  F.forEach((p,i)=>{const q=F[(i+1)%F.length],t=-Math.atan2(q[1]-p[1],q[0]-p[0]);for(let k=0;k<4;k++)add(t+k*Math.PI/2);});
  return out.map(angle=>{const b=rotatedBounds(piece,angle);return {angle,w:b.x1-b.x0,h:b.y1-b.y0};});
}
const fitsIn=(o,area)=>o.w<=area.w+1e-9&&o.h<=area.h+1e-9;
export const fitsSheet=(piece,area)=>candidateAngles(piece).some(o=>fitsIn(o,area));
export function scalePyramid(value,s){const c=normalizePyramid(value);return normalizePyramid({...c,width:c.width*s,height:c.height*s,depth:c.depth*s});}
// Hasta dónde se puede agrandar (todo junto, en proporción) sin que ninguna pieza tenga que cortarse en dos hojas.
export function fitLimits(value){
  const c=normalizePyramid(value),{area}=paperSize(c.paper);
  const min=Math.max(40/c.width,40/c.height,5/c.depth),hi=Math.min(1000/c.width,1000/c.height,600/c.depth);
  const ok=s=>unfoldPyramid(scalePyramid(c,s)).every(p=>fitsSheet(p,area));
  let max;
  if(ok(hi))max=hi;else if(!ok(min))max=min;
  else{let a=min,b=hi;for(let i=0;i<36;i++){const m=(a+b)/2;if(ok(m))a=m;else b=m;}max=a;}
  return {min,max,fits:ok(1)};
}

// Acomodo: cada pieza (con sus pestañas) se rasteriza en una grilla de 2 mm y se prueba
// con todos sus giros útiles, siempre en el lugar más alto y a la izquierda que quede libre.
// Se prueban varios órdenes y queda el que usa menos hojas y deja más papel libre.
const GRID=2,GAP=2.5;
function maskOf(piece,angle){
  const H=piece.hull.map(p=>rotate(p,angle)),b=bounds(H),P=H.map(p=>[p[0]-b.x0,p[1]-b.y0]),w=b.x1-b.x0,h=b.y1-b.y0,rows=Math.max(1,Math.ceil(h/GRID)),solid=[];
  for(let j=0;j<rows;j++){
    const y0=j*GRID,y1=Math.min(h,(j+1)*GRID);let lo=Infinity,hi=-Infinity;
    for(let i=0;i<P.length;i++){
      const a=P[i],c=P[(i+1)%P.length];
      if(a[1]>=y0-1e-9&&a[1]<=y1+1e-9){lo=Math.min(lo,a[0]);hi=Math.max(hi,a[0]);}
      for(const y of [y0,y1])if((a[1]-y)*(c[1]-y)<0){const x=a[0]+(c[0]-a[0])*(y-a[1])/(c[1]-a[1]);lo=Math.min(lo,x);hi=Math.max(hi,x);}
    }
    if(lo>hi){lo=0;hi=w;}
    const x0=Math.floor(lo/GRID);solid.push([x0,Math.max(x0,Math.ceil(hi/GRID)-1)]);
  }
  const g=Math.ceil(GAP/GRID),grown=[];
  for(let j=-g;j<rows+g;j++){let lo=Infinity,hi=-Infinity;for(let k=Math.max(0,j-g);k<=Math.min(rows-1,j+g);k++){lo=Math.min(lo,solid[k][0]-g);hi=Math.max(hi,solid[k][1]+g);}grown.push([j,lo,hi]);}
  return {w,h,solid,grown};
}
function newSheet(area){const W=Math.floor(area.w/GRID),H=Math.floor(area.h/GRID);return {W,H,cells:Array.from({length:H},()=>new Uint8Array(W)),pre:Array.from({length:H},()=>new Int32Array(W+1)),placements:[],bottom:0};}
function fitsAt(sheet,mask,ox,oy){
  for(const [j,lo,hi] of mask.grown){const r=oy+j;if(r<0||r>=sheet.H)continue;const a=Math.max(0,ox+lo),b=Math.min(sheet.W-1,ox+hi);if(a<=b&&sheet.pre[r][b+1]-sheet.pre[r][a]>0)return false;}
  return true;
}
function mark(sheet,mask,ox,oy){
  mask.solid.forEach(([lo,hi],j)=>{const r=oy+j;if(r<0||r>=sheet.H)return;const row=sheet.cells[r],pre=sheet.pre[r];for(let x=Math.max(0,ox+lo);x<=Math.min(sheet.W-1,ox+hi);x++)row[x]=1;for(let x=0;x<sheet.W;x++)pre[x+1]=pre[x]+row[x];});
}
function bestSpot(sheet,options,area){
  let best=null;
  for(const o of options){
    const maxX=Math.floor((area.w-o.mask.w)/GRID+1e-9),maxY=Math.floor((area.h-o.mask.h)/GRID+1e-9);
    for(let oy=0;oy<=maxY;oy++){
      const bottom=oy*GRID+o.mask.h;if(best&&bottom>=best.bottom-1e-9)break;
      let found=-1;for(let ox=0;ox<=maxX;ox++)if(fitsAt(sheet,o.mask,ox,oy)){found=ox;break;}
      if(found>=0){best={...o,ox:found,oy,bottom};break;}
    }
  }
  return best;
}
function packRun(order,options,area){
  const sheets=[];
  for(const piece of order){
    const opts=options.get(piece);let spot=null,sheet=null;
    for(const s of sheets){spot=bestSpot(s,opts,area);if(spot){sheet=s;break;}}
    if(!spot){sheet=newSheet(area);sheets.push(sheet);spot=bestSpot(sheet,opts,area);}
    mark(sheet,spot.mask,spot.ox,spot.oy);sheet.bottom=Math.max(sheet.bottom,spot.bottom);
    sheet.placements.push({piece,angle:spot.angle,x:spot.ox*GRID,y:spot.oy*GRID,offsetX:0,offsetY:0});
  }
  return {sheets,score:sheets.length*1e6+sheets.reduce((s,x)=>s+x.bottom,0)};
}
export function layoutPrint(value){
  const c=normalizePyramid(value),{w,h,area}=paperSize(c.paper),pieces=unfoldPyramid(c);
  const fit=pieces.filter(p=>fitsSheet(p,area)),big=pieces.filter(p=>!fit.includes(p));
  const options=new Map(fit.map(p=>[p,candidateAngles(p).filter(o=>fitsIn(o,area)).sort((a,b)=>a.w*a.h-b.w*b.h).map(o=>({...o,mask:maskOf(p,o.angle)}))]));
  const size=new Map(fit.map(p=>[p,polyArea(p.hull)])),long=p=>Math.max(p.w,p.h);
  const orders=[(a,b)=>size.get(b)-size.get(a),(a,b)=>long(b)-long(a),(a,b)=>options.get(b)[0].h-options.get(a)[0].h,(a,b)=>options.get(b)[0].w-options.get(a)[0].w,(a,b)=>size.get(a)-size.get(b)];
  let best=null;
  for(const cmp of orders){const run=packRun([...fit].sort(cmp),options,area);if(!best||run.score<best.score)best=run;}
  const pages=(best?.sheets||[]).map(s=>({placements:s.placements}));
  // Lo que no entra en una hoja se reparte en secciones con 8 mm repetidos para empalmar.
  for(const piece of big){
    const overlap=8,tiling=o=>({...o,nx:Math.max(1,Math.ceil((o.w-overlap)/(area.w-overlap))),ny:Math.max(1,Math.ceil((o.h-overlap)/(area.h-overlap)))});
    const o=candidateAngles(piece).map(tiling).sort((a,b)=>a.nx*a.ny-b.nx*b.ny||a.w*a.h-b.w*b.h)[0];
    for(let row=0;row<o.ny;row++)for(let col=0;col<o.nx;col++)pages.push({tile:{row,col,rows:o.ny,cols:o.nx,overlap},placements:[{piece,angle:o.angle,x:0,y:0,offsetX:col*(area.w-overlap),offsetY:row*(area.h-overlap)}]});
  }
  if(pages.length>64)throw Error('La plantilla supera 64 hojas. Reducí el tamaño o elegí A3.');
  return {config:c,w,h,area,oversize:big.map(p=>p.key),pages:[{cover:true,placements:[]},...pages]};
}

// --- dibujo de las hojas ---
function pathPoly(ctx,points){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();}
const pixelCache=new WeakMap();
function rasterFace(ctx,piece,texture,c){
  // A 300 dpi se muestrea la proyección exacta. Evita líneas de antialias entre
  // los triángulos del visor y no necesita una imagen gigante de la cara completa.
  let pixels=pixelCache.get(texture);if(!pixels){pixels=texture.getContext('2d').getImageData(0,0,texture.width,texture.height);pixelCache.set(texture,pixels);}
  const m=ctx.getTransform(),det=m.a*m.d-m.b*m.c,F=piece.flat,n=F.length;
  const toDevice=p=>[m.a*p[0]+m.c*p[1]+m.e,m.b*p[0]+m.d*p[1]+m.f],b=bounds(F.map(toDevice));
  const x0=Math.max(0,Math.floor(b.x0)),y0=Math.max(0,Math.floor(b.y0)),x1=Math.min(ctx.canvas.width,Math.ceil(b.x1)),y1=Math.min(ctx.canvas.height,Math.ceil(b.y1));
  const w=x1-x0,h=y1-y0;if(w<=0||h<=0||Math.abs(det)<1e-10)return;
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;const dest=cv.getContext('2d'),image=dest.createImageData(w,h),out=image.data,src=pixels.data,tw=texture.width,th=texture.height;
  const {O,E1,E2}=piece.frame,sg=Math.sign(F.reduce((s,p,i)=>{const q=F[(i+1)%n];return s+p[0]*q[1]-q[0]*p[1];},0))||1;
  const ex=F.map(p=>p[0]),ey=F.map(p=>p[1]),dx=F.map((p,i)=>F[(i+1)%n][0]-p[0]),dy=F.map((p,i)=>F[(i+1)%n][1]-p[1]);
  const a=m.d/det,bx=-m.c/det,cy=-m.b/det,d=m.a/det;
  for(let y=0;y<h;y++){
    let fx=a*(x0+.5-m.e)+bx*(y+y0+.5-m.f),fy=cy*(x0+.5-m.e)+d*(y+y0+.5-m.f);
    for(let x=0;x<w;x++,fx+=a,fy+=cy){
      let inside=true;for(let k=0;k<n;k++)if(sg*(dx[k]*(fy-ey[k])-dy[k]*(fx-ex[k]))<-1e-6){inside=false;break;}
      if(!inside)continue;
      const wx=O[0]+E1[0]*fx+E2[0]*fy,wy=O[1]+E1[1]*fx+E2[1]*fy,z=O[2]+E1[2]*fx+E2[2]*fy,q=c.distance/(c.distance-z);
      const u=Math.max(0,Math.min(tw-1,(.5+wx*q/c.width)*(tw-1))),v=Math.max(0,Math.min(th-1,(.5-wy*q/c.height)*(th-1)));
      const sx=Math.floor(u),sy=Math.floor(v),fu=u-sx,fv=v-sy,p=(sy*tw+sx)*4,p1=(sy*tw+Math.min(tw-1,sx+1))*4,p2=(Math.min(th-1,sy+1)*tw+sx)*4,p3=(Math.min(th-1,sy+1)*tw+Math.min(tw-1,sx+1))*4,i=(y*w+x)*4;
      for(let k=0;k<4;k++)out[i+k]=(src[p+k]*(1-fu)+src[p1+k]*fu)*(1-fv)+(src[p2+k]*(1-fu)+src[p3+k]*fu)*fv;
    }
  }
  dest.putImageData(image,0,0);ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(cv,x0,y0);ctx.restore();cv.width=cv.height=0;
}
// Texto derecho para quien lee la hoja, sin importar cómo quedó girada la pieza.
function readable(ctx,angle){const m=ctx.getTransform();return Math.cos(angle+Math.atan2(m.b,m.a))<0?angle+Math.PI:angle;}
function drawPiece(ctx,piece,texture,c,{precise=false,divisions=20,plain=false}={}){
  ctx.save();ctx.fillStyle='#16130f';ctx.strokeStyle='#16130f';ctx.lineWidth=.2;ctx.textBaseline='middle';ctx.textAlign='center';
  if(piece.kind==='base'){
    pathPoly(ctx,piece.flat);ctx.stroke();ctx.translate(c.width/2,c.height/2);ctx.rotate(readable(ctx,0));
    ctx.font='700 4px Archivo, sans-serif';ctx.fillText('BASE · sin imagen',0,-3,c.width-6);
    ctx.font='3px Archivo, sans-serif';ctx.fillText('Pegá las pestañas de base por detrás.',0,3,c.width-6);ctx.restore();return;
  }
  const F=piece.flat,{O,E1,E2}=piece.frame;
  pathPoly(ctx,F);ctx.save();ctx.clip();
  if(plain||!texture){ctx.fillStyle='#e2d9c3';ctx.fill();}
  else if(precise)rasterFace(ctx,piece,texture,c);
  else{const m=ctx.getTransform(),grow=Math.max(.08,1.2/(Math.hypot(m.a,m.b)||1)); // superposición de 1,2 píxeles reales: sin líneas entre triángulos
  for(const triangle of faceMesh(piece.face,c,divisions)){
    const flat=triangle.map(v=>{const d=sub(v.p,O);return [dot(d,E1),dot(d,E2)];});
    triTexture(ctx,texture,...flat,...triangle.map(v=>[v.uv[0]*texture.width,v.uv[1]*texture.height]),grow);
  }}
  ctx.restore();
  for(let edge=0;edge<F.length;edge++){
    const a=F[edge],b=F[(edge+1)%F.length],fold=piece.tabs.find(t=>t.edge===edge);
    ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(...a);
    if(fold){
      const q=fold.points;ctx.lineTo(...q[0]);ctx.lineTo(...q[1]);ctx.lineTo(...q[2]);ctx.lineTo(...q[3]);ctx.lineTo(...b);ctx.stroke();
      ctx.setLineDash([1.5,1]);ctx.beginPath();ctx.moveTo(...q[0]);ctx.lineTo(...q[3]);ctx.stroke();ctx.setLineDash([]);
      const center=centroid(q),angle=Math.atan2(q[3][1]-q[0][1],q[3][0]-q[0][0]);
      ctx.save();ctx.translate(...center);ctx.rotate(readable(ctx,angle));ctx.font='2.2px Archivo, sans-serif';ctx.fillText(fold.label,0,0,Math.max(8,length(sub(q[3],q[0]))-3));ctx.restore();
    }else{ctx.lineTo(...b);ctx.stroke();}
  }
  ctx.restore();
}
export function drawPrintPage(canvas,layout,index,texture,{dpi=90,title='Ilusión 3D',draft=false,plain=false}={}){
  const page=layout.pages[index];if(!page)throw Error('No existe esa hoja.');
  const k=dpi/25.4;canvas.width=Math.round(layout.w*k);canvas.height=Math.round(layout.h*k);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.scale(k,k);
  ctx.fillStyle='#16130f';ctx.font='800 4px Archivo, sans-serif';ctx.fillText(title,10,10,layout.w-55);
  ctx.textAlign='right';ctx.font='700 3px Archivo, sans-serif';ctx.fillText(`${layout.config.paper} · ${index+1}/${layout.pages.length}`,layout.w-10,10);ctx.textAlign='left';
  if(page.cover){
    const c=layout.config,ih=Math.min((layout.w-30)*texture.height/texture.width,layout.h*.32),iw=ih*texture.width/texture.height;
    ctx.drawImage(texture,(layout.w-iw)/2,20,iw,ih);
    let y=26+ih;ctx.font='800 5px Archivo, sans-serif';ctx.fillText(c.flatX?'Pirámide truncada · cuatro caras y un centro plano':'Pirámide · cuatro caras y una punta',12,y);y+=9;
    ctx.font='3.5px Archivo, sans-serif';
    const q=1-c.depth/c.distance,steps=['Imprimí al 100% / tamaño real, sin ajustar a la página.','Recortá por la línea continua. Doblá las pestañas por la punteada.','A = arriba · B = derecha · C = abajo · D = izquierda. Cada pestaña dice dónde va.',
      'Pegá la pestaña lateral de A detrás de B, B detrás de C, C detrás de D y D detrás de A.'];
    if(c.flatX)steps.push('Pegá las cuatro pestañas del centro plano detrás del borde superior de A, B, C y D.');
    steps.push(c.base?'Pegá las pestañas de base detrás de la base de apoyo.':'Sujetá las pestañas de base a un cartón del tamaño de la base.');
    const lines=[`Base: ${(c.width/10).toFixed(1)} × ${(c.height/10).toFixed(1)} cm · profundidad: ${(c.depth/10).toFixed(1)} cm`+(c.flatX?` · centro: ${(c.width*c.flatX*q/10).toFixed(1)} × ${(c.height*c.flatY*q/10).toFixed(1)} cm`:''),
      `Vista de frente a ${(c.distance/1000).toFixed(2)} m. ${c.flatX?'El centro plano':'La punta'} corresponde al punto marcado en la foto.`,
      ...steps.map((s,i)=>`${i+1}. ${s}`),
      `La imagen queda hacia afuera. ${c.flatX?'El centro':'La punta'} sobresale hacia quien mira.`,
      'Si una pieza ocupa varias hojas, hacé coincidir la imagen en los 8 mm repetidos.',
      'Mirá de frente y desplazate suavemente hacia los costados para observar el efecto.'];
    for(const line of lines){ctx.fillText(line,12,y,layout.w-24);y+=7;}
  }else{
    for(const placement of page.placements){
      const {piece,angle,offsetX,offsetY}=placement,b=rotatedBounds(piece,angle);
      ctx.save();ctx.beginPath();ctx.rect(PAGE_MARGIN.x,PAGE_MARGIN.y,layout.area.w,layout.area.h);ctx.clip();
      ctx.translate(PAGE_MARGIN.x+placement.x-offsetX-b.x0,PAGE_MARGIN.y+placement.y-offsetY-b.y0);ctx.rotate(angle);
      drawPiece(ctx,piece,texture,layout.config,{precise:dpi>=180&&!draft,divisions:draft?4:20,plain});ctx.restore();
    }
    if(page.tile){ctx.font='700 3px Archivo, sans-serif';ctx.fillText(`${page.placements[0].piece.label} · fila ${page.tile.row+1}/${page.tile.rows} · columna ${page.tile.col+1}/${page.tile.cols} · superposición 8 mm`,10,layout.h-15,layout.w-20);}
  }
  ctx.strokeStyle='#16130f';ctx.lineWidth=.25;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(10,layout.h-11);ctx.lineTo(110,layout.h-11);ctx.moveTo(10,layout.h-13);ctx.lineTo(10,layout.h-9);ctx.moveTo(110,layout.h-13);ctx.lineTo(110,layout.h-9);ctx.stroke();
  ctx.font='2.6px Archivo, sans-serif';ctx.textAlign='center';ctx.fillText('Esta línea debe medir 10 cm',60,layout.h-6.5);ctx.textAlign='right';ctx.fillText('Continua: cortar · Punteada: doblar',layout.w-10,layout.h-6.5);
  return canvas;
}

// PDF mínimo de las hojas JPG, adaptado del exportador existente del servidor para permitir descarga local en Chrome.
export function printPdf(images,widthMM,heightMM){
  const encoder=new TextEncoder(),bytes=s=>encoder.encode(s),join=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;};
  const objects=[],add=data=>{objects.push(data);return objects.length;},kids=[],pagesId=2+images.length*3;
  const wPt=+(widthMM*72/25.4).toFixed(5),hPt=+(heightMM*72/25.4).toFixed(5);add(null);
  images.forEach(({data,width,height},i)=>{
    if(data[0]!==255||data[1]!==216)throw Error('No se pudo generar una hoja JPG válida.');
    const image=add(join([bytes(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`),data,bytes('\nendstream')]));
    const command=`q ${wPt} 0 0 ${hPt} 0 0 cm /Im${i} Do Q`,stream=add(bytes(`<< /Length ${command.length} >>\nstream\n${command}\nendstream`));
    const page=add(bytes(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im${i} ${image} 0 R >> >> /Contents ${stream} 0 R >>`));kids.push(`${page} 0 R`);
  });
  add(bytes(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`));objects[0]=bytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const parts=[bytes('%PDF-1.4\n')],offsets=[];let offset=parts[0].length;
  objects.forEach((object,i)=>{const b=join([bytes(`${i+1} 0 obj\n`),object,bytes('\nendobj\n')]);offsets.push(offset);offset+=b.length;parts.push(b);});
  parts.push(bytes(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`));
  return join(parts);
}
