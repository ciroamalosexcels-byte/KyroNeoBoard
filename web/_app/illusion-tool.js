import { normalizePyramid, preparePhoto, layoutPrint, drawPrintPage, printPdf, fitLimits, scalePyramid, unfoldPyramid, rotatedBounds } from './illusion-engine.js';
import { createPyramidPreview } from './illusion-preview.js';
import { createSheetBoard } from './illusion-board.js';
import { icon, safeName, prefs, savePrefs, winDialog, setJpegDpi } from './mesa.js';
import { play } from './sound.js';

const blobOf=(cv,type='image/jpeg',quality=.95)=>new Promise((resolve,reject)=>cv.toBlob(b=>b?resolve(b):reject(Error('No se pudo generar la hoja.')),type,quality));
const clone=v=>JSON.parse(JSON.stringify(v));
const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);};

export function mountIllusionTool({button,getSelected,getImage,loadFull,commit,toast,guest=false,projectTitle=()=>'',flush=async()=>({ok:true})}){
  const root=document.createElement('div');root.className='illusion-modal';root.hidden=true;
  root.innerHTML=`<section class="illusion-box" role="dialog" aria-modal="true" aria-labelledby="illusionTitle">
    <header class="illusion-head"><h2 id="illusionTitle">Ilusión 3D · Pirámide</h2><span class="illusion-spec"></span><button type="button" class="illusion-close" aria-label="Cerrar ilusión 3D">${icon('x')}</button></header>
    <div class="illusion-body"><aside class="illusion-settings" aria-label="Ajustes de la pirámide">
      <label>Nombre<input data-py="name" maxlength="80" autocomplete="off"></label>
      <div class="illusion-group"><span class="illusion-sub">Punta sobre la foto</span><canvas class="illusion-picker" data-tip="Punta sobre la foto|Arrastrá el punto · Shift + arrastrar: centro plano|Esquinas del rectángulo: tamaño del centro" tabindex="0" role="slider" aria-label="Posición de la punta en la foto" aria-valuemin="5" aria-valuemax="95"></canvas></div>
      <div class="illusion-fields"><label>Ancho (cm)<input type="number" data-py="width" min="4" max="100" step=".1"></label><label>Alto (cm)<input type="number" data-py="height" min="4" max="100" step=".1"></label></div>
      <label><span class="illusion-label">Profundidad<output data-depth></output></span><input type="range" data-py="depth" min=".5" max="60" step=".1"></label>
      <div class="illusion-group"><span class="illusion-sub">Centro plano</span><div class="illusion-fields"><label>Ancho (cm)<input type="number" data-py="topW" min="0" step=".1" aria-label="Ancho del centro plano en cm"></label><label>Alto (cm)<input type="number" data-py="topH" min="0" step=".1" aria-label="Alto del centro plano en cm"></label></div></div>
      <details><summary>Armado y observación</summary><div class="illusion-advanced"><label>Distancia para mirar de frente (cm)<input type="number" data-py="distance" min="30" max="1000" step="5"></label><label>Pestañas para pegar (mm)<input type="number" data-py="tab" min="3" max="15" step="1"></label><label class="illusion-check"><input type="checkbox" data-py="base">Incluir base de apoyo</label></div></details>
      <p class="illusion-status" role="status" aria-live="polite"></p><progress hidden max="1" value="0" aria-label="Exportación de la plantilla"></progress>
    </aside><div class="illusion-viewer"><div class="illusion-stage is-3d" tabindex="0" role="region" aria-label="Vista de la pirámide: arrastrar para girar, rueda para acercar"><canvas class="illusion-canvas" aria-label="Vista de la pirámide"></canvas></div>
      <div class="illusion-controls"><div class="illusion-modes"><button type="button" data-mode="sheets">Hojas</button><button type="button" data-mode="pyramid" class="on">Pirámide</button></div>
      <button type="button" class="illusion-control" data-action="center" aria-label="Centrar la punta" data-tip="Centrar la punta">${icon('focal')}</button>
      <button type="button" class="illusion-control" data-action="front" aria-label="Mirar de frente" data-tip="Mirar de frente|Doble clic en la vista: volver">${icon('fit')}</button><button type="button" class="illusion-control" data-action="flip" aria-label="Dar vuelta" data-tip="Dar vuelta">${icon('rotate')}</button><button type="button" class="illusion-control" data-action="sweep" aria-label="Recorrer la ilusión" data-tip="Recorrer la ilusión">${icon('play')}</button><button type="button" class="illusion-control" data-action="plain" aria-label="Ver la forma sin foto" data-tip="Ver la forma sin foto">${icon('pyramid')}</button>
      <span class="illusion-page"></span><button type="button" class="illusion-control" data-action="home" aria-label="Ver todas las hojas" data-tip="Ver todas las hojas|Rueda: acercar · Arrastrá el fondo para moverte">${icon('fit')}</button><button type="button" class="illusion-control" data-action="jpg" aria-label="Descargar la hoja elegida en JPG" data-tip="Descargar la hoja elegida en JPG|300 dpi">${icon('save')}</button>
      <span class="illusion-sep"></span>
      <button type="button" class="illusion-control" data-action="undo" aria-label="Deshacer" data-tip="Deshacer · Ctrl+Z">${icon('undo')}</button><button type="button" class="illusion-control" data-action="redo" aria-label="Rehacer" data-tip="Rehacer · Ctrl+Y">${icon('redo')}</button>
      <div class="illusion-seg" role="group" aria-label="Papel"><button type="button" data-paper="A4" data-tip="Hojas A4">A4</button><button type="button" data-paper="A3" data-tip="Hojas A3">A3</button></div>
      <button type="button" class="illusion-act illusion-apply" data-action="apply" aria-label="Crear ilusión" data-tip="Crear ilusión|Ctrl+S">${icon('check')}</button>
      <button type="button" class="illusion-act illusion-export" data-action="export" aria-label="Exportar plantilla" data-tip="Exportar plantilla|PDF y JPG a tamaño real · Ctrl+P">${icon('print')}</button></div>
    </div></div></section>`;
  document.body.append(root);
  const q=s=>root.querySelector(s),all=s=>[...root.querySelectorAll(s)],stage=q('.illusion-stage'),canvas=q('.illusion-canvas'),picker=q('.illusion-picker');
  let layoutKey='',source=null,editing=null,texture=null,config=null,name='',preview=null,board=null,mode='pyramid',page=0,layout=null,limits=null,selected=null,scaling=null,busy=false,dirty=false,previousFocus=null,redraw=0;
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const isDesktop=/Electron\//.test(navigator.userAgent),status=text=>{q('.illusion-status').textContent=text;};
  function fields(){
    if(!config)return;
    const qd=1-config.depth/config.distance,top={topW:config.width*config.flatX*qd,topH:config.height*config.flatY*qd};
    for(const k of ['topW','topH']){const input=q(`[data-py="${k}"]`);if(document.activeElement!==input)input.value=+(top[k]/10).toFixed(1);}
    for(const k of ['width','height','depth','distance']){const input=q(`[data-py="${k}"]`);if(document.activeElement!==input)input.value=+(config[k]/10).toFixed(2);}
    if(document.activeElement!==q('[data-py=tab]'))q('[data-py=tab]').value=config.tab;q('[data-py=base]').checked=config.base;if(document.activeElement!==q('[data-py=name]'))q('[data-py=name]').value=name;
    q('[data-depth]').textContent=cm(config.depth)+' cm';
    q('[data-action=undo]').disabled=busy||!hist.undo.length;q('[data-action=redo]').disabled=busy||!hist.redo.length;
    all('[data-paper]').forEach(b=>b.classList.toggle('on',b.dataset.paper===config.paper));
    q('.illusion-spec').textContent=`${cm(config.width)} × ${cm(config.height)} cm · profundidad ${cm(config.depth)} cm`;
    picker.setAttribute('aria-valuenow',String(Math.round(config.u*100)));picker.setAttribute('aria-valuetext',`Horizontal ${Math.round(config.u*100)}%, vertical ${Math.round(config.v*100)}%`);
    const apply=q('[data-action=apply]'),label=editing?'Guardar cambios':'Crear ilusión';apply.setAttribute('aria-label',label);apply.dataset.tip=label+'|Ctrl+S';q('[data-action=apply]').disabled=busy||!!editing&&!dirty;
    q('[data-action=export]').disabled=busy||guest||!layout;q('[data-action=jpg]').disabled=busy||guest||!layout;
    q('[data-action=sweep]').disabled=reducedMotion.matches;
    all('[data-action=home],[data-action=jpg],.illusion-page').forEach(e=>e.hidden=mode!=='sheets');
    all('[data-action=front],[data-action=flip],[data-action=sweep],[data-action=plain]').forEach(e=>e.hidden=mode!=='pyramid');
    all('[data-mode]').forEach(b=>b.classList.toggle('on',b.dataset.mode===mode));
  }
  let pickerRect=null;
  function drawPicker(){
    if(!texture||!config)return;
    const dpr=Math.min(2,devicePixelRatio||1),w=Math.max(120,picker.clientWidth),h=Math.max(100,picker.clientHeight);picker.width=Math.round(w*dpr);picker.height=Math.round(h*dpr);
    const ctx=picker.getContext('2d');ctx.scale(dpr,dpr);ctx.fillStyle='#e2d9c3';ctx.fillRect(0,0,w,h);
    const k=Math.min((w-8)/texture.width,(h-8)/texture.height),iw=texture.width*k,ih=texture.height*k,x=(w-iw)/2,y=(h-ih)/2;
    pickerRect={x,y,w:iw,h:ih};ctx.drawImage(texture,x,y,iw,ih);
    const g=pickerGeom();ctx.strokeStyle='#ffe14d';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();g.corners.forEach((p,i)=>{ctx.moveTo(...p);ctx.lineTo(...(config.flatX?g.rect[i]:[g.px,g.py]));});ctx.stroke();ctx.setLineDash([]);
    if(config.flatX){ctx.lineWidth=1.5;ctx.beginPath();g.rect.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.stroke();}
    for(const [hx,hy] of g.handles)for(const [dx,dy,color] of [[1.5,1.5,'#16130f'],[0,0,'#ffe14d']]){ctx.fillStyle=color;ctx.beginPath();ctx.arc(hx+dx,hy+dy,4.5,0,Math.PI*2);ctx.fill();} // esquinas del centro plano
    for(const [dx,dy,color,r]of[[2,2,'#16130f',6],[0,0,'#ffe14d',6],[0,0,'#16130f',1.5]]){ctx.fillStyle=color;ctx.beginPath();ctx.arc(g.px+dx,g.py+dy,r,0,Math.PI*2);ctx.fill();}
  }
  function render(){
    if(root.hidden||!config||!texture)return;
    const key=JSON.stringify(config);
    if(!scaling&&key!==layoutKey){layoutKey=key;try{layout=layoutPrint(config);limits=fitLimits(config);limits.top=scalePyramid(config,limits.max);page=Math.min(page,layout.pages.length-1);}catch(error){status(error.message);layout=null;}}
    fields();drawPicker();stage.classList.toggle('is-3d',mode==='pyramid');stage.classList.toggle('is-board',mode==='sheets');preview?.resetSheet();
    if(mode==='pyramid'){
      preview?.set(config,texture);q('.illusion-page').textContent='';
    }else if(layout){
      preview?.stopSweep();showBoard();q('.illusion-page').textContent=`${layout.pages.length-1} hoja${layout.pages.length===2?'':'s'} ${config.paper} + guía`;
    }else{canvas.width=canvas.height=1;q('.illusion-page').textContent='';}
  }
  function schedule(){cancelAnimationFrame(redraw);redraw=requestAnimationFrame(render);}
  // Deshacer / rehacer dentro de la ilusión: se guarda el estado antes de cada cambio.
  // Los cambios seguidos (arrastrar, escribir un número) cuentan como uno solo.
  const hist={undo:[],redo:[],t:0};
  const snapshot=()=>JSON.stringify({config,name});
  function remember(){
    if(!config)return;const s=snapshot(),now=performance.now();
    if(hist.undo.at(-1)!==s&&(now-hist.t>600||!hist.undo.length)){hist.undo.push(s);if(hist.undo.length>100)hist.undo.shift();hist.redo=[];}
    hist.t=now;
  }
  function restore(s){const st=JSON.parse(s);config=normalizePyramid(st.config);name=st.name;dirty=true;page=0;hist.t=0;fields();schedule();}
  function undo(){if(busy||!hist.undo.length)return;hist.redo.push(snapshot());restore(hist.undo.pop());play('tocar');}
  function redo(){if(busy||!hist.redo.length)return;hist.undo.push(snapshot());restore(hist.redo.pop());play('tocar');}
  const cm=mm=>(mm/10).toFixed(1).replace('.',',');
  function pieceSize(piece){const xs=piece.flat.map(p=>p[0]),ys=piece.flat.map(p=>p[1]);return `${cm(Math.max(...xs)-Math.min(...xs))} × ${cm(Math.max(...ys)-Math.min(...ys))} cm`;}
  function badge(){
    const piece=layout?.pages.flatMap(p=>p.placements).find(p=>p.piece.key===selected)?.piece;if(!piece)return '';
    return (scaling?.atMax?'Máximo · ':'')+`${piece.label} · ${pieceSize(piece)}`;
  }
  function showBoard(){board?.set({layout,texture,title:name,selected,page,atMax:!!scaling?.atMax,draft:!!scaling,badge:badge()});}
  // Mientras se arrastra, cada pieza crece desde su centro sin moverse de su hoja; al soltar se vuelven a acomodar.
  function frozen(base,cfg){
    const pieces=new Map(unfoldPyramid(cfg).map(p=>[p.key,p]));
    return {...base,config:cfg,pages:base.pages.map(page=>({...page,placements:page.placements.map(pl=>{
      const piece=pieces.get(pl.piece.key)||pl.piece,a=rotatedBounds(pl.piece,pl.angle),b=rotatedBounds(piece,pl.angle);
      return {...pl,piece,x:pl.x+((a.x1-a.x0)-(b.x1-b.x0))/2,y:pl.y+((a.y1-a.y0)-(b.y1-b.y0))/2};
    })}))};
  }
  function scaleBy(phase,s){
    if(!config||busy||!layout)return;
    if(phase==='start'){remember();scaling={base:clone(config),layout,limits:fitLimits(config),atMax:false,flat:selected==='top'};return;}
    if(!scaling)return;
    if(phase==='move'&&scaling.flat){
      const {base}=scaling,top=.8/Math.max(base.flatX,base.flatY),k=Math.max(.05,Math.min(top,s));
      scaling.atMax=s>top+1e-6;config=normalizePyramid({...base,flatX:base.flatX*k,flatY:base.flatY*k});dirty=true;
      layout=frozen(scaling.layout,config);const qd=1-config.depth/config.distance;
      status(scaling.atMax?'Este es el centro plano más grande posible.':`Centro plano: ${cm(config.width*config.flatX*qd)} × ${cm(config.height*config.flatY*qd)} cm`);
      fields();showBoard();return;
    }
    if(phase==='move'){
      const {base,limits:lim}=scaling,top=Math.max(lim.max,1),k=Math.max(lim.min,Math.min(top,s));
      scaling.atMax=s>top+1e-6&&top===lim.max;config=scalePyramid(base,k);dirty=true;
      layout=frozen(scaling.layout,config);
      const m=scalePyramid(base,lim.max);
      status(scaling.atMax?`Este es el máximo para ${config.paper}: ${cm(m.width)} × ${cm(m.height)} cm. Más grande, alguna pieza ya no entra entera en una hoja.${config.paper==='A4'?' En A3 puede ser más grande.':''}`:`${cm(config.width)} × ${cm(config.height)} cm · profundidad ${cm(config.depth)} cm`);
      fields();showBoard();return;
    }
    if(!scaling.atMax)status('');scaling=null;schedule();
  }
  async function open(item,{sheets=false}={}){
    item ||= getSelected()[0];if(!item||item.mos)return toast('Seleccioná una foto completa para crear una ilusión.',2500);
    const image=getImage(item.file);if(!image)return toast('Esperá a que termine de cargar la foto.',2500);
    if(!root.hidden)return;
    source=clone(item);editing=item.illusion?item.id:null;name=item.illusion?.name||'Pirámide de '+item.file.replace(/\.[^.]+$/,'');
    const transform=item.illusion?.image||{rot:item.rot||0,crop:item.crop};texture=preparePhoto(image,transform);
    config=normalizePyramid(item.illusion||{width:240,height:Math.max(40,Math.min(1000,240*texture.height/texture.width)),image:transform});
    mode=sheets?'sheets':'pyramid';page=0;dirty=!editing;previousFocus=document.activeElement;root.hidden=false;
    q('[data-action=plain]').classList.remove('on');q('[data-action=plain]').setAttribute('aria-pressed','false');
    document.querySelectorAll('.menu.show').forEach(el=>el.classList.remove('show'));document.querySelector('.tip')?.classList.remove('show');
    preview=createPyramidPreview(canvas,stage,{onSweep:active=>{q('[data-action=sweep]').classList.toggle('on',active);q('[data-action=sweep]').setAttribute('aria-pressed',String(active));}});
    board=createSheetBoard(canvas,stage,{onPick:(key,index)=>{selected=key;if(index!=null)page=index;render();},onScale:scaleBy,onPage:d=>{page=Math.max(0,Math.min((layout?.pages.length||1)-1,page+d));showBoard();}});
    selected=null;scaling=null;limits=null;layoutKey='';hist.undo=[];hist.redo=[];hist.t=0;
    preview.set(config,texture,{reset:true});status(guest?'La plantilla la exporta quien abrió la sala.':'');
    render();q('.illusion-close').focus();play('papel');
  }
  function close(){
    if(busy)return;root.hidden=true;preview?.destroy();preview=null;board?.destroy();board=null;scaling=null;cancelAnimationFrame(redraw);texture=null;config=null;source=null;editing=null;
    if(previousFocus?.isConnected)previousFocus.focus();
  }
  async function apply(){
    if(!config||!source)return false;
    if(editing&&!dirty)return true;
    try{
      const item=await commit(source,{...clone(config),name:name.trim()||'Pirámide'},editing);editing=item.id;source=clone(item);name=item.illusion.name;dirty=false;
      fields();status('');toast('Ilusión guardada.',2000);play('guardar');return true;
    }catch(error){status(error.message);toast(error.message,5000);return false;}
  }
  function setBusy(value){busy=value;root.setAttribute('aria-busy',String(value));all('input,summary,[data-paper],[data-mode],.illusion-close,[data-action=center]').forEach(e=>{if('disabled'in e)e.disabled=value;});fields();}
  async function exportPdf(){
    if(busy||guest||!layout)return;
    if(!await apply())return;
    const saved=await flush();if(!saved?.ok)return status('No se pudo guardar el proyecto. Volvé a intentarlo.');
    let target=null;
    if(isDesktop){try{target=await winDialog('folder',{start:prefs.lastExportDir||''});}catch(error){return status(error.message);}if(!target)return status('Exportación cancelada.');prefs.lastExportDir=target;savePrefs();}
    const title=safeName(name||projectTitle()||'Ilusión 3D'),stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=target?target+'\\'+safeName('Ilusión 3D - '+title)+' - '+stamp:null;
    const progress=q('progress');setBusy(true);progress.hidden=false;progress.max=layout.pages.length;progress.value=0;
    let fullTexture=null;
    try{
      await document.fonts.ready;status('Cargando la foto completa…');
      const image=await loadFull(source.file);fullTexture=preparePhoto(image,config.image,20000000);
      const plan=layoutPrint(config),jpgs=[];
      for(let i=0;i<plan.pages.length;i++){
        status(`Preparando hoja ${i+1} de ${plan.pages.length}…`);
        const cv=document.createElement('canvas');drawPrintPage(cv,plan,i,fullTexture,{dpi:300,title});
        const blob=await blobOf(cv),data=setJpegDpi(new Uint8Array(await blob.arrayBuffer()));jpgs.push({data,width:cv.width,height:cv.height});cv.width=cv.height=0;
        if(dir){const response=await fetch('/api/save?'+new URLSearchParams({dir,name:`${title} - ${config.paper} hoja ${String(i+1).padStart(2,'0')}.jpg`}),{method:'POST',body:data});if(!response.ok)throw Error((await response.json()).error||'No se pudo guardar una hoja.');}
        progress.value=i+1;await new Promise(r=>setTimeout(r,0));
      }
      const pdf=printPdf(jpgs,plan.w,plan.h),filename=`${title} - ${config.paper} plantilla.pdf`;
      if(dir){const response=await fetch('/api/save?'+new URLSearchParams({dir,name:filename}),{method:'POST',body:pdf});if(!response.ok)throw Error((await response.json()).error||'No se pudo guardar el PDF.');status(`PDF y ${plan.pages.length} hojas JPG guardados.`);toast('Plantilla guardada en '+dir,7000);}
      else{download(new Blob([pdf],{type:'application/pdf'}),filename);status(`PDF descargado · ${plan.pages.length} hojas ${config.paper} · imprimir al 100%.`);}
      play('listo');
    }catch(error){status('No se pudo exportar: '+error.message);toast(error.message,7000);}finally{fullTexture=null;progress.hidden=true;setBusy(false);}
  }
  async function jpg(){
    if(guest||busy||!layout)return;setBusy(true);
    try{const image=await loadFull(source.file),tex=preparePhoto(image,config.image,20000000),cv=document.createElement('canvas');drawPrintPage(cv,layout,page,tex,{dpi:300,title:name});const blob=await blobOf(cv),data=setJpegDpi(new Uint8Array(await blob.arrayBuffer()));cv.width=cv.height=0;download(new Blob([data],{type:'image/jpeg'}),`${safeName(name)} - hoja ${page+1}.jpg`);status('Hoja JPG descargada a 300 dpi.');}
    catch(error){status(error.message);}finally{setBusy(false);}
  }
  let backdropDown=false; // cerrar con el fondo solo si el clic empezó ahí (no al soltar un arrastre)
  root.addEventListener('pointerdown',e=>{backdropDown=e.target===root;});
  root.addEventListener('click',e=>{
    if(e.target===root){if(backdropDown)close();backdropDown=false;return;}if(e.target.closest('.illusion-close'))return close();
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.paper){remember();config.paper=b.dataset.paper;dirty=true;page=0;fields();schedule();play('tocar');return;}
    if(b.dataset.mode){mode=b.dataset.mode;schedule();play('tocar');return;}
    switch(b.dataset.action){
      case'center':remember();config.u=config.v=.5;dirty=true;fields();schedule();break;
      case'apply':apply();break;case'export':exportPdf();break;case'jpg':jpg();break;
      case'front':preview?.reset(true);break;case'flip':preview?.flip();break;
      case'sweep':preview?.sweep();break;
      case'plain':b.classList.toggle('on');b.setAttribute('aria-pressed',String(b.classList.contains('on')));preview?.plain(b.classList.contains('on'));break;
      case'home':board?.reset();break;
      case'undo':undo();break;case'redo':redo();break;
    }
  });
  root.addEventListener('input',e=>{
    if(!config||busy)return;const key=e.target.dataset.py;if(!key)return;
    remember();
    if(key==='name')name=e.target.value;
    else if(key==='base')config.base=e.target.checked;
    else if(key==='topW'||key==='topH'){
      const v=Math.max(0,e.target.valueAsNumber||0)*10,qd=1-config.depth/config.distance,x=key==='topW';
      const f=v/((x?config.width:config.height)*qd);
      if(!f){config.flatX=config.flatY=0;}
      else if(x){config.flatX=f;if(!config.flatY)config.flatY=f;}else{config.flatY=f;if(!config.flatX)config.flatX=f;}
    }
    else if(Number.isFinite(e.target.valueAsNumber))config[key]=e.target.valueAsNumber*(['width','height','depth','distance'].includes(key)?10:1);
    config=normalizePyramid(config);dirty=true;page=0;fields();schedule();
  });
  root.addEventListener('change',e=>{const k=e.target.dataset.py;if(config&&(k==='topW'||k==='topH')){const qd=1-config.depth/config.distance;e.target.value=+((k==='topW'?config.width*config.flatX:config.height*config.flatY)*qd/10).toFixed(1);return;}if(config&&k&&k!=='name'&&k!=='base'){e.target.value=+(['width','height','depth','distance'].includes(k)?config[k]/10:config[k]).toFixed(2);}});
  // El centro plano, visto sobre la foto: el rectángulo alrededor del punto de fuga que queda de frente.
  // Sin centro plano no hay tiradores (no le roban el clic al punto): Shift + arrastrar lo abre.
  function pickerGeom(){
    const p=pickerRect,px=p.x+config.u*p.w,py=p.y+config.v*p.h,corners=[[p.x,p.y],[p.x+p.w,p.y],[p.x+p.w,p.y+p.h],[p.x,p.y+p.h]];
    const rect=corners.map(([cx,cy])=>[px+config.flatX*(cx-px),py+config.flatY*(cy-py)]);
    const handles=config.flatX?rect:[];
    return {px,py,corners,rect,handles};
  }
  let pickDrag=null;
  const quadrant=(x,y)=>{const g=pickerGeom(),r=x>=g.px,b=y>=g.py;return r?(b?2:1):(b?3:0);}; // hacia qué esquina se abre
  const pickerPoint=e=>{const r=picker.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
  const handleAt=(x,y)=>pickerRect&&config?pickerGeom().handles.findIndex(([hx,hy])=>Math.hypot(hx-x,hy-y)<9):-1;
  function dragFlat(e){
    const g=pickerGeom(),[x,y]=pickerPoint(e),[cx,cy]=g.corners[pickDrag.i],lim=v=>Math.max(0,Math.min(.8,v));
    let fx=lim((x-g.px)/(cx-g.px||1)),fy=lim((y-g.py)/(cy-g.py||1));
    if(e.shiftKey)fx=fy=Math.max(fx,fy); // Shift: proporcional
    if(fx<.02&&fy<.02)fx=fy=0;else{fx=Math.max(fx,.02);fy=Math.max(fy,.02);}
    config=normalizePyramid({...config,flatX:fx,flatY:fy});dirty=true;page=0;fields();schedule();
  }
  function pick(e){if(busy||!config||!pickerRect)return;const r=picker.getBoundingClientRect(),p=pickerRect;config.u=Math.max(.05,Math.min(.95,(e.clientX-r.left-p.x)/p.w));config.v=Math.max(.05,Math.min(.95,(e.clientY-r.top-p.y)/p.h));dirty=true;fields();schedule();}
  let picking=false; // el arrastre sobre la foto se sigue en toda la ventana
  picker.addEventListener('pointerdown',e=>{if(busy||e.button!==0)return;try{picker.setPointerCapture(e.pointerId);}catch{}remember();picking=true;const pt=pickerPoint(e),i=handleAt(...pt);pickDrag=i>=0?{i}:e.shiftKey&&!config.flatX?{i:quadrant(...pt)}:null;if(pickDrag)dragFlat(e);else pick(e);});
  addEventListener('pointermove',e=>{if(root.hidden)return;if(picking){pickDrag?dragFlat(e):pick(e);return;}if(e.target!==picker)return;const i=handleAt(...pickerPoint(e));picker.style.cursor=i<0?'':i%2?'nesw-resize':'nwse-resize';});
  addEventListener('pointerup',()=>{picking=false;pickDrag=null;});addEventListener('pointercancel',()=>{picking=false;pickDrag=null;});
  picker.addEventListener('keydown',e=>{if(!config||busy||!e.key.startsWith('Arrow'))return;e.preventDefault();remember();const step=e.shiftKey?.05:.01;if(e.key==='ArrowLeft')config.u-=step;if(e.key==='ArrowRight')config.u+=step;if(e.key==='ArrowUp')config.v-=step;if(e.key==='ArrowDown')config.v+=step;config=normalizePyramid(config);dirty=true;schedule();});
  root.addEventListener('keydown',e=>{
    e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();return;}
    const typing=e.target.matches?.('input:not([type=range]):not([type=checkbox])');
    if((e.ctrlKey||e.metaKey)&&!typing&&(e.key.toLowerCase()==='z'||e.key.toLowerCase()==='y')){e.preventDefault();(e.key.toLowerCase()==='y'||e.shiftKey?redo:undo)();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(!busy)apply();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='p'){e.preventDefault();exportPdf();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();return;}
    if(e.key==='Tab'){const focusable=all('button:not(:disabled),input:not(:disabled),summary,canvas[tabindex],.illusion-stage').filter(el=>el.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
  });
  root.addEventListener('keyup',e=>e.stopPropagation());
  for(const event of ['paste','copy','cut'])root.addEventListener(event,e=>e.stopPropagation());
  reducedMotion.addEventListener('change',()=>{if(!root.hidden){preview?.stopSweep();fields();}});
  const resize=new ResizeObserver(()=>{if(!root.hidden)schedule();});resize.observe(picker);
  button.addEventListener('click',()=>open());
  const sync=()=>{const selected=getSelected();button.disabled=selected.length!==1||!!selected[0]?.mos;button.classList.toggle('dim',button.disabled);button.classList.toggle('on',selected.length===1&&!!selected[0].illusion);};
  sync();
  return {open,sync,close,locate:key=>board?.locate(key),get visible(){return!root.hidden;},debug(){return {scaling:!!scaling,selected,limits:limits&&{...limits},oversize:layout?.oversize,status:q('.illusion-status').textContent,config:config&&clone(config),editing,mode,page,pages:layout?.pages.length,view:preview&&{yaw:preview.view.yaw,pitch:preview.view.pitch,dist:preview.view.dist},busy,dirty};}};
}
