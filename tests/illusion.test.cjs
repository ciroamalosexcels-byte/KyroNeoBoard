const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const engine=()=>import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../web/_app/illusion-engine.js')).toString('base64'));
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const close=(a,b,eps=1e-7)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const CONFIGS=[{},{width:750,height:240,depth:260,u:.84,v:.19,distance:1600},{width:70,height:820,depth:350,u:.06,v:.92},{flat:.35},{width:540,height:160,depth:210,u:.9,v:.13,flat:.6},{flatX:.5,flatY:.2,u:.3,v:.6}];

test('la punta (o el centro plano) y las esquinas reconstruyen la foto desde la distancia elegida',async()=>{
 const e=await engine();
 for(const value of CONFIGS){
  const m=e.pyramidModel(value),c=m.config;
  e.projectUV(m.apex,c).forEach((v,i)=>close(v,[c.u,c.v][i]));
  m.corners.forEach((p,i)=>e.projectUV(p,c).forEach((v,j)=>close(v,[[0,0],[1,0],[1,1],[0,1]][i][j])));
  assert.equal(m.faces.length,c.flatX?5:4);
  let area=0;
  for(const face of m.faces){
   assert.ok(face.normal[2]>0);
   const mesh=e.faceMesh(face,c,12);assert.equal(mesh.length,144*(face.vertices.length-2));
   for(const tri of mesh){
    for(const v of tri){close(v.bary.reduce((a,b)=>a+b),1);assert.ok(v.uv.every(n=>n>=-1e-8&&n<=1+1e-8));e.projectUV(v.p,c).forEach((n,i)=>close(n,v.uv[i]));}
    const [a,b,t]=tri.map(v=>v.uv);area+=Math.abs((b[0]-a[0])*(t[1]-a[1])-(b[1]-a[1])*(t[0]-a[0]))/2;
   }
  }
  close(area,1,1e-6);
 }
});

test('el centro plano es un rectángulo paralelo a la base y se ve centrado en el punto de fuga',async()=>{
 const e=await engine(),m=e.pyramidModel({width:300,height:200,depth:120,u:.3,v:.7,flatX:.4,flatY:.25}),c=m.config,f=[c.flatX,c.flatY];
 m.top.forEach(p=>close(p[2],c.depth));
 close(distance(m.top[0],m.top[1]),distance(m.top[3],m.top[2]));close(distance(m.top[1],m.top[2]),distance(m.top[0],m.top[3]));
 const uv=m.top.map(p=>e.projectUV(p,c));
 uv.forEach((p,i)=>{const corner=[[0,0],[1,0],[1,1],[0,1]][i];p.forEach((v,k)=>close(v,[c.u,c.v][k]+f[k]*(corner[k]-[c.u,c.v][k])));});
 for(const face of m.faces.slice(0,4)){const [a,b,t]=face.vertices,n=cross(sub(b,a),sub(t,a));close(dot(n,sub(face.vertices[3],a)),0,1e-6);} // cada trapecio es plano
});

test('las caras desplegadas conservan sus aristas, las uniones y no salen espejadas',async()=>{
 const e=await engine();
 for(const config of CONFIGS){
  const pieces=e.unfoldPyramid(config).filter(p=>p.kind==='face'),c=e.normalizePyramid(config);assert.equal(pieces.length,c.flatX?5:4);
  for(const piece of pieces){
   const V=piece.face.vertices,F=piece.flat,n=V.length;
   for(let i=0;i<n;i++)close(distance(F[i],F[(i+1)%n]),distance(V[i],V[(i+1)%n]),1e-6);
   for(let i=2;i<n;i++)close(distance(F[0],F[i]),distance(V[0],V[i]),1e-6);
   // Mirada del lado impreso, la hoja gira igual que la cara mirada desde afuera.
   const c2=(F[1][0]-F[0][0])*(F[2][1]-F[0][1])-(F[1][1]-F[0][1])*(F[2][0]-F[0][0]),c3=dot(cross(sub(V[1],V[0]),sub(V[2],V[0])),piece.face.normal);
   assert.ok(c2*c3<0,piece.label+' sale espejada');
   // las pestañas quedan afuera de la pieza
   const mid=[0,1].map(k=>F.reduce((s,p)=>s+p[k],0)/n);
   for(const t of piece.tabs){const out=[0,1].map(k=>(t.points[1][k]+t.points[2][k])/2);assert.ok(distance(out,mid)>distance([0,1].map(k=>(t.points[0][k]+t.points[3][k])/2),mid));}
  }
  const sides=pieces.filter(p=>p.key!=='top');
  for(const piece of sides){const next=sides[(piece.face.id+1)%4],last=next.flat.length-1;close(distance(piece.flat[1],piece.flat[2]),distance(next.flat[0],next.flat[last]),1e-6);assert.equal(piece.tabs.length,2);}
  if(c.flatX)assert.equal(pieces.find(p=>p.key==='top').tabs.length,4);
 }
});

// Separación entre dos polígonos convexos (teorema del eje separador).
function apart(A,B){
 for(const P of [A,B])for(let i=0;i<P.length;i++){
  const a=P[i],b=P[(i+1)%P.length],n=[a[1]-b[1],b[0]-a[0]],pa=A.map(p=>dot(p,n)),pb=B.map(p=>dot(p,n));
  if(Math.max(...pa)<=Math.min(...pb)+1e-6||Math.max(...pb)<=Math.min(...pa)+1e-6)return true;
 }
 return false;
}
test('el acomodo gira las piezas, no las superpone, no sale de la hoja y usa menos hojas',async()=>{
 const e=await engine();
 for(const config of [{},{flat:.3},{paper:'A3',width:320,height:210,depth:90,flat:.4},{width:900,height:500,depth:360}]){
  const plan=e.layoutPrint(config),c=plan.config;assert.ok(plan.pages[0].cover);const pieces=new Set();
  for(const page of plan.pages.slice(1)){
   const hulls=page.placements.map(p=>{pieces.add(p.piece.key);return e.placedHull(p);});
   if(!page.tile){
    for(const H of hulls)for(const [x,y] of H)assert.ok(x>=e.PAGE_MARGIN.x-1e-6&&y>=e.PAGE_MARGIN.y-1e-6&&x<=e.PAGE_MARGIN.x+plan.area.w+1e-6&&y<=e.PAGE_MARGIN.y+plan.area.h+1e-6);
    for(let i=0;i<hulls.length;i++)for(let j=i+1;j<hulls.length;j++)assert.ok(apart(hulls[i],hulls[j]),'piezas superpuestas');
   }else{
    const p=page.placements[0],b=e.rotatedBounds(p.piece,p.angle),w=b.x1-b.x0,h=b.y1-b.y0;assert.equal(page.tile.overlap,8);assert.ok(p.offsetX<w&&p.offsetY<h);
    if(page.tile.col===page.tile.cols-1)assert.ok(p.offsetX+plan.area.w>=w-1e-7);if(page.tile.row===page.tile.rows-1)assert.ok(p.offsetY+plan.area.h>=h-1e-7);
   }
  }
  assert.equal(pieces.size,4+(c.flatX?1:0)+(c.base?1:0));assert.ok(plan.pages.length<=64);
 }
 assert.ok(e.layoutPrint({}).pages.length<=4,'la pirámide de prueba entra en tres hojas más la guía');
});

test('el máximo es el tamaño más grande en el que cada pieza entra entera en una hoja',async()=>{
 const e=await engine();
 for(const config of [{},{paper:'A3',flat:.3},{width:700,height:300,depth:200}]){
  const lim=e.fitLimits(config);assert.ok(lim.max>lim.min);
  assert.deepEqual(e.layoutPrint(e.scalePyramid(config,lim.max)).oversize,[]);
  assert.ok(e.layoutPrint(e.scalePyramid(config,lim.max*1.03)).oversize.length>0);
 }
});

test('el PDF utiliza medidas físicas exactas y una tabla de objetos con offsets correctos',async()=>{
 const e=await engine(),image={data:new Uint8Array([255,216,255,217]),width:2480,height:3508};
 const pdf=e.printPdf([image,image],210,297),text=Buffer.from(pdf).toString('latin1');
 assert.match(text,/\/MediaBox \[0 0 595\.27559 841\.88976\]/);assert.match(text,/\/Count 2/);
 const xref=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(text.slice(xref,xref+4),'xref');
 const entries=text.slice(xref).split('\n').slice(3).filter(line=>/^\d{10} 00000 n/.test(line));
 entries.forEach((line,i)=>assert.equal(text.slice(Number(line.slice(0,10)),Number(line.slice(0,10))+String(i+1).length+6),`${i+1} 0 obj`));
});
