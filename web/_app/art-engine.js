// Motores de pinceles y texto tomados de Kyro Zine Generator. UI adaptada a Neo Board.
const PT_TO_MM=25.4/72;
const FONTS=[{id:"ui",css:"Archivo, sans-serif"}];
function hsvToRgb(h,s,v){
  const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x;b=0;} else if(h<120){r=x;g=c;b=0;} else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;} else if(h<300){r=x;g=0;b=c;} else {r=c;g=0;b=x;}
  return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
}
function rgbToHsv(r,g,b){
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=0;
  if(d!==0){
    if(max===r) h=60*(((g-b)/d)%6);
    else if(max===g) h=60*((b-r)/d+2);
    else h=60*((r-g)/d+4);
  }
  if(h<0)h+=360;
  const s=max===0?0:d/max, v=max;
  return [h,s,v];
}
function rgbToHex(r,g,b){ return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join(''); }
function hexToRgb(hex){
  hex=(hex||'#000000').replace('#','');
  if(hex.length===3) hex=hex.split('').map(c=>c+c).join('');
  if(!/^[0-9a-fA-F]{6}$/.test(hex)) hex='000000';
  const n=parseInt(hex,16);
  return [(n>>16)&255,(n>>8)&255,n&255];
}

function rng(seed){
  let a = (seed|0) >>> 0;
  return ()=>{
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ a>>>15, 1|a);
    t = (t + Math.imul(t ^ t>>>7, 61|t)) ^ t;
    return ((t ^ t>>>14) >>> 0) / 4294967296;
  };
}
function strokePressure(st, pr){
  /* st.pr = sensitivity 0..1 (true = 1, false = 0); pr = pen pressure 0..1 */
  const sens = st.pr===false ? 0 : (st.pr===true || st.pr==null) ? 1 : Math.max(0, Math.min(1, st.pr));
  if(sens===0 || pr==null) return 1;
  const mn = st.pm==null ? 0.08 : st.pm;
  const x = Math.pow(Math.max(0, Math.min(1, pr)), st.pg || 1);
  return 1 - sens*(1 - (mn + (1-mn)*x));
}
function strokeOpacity(st, pr){
  const so = st.po==null ? 0 : st.po;
  if(!so || pr==null) return 1;
  const x = Math.pow(Math.max(0, Math.min(1, pr)), st.pg || 1);
  return 1 - so*(1 - (0.1 + 0.9*x));
}
function rgbaOf(hex, a){
  const c = hexToRgb(hex);
  return 'rgba('+c[0]+','+c[1]+','+c[2]+','+Math.max(0,Math.min(1,a)).toFixed(3)+')';
}
/* round-capped segments whose width follows the pressure */
function varLine(o, st, k, wmul, fade){
  const p = st.p, base = st.w*k*wmul;
  o.lineCap = 'round'; o.lineJoin = 'round';
  if(p.length===1){
    o.beginPath(); o.arc(p[0][0]*k, p[0][1]*k, Math.max(.4, base*strokePressure(st,p[0][2])/2), 0, Math.PI*2); o.fill();
    return;
  }
  for(let i=1;i<p.length;i++){
    const pav = (p[i][2]!=null && p[i-1][2]!=null) ? (p[i][2]+p[i-1][2])/2 : null;
    const f = strokePressure(st, pav);
    o.lineWidth = Math.max(.6, base*f);
    o.globalAlpha = st.po!=null ? strokeOpacity(st, pav) : (fade ? .35 + .65*f : 1);   // light touch = lighter mark
    o.beginPath(); o.moveTo(p[i-1][0]*k, p[i-1][1]*k); o.lineTo(p[i][0]*k, p[i][1]*k); o.stroke();
  }
  o.globalAlpha = 1;
}
/* paint opaque on a scratch layer, then lay it down at one alpha: no darker
   overlaps even though the width changes along the stroke */
function layered(o, alpha, fn){
  const c = document.createElement('canvas');
  c.width = o.canvas.width; c.height = o.canvas.height;
  fn(c.getContext('2d'));
  o.save(); o.globalAlpha = alpha; o.drawImage(c, 0, 0); o.restore();
}
/* one constant-width path painted in a single stroke() (no darker overlaps) */
function flatPath(o, st, k, width, cap){
  const p = st.p;
  o.lineCap = cap; o.lineJoin = 'round'; o.lineWidth = width;
  o.beginPath(); o.moveTo(p[0][0]*k, p[0][1]*k);
  if(p.length===1) o.lineTo(p[0][0]*k+.01, p[0][1]*k);
  for(let i=1;i<p.length;i++) o.lineTo(p[i][0]*k, p[i][1]*k);
  o.stroke();
}
/* stamp a "dab" every spacing*diameter along the path */
function dabs(st, k, rmul, spacing, fn){
  const p = st.p, base = st.w*k/2*rmul;
  const first = p[0];
  fn(first[0]*k, first[1]*k, Math.max(.5, base*strokePressure(st, first[2])), 0, st.po!=null ? strokeOpacity(st, first[2]) : 1);
  let acc = 0;
  for(let i=1;i<p.length;i++){
    const x0 = p[i-1][0]*k, y0 = p[i-1][1]*k, x1 = p[i][0]*k, y1 = p[i][1]*k;
    const len = Math.hypot(x1-x0, y1-y0);
    if(!len) continue;
    const r = Math.max(.5, base*strokePressure(st, p[i][2]));
    const step = Math.max(.9, r*2*spacing);
    acc += len;
    while(acc >= step){
      acc -= step;
      const t = Math.max(0, Math.min(1, 1-acc/len));
      fn(x0+(x1-x0)*t, y0+(y1-y0)*t, r, i, st.po!=null ? strokeOpacity(st, p[i][2]) : 1);
    }
  }
}
function softDab(o, x, y, r, col, a){
  const g = o.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgbaOf(col, a));
  g.addColorStop(.55, rgbaOf(col, a*.55));
  g.addColorStop(1, rgbaOf(col, 0));
  o.fillStyle = g;
  o.beginPath(); o.arc(x, y, r, 0, Math.PI*2); o.fill();
}
const BRUSHES = {
  pencil:{name:'Lápiz', draw(o, st, k, col, A, R){
    o.strokeStyle = rgbaOf(col, .85*A); o.fillStyle = o.strokeStyle;
    varLine(o, st, k, .5, true);
    o.strokeStyle = rgbaOf(col, .3*A); o.fillStyle = o.strokeStyle;
    const st2 = {...st, p: st.p.map(q=>[q[0]+(R()-.5)*.25, q[1]+(R()-.5)*.25, q[2]])};
    varLine(o, st2, k, .4);
  }},
  pen:{name:'Bolígrafo', draw(o, st, k, col, A){
    o.strokeStyle = rgbaOf(col, A); o.fillStyle = o.strokeStyle;
    varLine(o, {...st, pr:false}, k, .6);
  }},
  marker:{name:'Marcador', draw(o, st, k, col, A){
    layered(o, .62*A, t=>{ t.strokeStyle = col; t.fillStyle = col; varLine(t, st, k, 1); });
  }},
  brush:{name:'Pincel suave', draw(o, st, k, col, A){
    dabs(st, k, 1, .16, (x,y,r,i,am)=> softDab(o, x, y, r, col, .8*A*(am==null?1:am)));
  }},
  watercolor:{name:'Acuarela', draw(o, st, k, col, A){
    dabs(st, k, 1.5, .12, (x,y,r,i,am)=> softDab(o, x, y, r, col, .06*A*(am==null?1:am)));
  }},
  airbrush:{name:'Aerógrafo', draw(o, st, k, col, A, R){
    o.fillStyle = rgbaOf(col, .55*A);
    dabs(st, k, 1.2, .25, (x,y,r)=>{
      const n = Math.round(r*1.1)+4;
      for(let i=0;i<n;i++){
        const a = R()*Math.PI*2, d = Math.sqrt(R())*r;
        o.fillRect(x+Math.cos(a)*d, y+Math.sin(a)*d, 1.3, 1.3);
      }
    });
  }},
  charcoal:{name:'Carbón', draw(o, st, k, col, A, R){
    dabs(st, k, 1, .22, (x,y,r,i,am)=>{
      const M = am==null ? 1 : am;
      softDab(o, x, y, r*.8, col, .12*A*M);
      const n = Math.round(r*1.2)+5;
      for(let i=0;i<n;i++){
        const a = R()*Math.PI*2, d = Math.sqrt(R())*r;
        const s = .6+R()*1.8;
        o.fillStyle = rgbaOf(col, (.25+R()*.6)*A*M);
        o.fillRect(x+Math.cos(a)*d, y+Math.sin(a)*d, s, s);
      }
    });
  }},
  chalk:{name:'Tiza', draw(o, st, k, col, A, R){
    o.lineWidth = 1.1; o.lineCap = 'round';
    dabs(st, k, 1, .3, (x,y,r)=>{
      const n = Math.round(r*.9)+4;
      for(let i=0;i<n;i++){
        const a = R()*Math.PI*2, d = Math.sqrt(R())*r, b = R()*Math.PI;
        const l = .8+R()*r*.5;
        o.strokeStyle = rgbaOf(col, (.35+R()*.5)*A);
        o.beginPath();
        o.moveTo(x+Math.cos(a)*d, y+Math.sin(a)*d);
        o.lineTo(x+Math.cos(a)*d+Math.cos(b)*l, y+Math.sin(a)*d+Math.sin(b)*l);
        o.stroke();
      }
    });
  }},
  highlighter:{name:'Resaltador', draw(o, st, k, col, A){
    layered(o, .38*A, t=>{ t.strokeStyle = col; t.fillStyle = col; varLine(t, st, k, 2.4); });
  }},
  calligraphy:{name:'Caligrafía', draw(o, st, k, col, A){
    const ang = -Math.PI/4, nx = Math.cos(ang), ny = Math.sin(ang);
    o.fillStyle = rgbaOf(col, A); o.strokeStyle = o.fillStyle; o.lineWidth = 1;
    const p = st.p;
    const half = q=> Math.max(.8, st.w*k/2*strokePressure(st, q[2]));
    for(let i=0;i<p.length;i++){
      const q = p[i], h = half(q), nxp = i? p[i-1] : q;
      const x0 = nxp[0]*k, y0 = nxp[1]*k, x1 = q[0]*k, y1 = q[1]*k, h0 = half(nxp);
      o.beginPath();
      o.moveTo(x0-nx*h0, y0-ny*h0); o.lineTo(x0+nx*h0, y0+ny*h0);
      o.lineTo(x1+nx*h, y1+ny*h); o.lineTo(x1-nx*h, y1-ny*h);
      o.closePath(); o.fill(); o.stroke();
    }
  }}
};
const BRUSH_IDS = Object.keys(BRUSHES);

/* Freehand strokes live in page mm, so they stay crisp at print resolution.
   Drawn on their own layer so the eraser only removes ink, never the photo. */
/* The tablet reports a point every few ms, so a fast stroke is a handful of
   far-apart points that read as a polygon. Drawing a Catmull-Rom curve
   through them (extra points at most ~0.35mm apart, pressure interpolated)
   keeps it round at any sampling density. Never stored: derived per render. */
const densified = new WeakMap();
function densifyPoints(p){
  if(p.length<3) return p;
  const STEP = .35, out = [];
  for(let i=0;i<p.length-1;i++){
    const p0 = p[i-1]||p[i], p1 = p[i], p2 = p[i+1], p3 = p[i+2]||p2;
    const m = Math.ceil(Math.hypot(p2[0]-p1[0], p2[1]-p1[1])/STEP);
    out.push(p1);
    for(let j=1;j<m;j++){
      const t = j/m, t2 = t*t, t3 = t2*t;
      const cr = (a,b,c,d)=> .5*((2*b) + (-a+c)*t + (2*a-5*b+4*c-d)*t2 + (-a+3*b-3*c+d)*t3);
      const pr = (p1[2]!=null && p2[2]!=null) ? p1[2]+(p2[2]-p1[2])*t : p1[2];
      out.push([cr(p0[0],p1[0],p2[0],p3[0]), cr(p0[1],p1[1],p2[1],p3[1]), pr]);
    }
  }
  out.push(p[p.length-1]);
  return out;
}
function smoothedStroke(st){
  const c = densified.get(st);
  if(c && c.n===st.p.length && c.src===st.p) return c.st;
  const out = Object.assign({}, st, {p:densifyPoints(st.p)});
  densified.set(st, {n:st.p.length, src:st.p, st:out});
  return out;
}
/* ox, oy: esquina (en píxeles) de la parte que se pinta; así se dibuja solo lo visible a resolución de pantalla */
function drawStrokes(ctx, strokes, x, y, wPx, hPx, ppmm, ox=0, oy=0){
  const off = document.createElement('canvas');
  off.width = Math.max(1,Math.round(wPx)); off.height = Math.max(1,Math.round(hPx));
  const o = off.getContext('2d');
  o.translate(-ox, -oy);
  strokes.forEach(st=>{
    if(!st.p || !st.p.length) return;
    const def = BRUSHES[st.b] || BRUSHES.pen;
    o.save();
    o.globalCompositeOperation = st.e ? 'destination-out' : 'source-over';
    if(st.clip && st.clip.length>2){
      /* painted while "limit brush to selection" was on */
      o.beginPath();
      st.clip.forEach((q,i)=> o[i ? 'lineTo' : 'moveTo'](q[0]*ppmm, q[1]*ppmm));
      o.closePath(); o.clip();
    }
    def.draw(o, smoothedStroke(st), ppmm, st.e ? '#000000' : (st.c || '#000000'), st.o==null ? 1 : st.o, rng(st.seed||1));
    o.restore();
  });
  ctx.drawImage(off, x, y);
}

function wrapParagraph(ctx, str, maxWidth){
  const words = str.split(/\s+/).filter(Boolean);
  const lines=[]; let cur='';
  for(const w of words){
    const test = cur? cur+' '+w : w;
    if(ctx.measureText(test).width > maxWidth && cur){ lines.push(cur); cur=w; }
    else cur=test;
  }
  if(cur) lines.push(cur);
  return lines.length?lines:[''];
}
function buildLines(ctx, str, maxWidth){
  const paras = (str||'').split('\n');
  let out=[];
  for(const p of paras) out = out.concat(wrapParagraph(ctx, p, maxWidth));
  return out;
}

function fontDefFor(text){
  const id = text.font || '';
  if(id.indexOf('sys:')===0) return {css:"'"+id.slice(4).replace(/'/g,'')+"','Archivo',sans-serif"};
  return FONTS.find(f=>f.id===id) || FONTS[0];
}
function layoutText(ctx, text, wPx, hPx, ppmm){
  const pad = 8*ppmm;
  const fontDef = fontDefFor(text);
  const sizePx = Math.max(6,(text.size||24)) * PT_TO_MM * ppmm;
  const font = sizePx+'px '+fontDef.css;
  /* free text: placed by its top-left corner (fx, fy mm). fw = width of an
     area text box (wraps inside it); null = point text, only breaks on Enter */
  if(text.fx!=null){
    ctx.save();
    ctx.font = font; ctx.textBaseline = 'alphabetic';
    const lines = text.fw ? buildLines(ctx, text.content, text.fw*ppmm) : String(text.content||'').split('\n');
    const lineHeight = sizePx*1.3, blockH = lines.length*lineHeight;
    const maxW = Math.max(text.content ? 1 : sizePx*3, ...lines.map(l=> ctx.measureText(l).width));
    ctx.restore();
    const boxW = text.fw ? text.fw*ppmm : maxW;
    const rx = text.fx*ppmm, ry = text.fy*ppmm;
    const tx = text.align==='right' ? rx+boxW : text.align==='center' ? rx+boxW/2 : rx;
    return {lines, sizePx, lineHeight, startY: ry+sizePx, tx, font, rect:{x:rx, y:ry, w:boxW, h:blockH}};
  }
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = text.align==='left'?'left':text.align==='right'?'right':'center';
  const lines = buildLines(ctx, text.content, wPx-2*pad);
  const lineHeight = sizePx*1.3;
  const blockH = lines.length*lineHeight;
  let startY;
  if(text.vAlign==='top') startY = pad+sizePx;
  else if(text.vAlign==='bottom') startY = hPx-pad-blockH+sizePx+(lineHeight-sizePx);
  else startY = hPx/2 - blockH/2 + sizePx;
  const tx = text.align==='left'? pad : text.align==='right'? wPx-pad : wPx/2;
  const maxW = Math.max(1, ...lines.map(l=> ctx.measureText(l).width));
  ctx.restore();
  const rx = text.align==='left' ? tx : text.align==='right' ? tx-maxW : tx-maxW/2;
  return {lines, sizePx, lineHeight, startY, tx, font,
    rect:{x:rx, y:startY-sizePx, w:maxW, h:blockH}};
}
function drawPageText(ctx, text, x, y, wMm, hMm, ppmm, noClip){
  const wPx=wMm*ppmm, hPx=hMm*ppmm;
  const L = layoutText(ctx, text, wPx, hPx, ppmm);
  ctx.save();
  if(!noClip){ ctx.beginPath(); ctx.rect(x,y,wPx,hPx); ctx.clip(); }
  const ox=(text.offsetX||0)*ppmm, oy=(text.offsetY||0)*ppmm, rot=(text.rotation||0)*Math.PI/180;
  if(ox||oy||rot){
    const px = x+L.rect.x+L.rect.w/2, py = y+L.rect.y+L.rect.h/2;
    ctx.translate(px+ox, py+oy); ctx.rotate(rot); ctx.translate(-px,-py);
  }
  ctx.fillStyle = text.color || '#0a0a0a';
  ctx.font = L.font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = text.align==='left'?'left':text.align==='right'?'right':'center';
  L.lines.forEach((line,i)=> ctx.fillText(line, x+L.tx, y+L.startY+i*L.lineHeight));
  ctx.restore();
}


export {BRUSHES, drawStrokes, drawPageText, layoutText, hsvToRgb, rgbToHsv, rgbToHex, hexToRgb};
