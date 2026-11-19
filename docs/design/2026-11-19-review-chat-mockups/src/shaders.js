/* Keating shader layer. One WebGL context renders every effect and blits it into 2D canvases,
   so a page with many small effects never runs out of contexts. Everything here is decoration:
   with WebGL missing, shaders switched off, or motion reduced, the interface is unchanged. */
(function(){
  var K=window.KMotion, G=window.KGlyph, TEX=window.KTEX||{};
  if(!K||!G) return;
  var glc=document.createElement('canvas'); glc.width=512; glc.height=512;
  var gl=glc.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true});
  if(!gl){ document.documentElement.setAttribute('data-fx','none'); return; }
  var RM=G.RM, enabled=true;
  function $$(r,s){ return Array.prototype.slice.call(r.querySelectorAll(s)); }

  var VS='attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var HEAD='#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n'+
    'uniform vec2 uR;uniform float uT;uniform vec2 uM;uniform float uS;uniform vec4 uA;uniform vec4 uB;uniform sampler2D uX;'+
    'float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}'+
    'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}'+
    'float fbm(vec2 p){float t=0.,a=.5;for(int i=0;i<4;i++){t+=vn(p)*a;p=p*2.03+.17;a*=.5;}return t;}'+
    'float bay2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}'+
    'float bay4(vec2 a){return bay2(.5*a)*.25+bay2(a);}';

  var FS={
    /* Paper tooth. uA: x repeat in px, y texture strength, z grain, w mottle. uB.x: 1 when the scan is loaded.
       Two offset samples are mixed by noise so the repeat never lines up. Drawn once, multiplied over the page. */
    paper:'void main(){vec2 px=gl_FragCoord.xy;vec2 q=px/uA.x;'+
      'float a=texture2D(uX,q+uS).r,b=texture2D(uX,q*1.37+vec2(.31,.67)+uS).r;'+
      'float t=mix(a,b,smoothstep(.35,.65,vn(q*1.7+uS*9.)));'+
      'float fib=vn(vec2(px.x*.07,px.y*.9)+uS*40.)*vn(px*.35+uS*7.);'+
      't=mix(1.-fib*.9,t,uB.x);'+
      'float v=1.-(1.-t)*uA.y+(h21(px+uS*91.)-.5)*uA.z+(fbm(px/uR.y*3.+uS)-.5)*uA.w;'+
      'gl_FragColor=vec4(vec3(clamp(v,0.,1.)),1.);}',
    /* Terminal glass. Scanlines, vignette, a refresh band that sometimes hesitates, noise, and a
       phosphor afterglow that trails the pointer. uA.x pointer heat, uB.xy trailing point, uB.z its heat. */
    crt:'void main(){vec2 px=gl_FragCoord.xy;vec2 uv=px/uR;uv.y=1.-uv.y;float asp=uR.x/uR.y;'+
      'float scan=step(mod(px.y,3.),1.)*.13;'+
      'float vig=smoothstep(.38,.9,length((uv-.5)*vec2(1.,.92)))*.4;'+
      'float y=fract(uT*.085+uS)+.035*sin(uT*.9)*step(.62,fract(uT*.037));'+
      'float roll=smoothstep(.1,0.,abs(uv.y-y))*.05;'+
      'float n=(h21(px+floor(uT*24.))-.5)*.03+(h21(vec2(floor(uT*24.),3.))-.5)*.012;'+
      'float d=length((uv-uM)*vec2(asp,1.));float d2=length((uv-uB.xy)*vec2(asp,1.));'+
      'float glow=exp(-d*d*42.)*.11*uA.x+exp(-d2*d2*26.)*.07*uB.z;'+
      'float l=clamp(roll+glow+n,0.,1.),k=clamp(scan+vig,0.,1.);'+
      'gl_FragColor=vec4(vec3(.29,.89,.53)*l,l+k-l*k);}',
    /* Power off, power on. uA.x runs 0 to 1: the picture closes to a line, then a dot, and reopens. */
    power:'void main(){vec2 uv=gl_FragCoord.xy/uR;float p=uA.x;float y=abs(uv.y-.5)*2.,x=abs(uv.x-.5)*2.;float hh,ww,l;'+
      'if(p<.5){float q=p/.5;hh=mix(1.,.006,smoothstep(0.,.72,q));ww=mix(1.,.004,smoothstep(.72,1.,q));l=smoothstep(.15,1.,q)*.92;}'+
      'else{float q=(p-.5)/.5;ww=mix(.004,1.,smoothstep(0.,.28,q));hh=mix(.006,1.,smoothstep(.22,1.,q));l=(1.-smoothstep(0.,.85,q))*.85;}'+
      'float ins=step(y,hh)*step(x,ww);'+
      'float halo=(1.-ins)*exp(-max(y-hh,0.)*26.)*exp(-max(x-ww,0.)*26.)*l*.5;'+
      'vec3 ph=uB.rgb;vec3 c=mix(vec3(.016,.03,.022)+ph*halo,ph*l,ins);'+
      'gl_FragColor=vec4(c,mix(1.,l,ins));}',
    /* Empty-state field. A faint ordered dither drifts at the edges; the study-object pattern is almost
       invisible until the pointer passes over it. uA: x cell px, y pointer heat, z pattern px, w 1 with pattern. uB: rgb ink, a strength. */
    field:'void main(){vec2 px=gl_FragCoord.xy;vec2 uv=px/uR;uv.y=1.-uv.y;float asp=uR.x/uR.y;'+
      'vec2 g=floor(px/uA.x);vec2 p=g*uA.x/uR.y;'+
      'float v=fbm(p*2.1+vec2(uT*.03,-uT*.018)+uS);'+
      'float d=length((uv-uM)*vec2(asp,1.));float lamp=exp(-d*d*17.)*uA.y;'+
      'float edge=smoothstep(.2,.66,length((uv-vec2(.5,.46))*vec2(asp*.6,1.)));'+
      'float dots=step(bay4(g),(v-.4)*1.3*edge);'+
      'float ln=(1.-texture2D(uX,vec2(px.x,uR.y-px.y)/uA.z+vec2(uT*.003,uT*.0015)).r)*uA.w;'+
      'float show=step(bay4(g),lamp*1.25)*ln;'+
      'float a=clamp(dots*.22+ln*.06*edge+show*.75,0.,1.)*uB.a;'+
      'gl_FragColor=vec4(uB.rgb*a,a);}',
    /* Marbled ink that keeps moving: two phases of a flow-warped texture cross-faded so it never smears.
       uA: x repeats per height, y flow strength, z speed, w opacity. uB.x: 1 with the scan loaded. */
    ink:'void main(){vec2 uv=gl_FragCoord.xy/uR;vec2 p=vec2(uv.x*uR.x/uR.y,uv.y)*uA.x;'+
      'vec2 fl=vec2(fbm(p*1.3+uS)-.5,fbm(p*1.3+7.3+uS)-.5)*uA.y;float t=uT*uA.z;float f0=fract(t),f1=fract(t+.5);'+
      'vec2 dr=vec2(t*.06,t*.02);'+
      'vec3 a=texture2D(uX,p+fl*f0+dr).rgb,b=texture2D(uX,p+fl*f1+dr+.37).rgb;vec3 c=mix(a,b,abs(1.-2.*f0));'+
      'float m=sin(p.x*9.+fbm(p*3.+t)*7.)*.5+.5;vec3 pr=mix(vec3(.08,.45,.24),vec3(.86,.94,.86),m*m);'+
      'c=mix(pr,c,uB.x);gl_FragColor=vec4(c*uA.w,uA.w);}',
    /* The mascot's screen. Its face leans toward the pointer and it blinks on an irregular beat.
       uM: glance direction. uA: x blink amount, y scanlines. */
    bot:'void main(){vec2 uv=gl_FragCoord.xy/uR;uv.y=1.-uv.y;'+
      'float m=smoothstep(.28,.34,uv.x)*smoothstep(.72,.66,uv.x)*smoothstep(.37,.43,uv.y)*smoothstep(.75,.69,uv.y);'+
      'vec2 s=uv-uM*.024*m;'+
      'float w=uT/4.7+uS*3.;float ph=h21(vec2(floor(w),uS));float tt=(fract(w)-ph*.8)*4.7;'+
      'float b=smoothstep(0.,.05,tt)*(1.-smoothstep(.09,.17,tt))*uA.x;'+
      'float cy=.565;float band=smoothstep(.085,.055,abs(s.y-cy));'+
      'float yy=clamp(cy+(s.y-cy)/max(1.-b*.93,.07),cy-.09,cy+.09);s.y=mix(s.y,yy,band*m*step(.001,b));'+
      'vec4 c=texture2D(uX,s);'+
      'c.rgb*=1.-step(1.,mod(gl_FragCoord.y,2.))*.1*m*uA.y;c.rgb+=c.rgb*m*.07*sin(uT*2.1+uS*6.);'+
      'gl_FragColor=vec4(c.rgb*c.a,c.a);}'
  };

  var progs={}, ok=true;
  function sh(type,src){ var s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ console.warn('shader',gl.getShaderInfoLog(s)); ok=false; } return s; }
  var vs=sh(gl.VERTEX_SHADER,VS);
  Object.keys(FS).forEach(function(n){
    var p=gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,sh(gl.FRAGMENT_SHADER,HEAD+FS[n])); gl.bindAttribLocation(p,0,'p'); gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){ console.warn('link',n,gl.getProgramInfoLog(p)); ok=false; }
    var u={}; ['uR','uT','uM','uS','uA','uB','uX'].forEach(function(k){ u[k]=gl.getUniformLocation(p,k); }); progs[n]={p:p,u:u};
  });
  if(!ok){ document.documentElement.setAttribute('data-fx','none'); return; }
  var buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0); gl.disable(gl.BLEND);

  var targets=[], texs={};
  function mkTex(repeat){ var t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t); var w=repeat?gl.REPEAT:gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,w); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,w);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR); return t; }
  var blank=mkTex(true); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
  function load(name,src,repeat){ if(!src) return; var im=new Image(); im.onload=function(){ var t=mkTex(repeat); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im); texs[name]=t; targets.forEach(function(x){ x.dirty=true; }); }; im.src=src; }
  load('paper',TEX.paper,true); load('marble',TEX.marble,true); load('doodles',TEX.doodles,true);
  var botSrc=(getComputedStyle(document.documentElement).getPropertyValue('--bot-img')||'').trim().replace(/^url\(["']?/,'').replace(/["']?\)$/,'');
  load('bot',botSrc,false);

  function add(el,fx,opt){ var c=document.createElement('canvas'); c.className='fx fx-'+fx; c.setAttribute('aria-hidden','true'); el.appendChild(c);
    var t=Object.assign({c:c,ctx:c.getContext('2d'),fx:fx,fps:0,seed:Math.random(),vis:false,dirty:true,last:0,m:[.5,.5],m2:[.5,.5],heat:0,heat2:0,cap:1500,A:[0,0,0,0],B:[0,0,0,0],tex:null,host:el},opt||{});
    targets.push(t); K.inView(c,function(){ t.vis=true; t.dirty=true; return function(){ t.vis=false; }; },{amount:0}); return t; }
  function fit(t){ var r=t.c.getBoundingClientRect(); if(r.width<1||r.height<1) return false; var d=Math.min(window.devicePixelRatio||1,2); var w=r.width*d,h=r.height*d,k=Math.min(1,t.cap/Math.max(w,h)); w=Math.max(1,Math.round(w*k)); h=Math.max(1,Math.round(h*k));
    if(t.c.width!==w||t.c.height!==h){ t.c.width=w; t.c.height=h; t.dirty=true; } t.k=k*d; return true; }
  function draw(t,sec){
    if(!fit(t)) return; var w=t.c.width,h=t.c.height;
    if(glc.width<w||glc.height<h){ glc.width=Math.max(glc.width,w); glc.height=Math.max(glc.height,h); }
    if(t.pre) t.pre(t,sec);
    var P=progs[t.fx], u=P.u; gl.useProgram(P.p); gl.viewport(0,0,w,h); gl.enable(gl.SCISSOR_TEST); gl.scissor(0,0,w,h); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.uR,w,h); gl.uniform1f(u.uT,sec); gl.uniform2f(u.uM,t.m[0],t.m[1]); gl.uniform1f(u.uS,t.seed);
    gl.uniform4f(u.uA,t.A[0],t.A[1],t.A[2],t.A[3]); gl.uniform4f(u.uB,t.B[0],t.B[1],t.B[2],t.B[3]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,(t.tex&&texs[t.tex])||blank); gl.uniform1i(u.uX,0);
    gl.drawArrays(gl.TRIANGLES,0,3);
    t.ctx.clearRect(0,0,w,h); t.ctx.drawImage(glc,0,glc.height-h,w,h,0,0,w,h); t.dirty=false; t.last=sec;
  }
  var t0=performance.now();
  function frame(now){
    requestAnimationFrame(frame); if(!enabled||document.hidden) return; var sec=(now-t0)/1000, still=RM();
    for(var i=0;i<targets.length;i++){ var t=targets[i]; if(!t.vis) continue;
      if(still||!t.fps){ if(t.dirty) draw(t,still?0:sec); }
      else if(t.dirty||sec-t.last>=1/t.fps) draw(t,sec);
    }
  }
  requestAnimationFrame(frame);
  window.addEventListener('resize',function(){ targets.forEach(function(t){ t.dirty=true; }); });

  function rgb(el,prop){ var v=getComputedStyle(el).getPropertyValue(prop).trim(); var m=/^#([0-9a-f]{6})$/i.exec(v); if(!m) return [.08,.45,.24]; var n=parseInt(m[1],16); return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]; }
  function dark(el){ var k=el.closest('.kt'); return !!(k&&k.classList.contains('dark')); }
  function track(host,t){ host.addEventListener('pointermove',function(e){ var r=t.c.getBoundingClientRect(); t.m=[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]; t.heat=1; t.dirty=true; }); host.addEventListener('pointerleave',function(){ t.heat=0; }); }

  /* ── page and glass: one overlay per frame, paper in the light theme and CRT in the dark one ── */
  var frames=$$(document,'.kt.scr, .kt.strip, .kt.phones, .kt.panes, .kt.gbox').map(function(root){
    var t=add(root,'paper',{tex:'paper',root:root});
    t.pre=function(t,sec){
      if(t.fx==='paper'){ t.A=[260*t.k,.05,.022,.02]; t.B=[texs.paper?1:0,0,0,0]; }
      else if(t.fx==='crt'){ t.hx=(t.hx||0)+((t.heat?1:0)-(t.hx||0))*.08; t.A=[t.hx,0,0,0]; t.m2[0]+=(t.m[0]-t.m2[0])*.06; t.m2[1]+=(t.m[1]-t.m2[1])*.06; t.B=[t.m2[0],t.m2[1],t.hx,0]; }
    };
    track(root,t); return t;
  });
  function mode(t){ var d=t.root.classList.contains('dark'); t.fx=d?'crt':'paper'; t.fps=d?30:0; t.cap=d?1300:2200; t.c.className='fx fx-'+t.fx; t.dirty=true; }
  frames.forEach(mode);

  /* ── theme switch: the picture powers down, the theme changes while it is dark, and it powers back up ── */
  var switching=false;
  function theme(v,apply){
    var done=function(){ apply(); frames.forEach(mode); others(); };
    if(!enabled||RM()||switching){ done(); return; }
    var vis=frames.filter(function(t){ return t.vis; }); if(!vis.length){ done(); return; }
    switching=true; var flipped=false;
    vis.forEach(function(t){ t.fx='power'; t.fps=60; t.cap=1300; t.c.className='fx fx-power'; t.B=v==='dark'?[.29,.89,.53,1]:[.98,.95,.86,1]; t.pre=null; t.A=[0,0,0,0]; });
    K.animate(0,1,{duration:.85,ease:'easeInOut',onUpdate:function(p){ vis.forEach(function(t){ t.A[0]=p; t.dirty=true; }); if(p>=.5&&!flipped){ flipped=true; apply(); others(); } },
      onComplete:function(){ switching=false; frames.forEach(function(t){ t.pre=function(t){ if(t.fx==='paper'){ t.A=[260*t.k,.05,.022,.02]; t.B=[texs.paper?1:0,0,0,0]; } else { t.hx=(t.hx||0)+((t.heat?1:0)-(t.hx||0))*.08; t.A=[t.hx,0,0,0]; t.m2[0]+=(t.m[0]-t.m2[0])*.06; t.m2[1]+=(t.m[1]-t.m2[1])*.06; t.B=[t.m2[0],t.m2[1],t.hx,0]; } }; mode(t); }); }});
  }

  /* ── empty state: the pattern under the pointer ── */
  var fields=$$(document,'.hero').map(function(h){ var t=add(h,'field',{tex:'doodles',fps:30,cap:1200});
    t.pre=function(t){ t.hx=(t.hx||0)+((t.heat?1:0)-(t.hx||0))*.07; var d=dark(h); var c=d?[.29,.89,.53]:[.08,.45,.24]; t.A=[3*Math.max(1,Math.round(t.k)),t.hx,300*t.k,texs.doodles?1:0]; t.B=[c[0],c[1],c[2],d?.5:.62]; };
    track(h,t); return t; });

  /* ── marbled ink: a pass that is reading, and the finished part of the review bar ── */
  var inks=$$(document,'.pass.run, .track .fin').map(function(el){ var bar=el.classList.contains('fin'); var t=add(el,'ink',{tex:'marble',fps:30,cap:900});
    t.pre=function(t){ t.A=bar?[.11,.35,.09,1]:[.34,.4,.06,dark(el)?.3:.26]; t.B=[texs.marble?1:0,0,0,0]; }; return t; });

  /* ── the mascot looks at the pointer and blinks ── */
  var px=[innerWidth/2,innerHeight/2];
  window.addEventListener('pointermove',function(e){ px=[e.clientX,e.clientY]; },{passive:true});
  var bots=$$(document,'.bot').map(function(el){ el.classList.add('fx-live'); var t=add(el,'bot',{tex:'bot',fps:24,cap:256,m:[0,0]});
    t.pre=function(t){ var r=t.c.getBoundingClientRect(); var dx=px[0]-(r.left+r.width/2),dy=px[1]-(r.top+r.height/2); var n=Math.max(60,Math.sqrt(dx*dx+dy*dy)); var gx=dx/n,gy=dy/n; t.m[0]+=(gx-t.m[0])*.14; t.m[1]+=(gy-t.m[1])*.14; t.A=[1,t.c.width>=72?1:0,0,0]; }; return t; });
  function others(){ fields.concat(inks,bots).forEach(function(t){ t.dirty=true; }); }

  /* ── desk lamp: a soft pool of light follows the pointer on paper, warmer after dark ── */
  var hr=new Date().getHours(), night=hr>=19||hr<6;
  $$(document,'.kt.scr').forEach(function(root){
    var l=document.createElement('i'); l.className='lamp'+(night?' night':''); root.appendChild(l); var on=false;
    root.addEventListener('pointermove',function(e){ if(!enabled||RM()) return; var r=root.getBoundingClientRect(); var z=r.width/root.offsetWidth||1; var x=(e.clientX-r.left)/z,y=(e.clientY-r.top)/z;
      if(!on){ on=true; K.animate(l,{opacity:1},{duration:.5}); } K.animate(l,{x:x,y:y},{type:'spring',stiffness:120,damping:22}); });
    root.addEventListener('pointerleave',function(){ on=false; K.animate(l,{opacity:0},{duration:.6}); });
  });

  window.KFx={theme:theme,set:function(v){ enabled=v!=='off'; document.documentElement.setAttribute('data-fx',enabled?'on':'off'); targets.forEach(function(t){ t.dirty=true; }); },refresh:function(){ frames.forEach(mode); others(); }};
  document.documentElement.setAttribute('data-fx','on');
})();
