const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const engine=()=>import('data:text/javascript;base64,'+fs.readFileSync(require('node:path').join(__dirname,'../web/_app/art-engine.js')).toString('base64'));
function canvas(trace){
 const c={width:400,height:300};
 c.getContext=()=>new Proxy({canvas:c,measureText:t=>({width:t.length*5})},{get(o,k){if(k in o)return o[k];return (...args)=>{trace.push([k,...args.map(a=>typeof a==='object'?'object':a)]);if(k.startsWith('create'))return {addColorStop:(...a)=>trace.push(['color',...a])};};},set(o,k,v){o[k]=v;trace.push([k,typeof v==='object'?'object':v]);return true;}});
 return c;
}
test('los diez pinceles de Zine renderizan de forma reproducible con presión',async()=>{
 const e=await engine();assert.equal(Object.keys(e.BRUSHES).length,10);
 const original=global.document;
 try{
  for(const b of Object.keys(e.BRUSHES)){
   const run=()=>{const trace=[];global.document={createElement:()=>canvas(trace)};e.drawStrokes(canvas(trace).getContext('2d'),[{b,p:[[4,4,.2],[8,10,.8],[16,15,1]],w:2,c:'#d9381a',o:.8,seed:123}],0,0,400,300,4);return trace;};
   const first=run();assert.ok(first.length>10,b);assert.deepEqual(first,run(),b);
  }
 }finally{global.document=original;}
});
test('texto conserva saltos, alineación y dibujo al escalar a impresión',async()=>{
 const e=await engine(),trace=[],ctx=canvas(trace).getContext('2d');
 const text={content:'Hola\nNeo Board',font:'ui',size:28,align:'right',vAlign:'top',color:'#16130f'};
 const layout=e.layoutText(ctx,text,200,140,2);
 assert.deepEqual(layout.lines,['Hola','Neo Board']);assert.match(layout.font,/Archivo/);
 e.drawPageText(ctx,text,0,0,100,70,2,false);
 assert.equal(trace.filter(x=>x[0]==='fillText').length,2);
 assert.ok(trace.some(x=>x[0]==='clip'));
});
