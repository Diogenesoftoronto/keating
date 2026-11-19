/* Keating companion: a sprite you can pick up, drop on things, pet and ignore. Prototype for the mockups. */
(function(){
  var KB=window.KBOTS; if(!KB) return;
  var META=KB.meta, ROWS=KB.play?META.play:[], NR=ROWS.length;
  var mq=window.matchMedia('(prefers-reduced-motion: reduce)');
  function RM(){ var a=document.documentElement.getAttribute('data-motion'); return a==='reduce'||(a!=='full'&&mq.matches); }
  function $$(r,s){ return Array.prototype.slice.call(r.querySelectorAll(s)); }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  var ST={'blank-idle':{fps:4,loop:1,face:1},'blank-sitting':{fps:4,loop:1,face:1},held:{fps:8,loop:1},falling:{fps:12,loop:1},landing:{fps:11},dizzy:{fps:7},petted:{fps:8,reps:2},startled:{fps:10},
    yawning:{fps:5,next:'sleeping'},sleeping:{fps:2.5,loop:1},'head-shake':{fps:8,next:'hint'},hint:{fps:6,hold:1.3},'pointing-left':{fps:6,loop:1},typing:{fps:10,loop:1},'paper-plane':{fps:11},
    success:{fps:9},celebrating:{fps:9},running:{fps:12,loop:1},peeking:{fps:5,loop:1},carrying:{fps:10,loop:1}};

  /* ── his screen: a 32 x 24 pixel display drawn in ink on the green glass ── */
  var FONT={'0':'111101101101111','1':'010110010010111','2':'111001111100111','3':'111001111001111','4':'101101111001001','5':'111100111001111','6':'111100111101111','7':'111001001001001','8':'111101111101111','9':'111101111001111',':':'000010000010000','%':'101001010100101','?':'111001011000010','K':'101101110101101'};
  function text(c,s,x,y){ for(var i=0;i<s.length;i++){ var g=FONT[s[i]]; if(g) for(var k=0;k<15;k++) if(g[k]==='1') c.fillRect(x+k%3,y+(k/3|0),1,1); x+=4; } }
  function eyes(c,gx,gy,shape){ var y=8+gy, xs=[9+gx,20+gx];
    xs.forEach(function(x){ if(shape==='blink'||shape==='flat') c.fillRect(x,y+2,3,1); else if(shape==='happy'){ c.fillRect(x,y+1,1,1); c.fillRect(x+1,y,1,1); c.fillRect(x+2,y+1,1,1); } else if(shape==='wide'){ c.fillRect(x-1,y-1,5,6); c.clearRect(x,y,3,4); c.fillRect(x+1,y+1,1,2); } else c.fillRect(x,y,3,4); }); }
  function mouth(c,gx,gy,shape){ var x=12+Math.round(gx*.5), y=15+Math.round(gy*.5);
    if(shape==='o'){ c.fillRect(x+3,y,3,3); c.clearRect(x+4,y+1,1,1); } else if(shape==='flat') c.fillRect(x+2,y+1,5,1);
    else { c.fillRect(x,y,1,1); c.fillRect(x+1,y+1,1,1); c.fillRect(x+2,y+2,5,1); c.fillRect(x+7,y+1,1,1); c.fillRect(x+8,y,1,1); } }
  var PROG={
    face:function(c,s){ var b=(s.t+s.seed*4)%3.9; var shape=b<.13?'blink':s.mood==='happy'?'happy':s.mood==='wide'?'wide':'dot'; eyes(c,Math.round(s.gx),Math.round(s.gy),shape); mouth(c,s.gx,s.gy,s.mood==='wide'?'o':s.mood==='flat'?'flat':'smile'); },
    dots:function(c,s){ for(var i=0;i<3;i++){ var y=11-Math.max(0,Math.sin(s.t*5-i*.9))*4; c.fillRect(8+i*7,Math.round(y),3,3); } },
    wave:function(c,s){ for(var i=0;i<9;i++){ var h=2+Math.abs(Math.sin(s.t*6+i*1.1)*Math.sin(s.t*1.7+i))*14; c.fillRect(3+i*3,Math.round(12-h/2),2,Math.round(h)); } },
    search:function(c,s){ var x=10+Math.sin(s.t*2.2)*5, y=7+Math.cos(s.t*1.6)*2; c.fillRect(x+1,y,4,1); c.fillRect(x,y+1,1,4); c.fillRect(x+5,y+1,1,4); c.fillRect(x+1,y+5,4,1); c.fillRect(x+5,y+5,1,1); c.fillRect(x+6,y+6,2,2); c.fillRect(x+8,y+8,1,1); },
    timer:function(c,s){ var left=Math.max(0,299-(s.t|0)%300), m=(left/60|0), sec=left%60; text(c,'0'+m+':'+(sec<10?'0':'')+sec,6,7); c.fillRect(4,16,Math.round(24*left/299),2); },
    pct:function(c,s){ var p=(s.t*9|0)%101; text(c,(p<10?' ':'')+p+'%',p<100?9:7,6); c.fillRect(5,15,22,1); c.fillRect(5,18,22,1); c.fillRect(5,16,1,2); c.fillRect(26,16,1,2); c.fillRect(6,16,Math.round(20*p/100),2); },
    check:function(c,s){ var n=Math.min(11,(s.t%2.2)*14|0), pts=[[9,12],[10,13],[11,14],[12,15],[13,14],[14,13],[15,12],[16,11],[17,10],[18,9],[19,8]]; for(var i=0;i<n;i++) c.fillRect(pts[i][0],pts[i][1],2,2); },
    q:function(c,s){ if((s.t*1.6|0)%2) return; c.fillRect(12,5,7,2); c.fillRect(17,7,2,4); c.fillRect(14,10,4,2); c.fillRect(14,12,2,2); c.fillRect(14,16,2,2); },
    heart:function(c,s){ var k=(s.t*2%1)<.5?0:1, r=['0110110','1111111','1111111','0111110','0011100','0001000']; for(var y=0;y<6;y++) for(var x=0;x<7;x++) if(r[y][x]==='1') c.fillRect(9+x*2-k,6+y*2-k,2+k,2+k); },
    k:function(c,s){ var seq=[1,1,1,0,1,0,1,1,1,0,0,0,0,0], on=seq[(s.t*5|0)%seq.length]; text(c,'K',11,6); text(c,'K',11,6); c.fillRect(11,6,1,1); if(on) c.fillRect(17,9,3,2); c.fillRect(8,15,16,1); },
    pong:function(c,s){ var g=s.game||(s.game={x:16,y:6,vx:9,vy:7,p:16,score:0}), dt=Math.min(.05,s.dt||0); g.x+=g.vx*dt; g.y+=g.vy*dt; if(g.x<1||g.x>30) g.vx=-g.vx; if(g.y<1) g.vy=Math.abs(g.vy);
      if(g.y>20){ if(Math.abs(g.x-g.p)<5){ g.vy=-Math.abs(g.vy); g.score++; } else if(g.y>23){ g.y=4; g.score=0; } } if(!s.playing) g.p+=(g.x-g.p)*.12;
      c.fillRect(Math.round(g.x)-1,Math.round(g.y)-1,2,2); c.fillRect(Math.round(g.p)-4,21,8,1); text(c,String(g.score%100),1,1); }
  };
  function drawFace(s){ var c=s.ctx; c.clearRect(0,0,32,24); c.fillStyle='#0d1b14'; (PROG[s.mode]||PROG.face)(c,s); }

  function Sprite(host,size){
    var el=document.createElement('div'); el.className='kbot'; el.style.width=el.style.height=size+'px'; el.style.backgroundImage='url('+KB.play+')'; el.style.backgroundSize=(8*size)+'px '+(NR*size)+'px';
    var cv=document.createElement('canvas'); cv.width=32; cv.height=24; cv.className='kface'; el.appendChild(cv); host.appendChild(el);
    var s={el:el,cv:cv,ctx:cv.getContext('2d'),size:size,name:'',f:0,acc:0,reps:0,held:0,flip:false,mode:'face',mood:'',gx:0,gy:0,t:0,seed:Math.random(),onEnd:null};
    s.set=function(name,onEnd){ if(!ST[name]||ROWS.indexOf(name)<0) name='blank-idle'; s.name=name; s.f=0; s.acc=0; s.reps=0; s.held=0; s.onEnd=onEnd||null; s.paint(); };
    s.paint=function(){ var d=ST[s.name]; el.style.backgroundPosition=(-s.f*size)+'px '+(-ROWS.indexOf(s.name)*size)+'px';
      if(d.face){ var r=META.screens[s.name][s.f], k=size/256, p=5; cv.style.display='block'; cv.style.left=((r[0]-p)*k)+'px'; cv.style.top=((r[1]-p)*k)+'px'; cv.style.width=((r[2]+p*2)*k)+'px'; cv.style.height=((r[3]+p*2)*k)+'px'; drawFace(s); } else cv.style.display='none'; };
    function finish(){ var d=ST[s.name], cb=s.onEnd; s.onEnd=null; if(d.next) s.set(d.next,cb); else if(cb) cb(); }
    s.step=function(dt){ var d=ST[s.name]; s.t+=dt; s.dt=dt;
      if(RM()){ if(!d.loop){ s.held+=dt; if(s.held>.7) finish(); } else if(d.face) drawFace(s); return; }
      s.acc+=dt*d.fps; var changed=false;
      while(s.acc>=1){ s.acc-=1; changed=true; if(s.f<7) s.f++; else if(d.loop) s.f=0; else { s.reps++; if(d.reps&&s.reps<d.reps) s.f=0; else { s.held+=1/d.fps; if(!d.hold||s.held>=d.hold){ finish(); return; } } } }
      if(changed) s.paint(); else if(d.face) drawFace(s); };
    s.set('blank-idle'); return s;
  }
  var all=[], last=performance.now();
  function loop(now){ requestAnimationFrame(loop); var dt=Math.min(.05,(now-last)/1000); last=now; if(document.hidden) return; for(var i=0;i<all.length;i++) all[i](dt); }
  requestAnimationFrame(loop);
  var ptr={x:innerWidth/2,y:innerHeight/2}; window.addEventListener('pointermove',function(e){ ptr.x=e.clientX; ptr.y=e.clientY; },{passive:true});
  function lookAt(s,cx,cy){ var r=s.el.getBoundingClientRect(), dx=cx-(r.left+r.width/2), dy=cy-(r.top+r.height*.32), n=Math.max(90,Math.hypot(dx,dy)); s.gx+=(clamp(dx/n*3.4,-3,3)-s.gx)*.2; s.gy+=(clamp(dy/n*2.4,-2,2)-s.gy)*.2; }

  /* ── display bots: one screen program each ── */
  $$(document,'[data-screen]').forEach(function(host){
    var s=Sprite(host,+host.getAttribute('data-size')||96); s.mode=host.getAttribute('data-screen'); s.set('blank-idle');
    if(s.mode==='pong'){ host.addEventListener('pointermove',function(e){ var r=s.cv.getBoundingClientRect(); s.playing=true; if(s.game) s.game.p=clamp((e.clientX-r.left)/r.width*32,4,28); }); host.addEventListener('pointerleave',function(){ s.playing=false; }); }
    all.push(function(dt){ if(s.mode==='face') lookAt(s,ptr.x,ptr.y); s.step(dt); });
  });

  /* ── the playground ── */
  $$(document,'[data-companion]').forEach(function(stage){
    var SIZE=112, G=2600, sp=Sprite(stage,SIZE), el=sp.el, W=function(){ return stage.offsetWidth; }, H=function(){ return stage.offsetHeight; };
    el.classList.add('live'); el.tabIndex=0; el.setAttribute('role','button'); el.setAttribute('aria-label','Keating. Drag him onto anything to ask about it, or press Enter for study actions.');
    var ta=stage.querySelector('textarea'), sendBtn=stage.querySelector('.send'), col=stage.querySelector('.thread .col'), dock=stage.querySelector('.dock'), chipHost=stage.querySelector('.qchips'), log=stage.querySelector('[data-log]');
    var b={x:0,y:0,vx:0,vy:0,rot:0,mode:'perch',ledge:null,target:null,dizzy:false,only:null}, drag=null, idle=0, menu=null, bub=null, tag=null, hot=null, watch=0;
    function zk(){ return stage.getBoundingClientRect().width/stage.offsetWidth||1; }
    function local(cx,cy){ var r=stage.getBoundingClientRect(), k=zk(); return {x:(cx-r.left)/k,y:(cy-r.top)/k}; }
    function rectOf(n){ var r=n.getBoundingClientRect(), a=local(r.left,r.top), c=local(r.right,r.bottom); return {x0:a.x,y0:a.y,x1:c.x,y1:c.y}; }
    function ledges(){ var out=$$(stage,'[data-ledge]').map(function(n){ var r=rectOf(n); return {x0:r.x0,x1:r.x1,y:r.y0,sit:true,el:n}; }).filter(function(l){ return l.y>70; }); out.push({x0:0,x1:W(),y:H()-2,sit:false,el:null}); return out; }
    function home(){ var L=ledges().filter(function(l){ return l.el===dock; })[0], c=rectOf(stage.querySelector('.dock .col')); return {L:L,x:Math.min(W()-70,c.x1+84)}; }
    function say(t){ if(log) log.textContent=t; }
    function place(){ var sit=sp.name==='blank-sitting'; el.style.transform='translate('+(b.x-SIZE/2)+'px,'+(b.y-SIZE+(sit?SIZE*.2:0))+'px) rotate('+b.rot+'deg) scaleX('+(sp.flip?-1:1)+')'; sp.cv.style.transform=sp.flip?'scaleX(-1)':''; }
    function perch(){ b.mode='perch'; b.rot=0; sp.flip=false; sp.mood=''; sp.set(b.ledge&&b.ledge.sit?'blank-sitting':'blank-idle'); place(); idle=0; }
    function busy(name,then){ b.mode='busy'; sp.set(name,then||perch); place(); }
    function pop(n){ if(!RM()&&n.animate) n.animate([{opacity:0,transform:'translateY(6px) scale(.92)'},{opacity:1,transform:'none'}],{duration:190,easing:'cubic-bezier(.2,.8,.2,1)'}); }
    function tween(from,to,dur,step,done){ if(RM()){ step(to); done(); return; } var t=0; var f=function(dt){ t+=dt/dur; if(t>=1){ step(to); all.splice(all.indexOf(f),1); done(); } else step(from+(to-from)*t); }; all.push(f); }
    function closeMenu(){ if(menu){ menu.remove(); menu=null; } }
    function closeBub(){ if(bub){ bub.remove(); bub=null; } $$(stage,'.asked').forEach(function(n){ n.classList.remove('asked'); }); }
    function floatAt(n){ stage.appendChild(n); var w=n.offsetWidth, h=n.offsetHeight; n.style.left=clamp(b.x-w/2,8,W()-w-8)+'px'; n.style.top=Math.max(52,b.y-SIZE-h-4)+'px'; pop(n); }
    function prefill(textv,quote){ ta.value=textv; ta.focus(); chipHost.innerHTML=''; if(quote){ var q=document.createElement('span'); q.className='qchip'; q.textContent='Quoting: “'+quote.slice(0,54)+(quote.length>54?'…':'')+'”'; chipHost.appendChild(q); pop(q); } sp.mood='happy'; setTimeout(function(){ sp.mood=''; },1400); say('The question is in the composer for you to review and send.'); }
    function hop(to,x,then){ if(RM()){ b.ledge=to; b.x=x; b.y=to.y; (then||perch)(); return; } var T=.55; b.only=to; b.after=then||null; b.vx=(x-b.x)/T; b.vy=(to.y-b.y)/T-.5*G*T; b.mode='fall'; sp.set('falling'); }
    function goHome(then){ var h=home(); if(b.ledge&&b.ledge.el===dock&&Math.abs(b.x-h.x)<4){ (then||perch)(); return; } hop(h.L,h.x,then); }

    var ACT={
      explain:{t:'This part?',o:[['Explain another way','Explain this another way, with a concrete example.'],['Give me an example','Give me one worked example of this.'],['Quiz me on it','Ask me one question that checks I understood this.']]},
      code:{t:'This code?',o:[['Walk me through it','Walk me through this code line by line, asking me to predict each step.'],['Let me predict the output','Let me predict the output first, then tell me where I went wrong.'],['What if n is negative?','What happens if n is negative? Let me guess first.']]}
    };
    function act(){ var t=b.target; b.target=null; if(!t){ perch(); return; } var kind=t.getAttribute('data-drop');
      if(kind==='perch'){ goHome(); return; }
      if(kind==='quiz'){ hint(t); return; }
      var a=ACT[kind]; if(!a){ perch(); return; }
      var r=rectOf(t); b.mode='point'; sp.flip=(r.x0+r.x1)/2>b.x; sp.set('pointing-left'); place(); t.classList.add('asked');
      bub=document.createElement('div'); bub.className='kbub'; bub.innerHTML='<b>'+a.t+'</b>'; a.o.forEach(function(o){ var x=document.createElement('button'); x.className='b sm ln'; x.textContent=o[0]; x.addEventListener('click',function(){ var q=t.textContent.replace(/\s+/g,' ').trim(); closeBub(); prefill(o[1],q); goHome(); }); bub.appendChild(x); });
      floatAt(bub); say('He points at what you dropped him on and offers three ways to ask about it.'); }
    function hint(card){ var h=card.querySelector('.qz-h'); busy('hint',perch); if(h){ h.hidden=false; pop(h); } say('Dropped on a question, he gives a hint, not the answer.'); }
    function land(){ b.only=null; b.rot=0; var after=b.after; b.after=null; if(after){ b.mode='busy'; sp.set('landing',after); place(); return; }
      b.mode='busy'; sp.set('landing',function(){ if(b.dizzy){ b.dizzy=false; say('Shake him and he needs a moment.'); sp.set('dizzy',act); } else act(); }); place(); }

    function overTarget(cx,cy){ var els=document.elementsFromPoint(cx,cy), t=null; for(var i=0;i<els.length&&!t;i++){ if(el.contains(els[i])) continue; var c=els[i].closest('[data-drop]'); if(c&&stage.contains(c)) t=c; }
      if(t!==hot){ if(hot) hot.classList.remove('drop-on'); hot=t; if(tag){ tag.remove(); tag=null; } if(t){ t.classList.add('drop-on'); tag=document.createElement('span'); tag.className='droptag'; tag.textContent=t.getAttribute('data-drop-label'); stage.appendChild(tag); var r=rectOf(t); tag.style.left=r.x0+'px'; tag.style.top=Math.max(50,r.y0-22)+'px'; } } return t; }
    function clearHot(){ if(hot) hot.classList.remove('drop-on'); hot=null; if(tag){ tag.remove(); tag=null; } }

    el.addEventListener('pointerdown',function(e){ if(e.button) return; e.preventDefault(); el.setPointerCapture(e.pointerId); var p=local(e.clientX,e.clientY); drag={ox:p.x-b.x,oy:p.y-b.y,sx:p.x,sy:p.y,px:p.x,py:p.y,t:performance.now(),moved:false,dir:0,flips:0,vx:0,vy:0}; });
    el.addEventListener('pointermove',function(e){ var p=local(e.clientX,e.clientY); idle=0;
      if(!drag){ pet(p); return; }
      var now=performance.now(), dt=Math.max(.004,(now-drag.t)/1000), dx=p.x-drag.px, dy=p.y-drag.py;
      if(!drag.moved&&Math.hypot(p.x-drag.sx,p.y-drag.sy)>5){ drag.moved=true; closeMenu(); closeBub(); b.mode='held'; b.only=null; b.after=null; sp.flip=false; sp.set('held'); stage.classList.add('dragging'); say('Drop him on a paragraph, the code, the question, or back on the composer.'); }
      if(drag.moved){ drag.vx=drag.vx*.6+dx/dt*.4; drag.vy=drag.vy*.6+dy/dt*.4; var d=dx>3?1:dx<-3?-1:0; if(d&&d!==drag.dir){ if(drag.dir) drag.flips++; drag.dir=d; }
        b.x=clamp(p.x-drag.ox,SIZE/2,W()-SIZE/2); b.y=clamp(p.y-drag.oy,SIZE+46,H()); b.rot=RM()?0:clamp(drag.vx*.035,-30,30); place(); overTarget(e.clientX,e.clientY); }
      drag.px=p.x; drag.py=p.y; drag.t=now; });
    function release(e){ if(!drag) return; var d=drag; drag=null; stage.classList.remove('dragging');
      if(!d.moved){ if(b.mode==='sleep'){ wake(); return; } if(b.mode==='peek'){ b.mode='busy'; sp.set('landing',perch); say('Back out.'); return; } toggleMenu(); return; }
      b.target=overTarget(e.clientX,e.clientY); clearHot(); b.dizzy=d.flips>=6; b.vx=clamp(d.vx,-1100,1100); b.vy=clamp(d.vy,-1100,900); b.rot=0;
      if(RM()){ var L=ledges().filter(function(l){ return b.x>l.x0+8&&b.x<l.x1-8&&l.y>=b.y-2; }).sort(function(a,c){ return a.y-c.y; })[0]; b.ledge=L; b.y=L.y; land(); return; }
      /* with something to ask about he arcs straight back to his seat and points from there, so he never lands on the text */
      if(b.target&&b.target.getAttribute('data-drop')!=='perch'){ var hm=home(), T=.6; b.only=hm.L; b.vx=(hm.x-b.x)/T; b.vy=(hm.L.y-b.y)/T-.5*G*T; }
      b.mode='fall'; sp.set('falling'); }
    el.addEventListener('pointerup',release); el.addEventListener('pointercancel',release);
    el.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleMenu(); } if(e.key==='Escape'){ closeMenu(); closeBub(); } });

    var petS={dir:0,flips:0,t:0,x:0};
    function pet(p){ if(b.mode!=='perch') return; var now=performance.now(); if(now-petS.t>800){ petS.flips=0; petS.dir=0; } var dx=p.x-petS.x; if(Math.abs(dx)>6){ var d=dx>0?1:-1; if(d!==petS.dir){ petS.dir=d; petS.flips++; petS.t=now; } petS.x=p.x; }
      if(petS.flips>=5&&p.y<b.y-SIZE*.4){ petS.flips=0; busy('petted',perch); hearts(); say('Rub his head and he likes it. It does nothing else.'); } }
    function hearts(){ for(var i=0;i<4;i++){ var h=document.createElement('i'); h.className='kheart'; h.style.left=(b.x-18+i*11)+'px'; h.style.top=(b.y-SIZE-4)+'px'; h.style.animationDelay=(i*.09)+'s'; stage.appendChild(h); h.addEventListener('animationend',function(){ this.remove(); }); } }
    function wake(){ if(b.mode!=='sleep') return; busy('startled',perch); say('He dozes off when nothing happens for a while and wakes when you come back.'); }

    function toggleMenu(){ if(menu){ closeMenu(); return; } closeBub(); menu=document.createElement('div'); menu.className='kmenu'; menu.setAttribute('role','menu');
      var items=[['Explain another way','Explain the current topic another way, with a concrete example.'],['Quiz me','Quiz me on the current topic, one question at a time.'],['Make flashcards','Make flashcards to help me review the current topic.']];
      menu.innerHTML='<span class="eb mu">Add to your message</span>'; items.forEach(function(it){ var x=document.createElement('button'); x.textContent=it[0]; x.setAttribute('role','menuitem'); x.addEventListener('click',function(){ closeMenu(); prefill(it[1]); }); menu.appendChild(x); });
      var hr=document.createElement('hr'); menu.appendChild(hr);
      [['Take a bow',function(){ busy('celebrating',perch); }],['Give me room',function(){ goHome(function(){ b.mode='peek'; sp.set('peeking'); place(); say('He ducks behind the composer and only peeks. Click him to bring him back.'); }); }]].forEach(function(it){ var x=document.createElement('button'); x.textContent=it[0]; x.setAttribute('role','menuitem'); x.addEventListener('click',function(){ closeMenu(); it[1](); }); menu.appendChild(x); });
      floatAt(menu); var f=menu.querySelector('button'); if(f&&document.activeElement===el) f.focus(); }
    stage.addEventListener('pointerdown',function(e){ if(menu&&!menu.contains(e.target)&&!el.contains(e.target)) closeMenu(); if(bub&&!bub.contains(e.target)&&!el.contains(e.target)){ closeBub(); if(b.mode==='point') perch(); } });
    stage.addEventListener('pointermove',function(e){ idle=0; if(b.mode==='sleep'){ var r=el.getBoundingClientRect(); if(Math.hypot(e.clientX-(r.left+r.width/2),e.clientY-(r.top+r.height/2))<150*zk()) wake(); } });

    /* quick check in the thread */
    $$(stage,'[data-ans]').forEach(function(btn){ btn.addEventListener('click',function(){ var card=btn.closest('.qz'), ok=btn.getAttribute('data-ans')==='ok'; $$(card,'[data-ans]').forEach(function(x){ x.classList.remove('pri','bad'); });
      if(ok){ btn.classList.add('pri'); if(b.mode==='perch'||b.mode==='point'){ closeBub(); busy(ROWS.indexOf('celebrating')>=0?'celebrating':'success',perch); } say('A right answer gets a celebration. They rotate, so it is not the same one each time.'); }
      else { btn.classList.add('bad'); var h=card.querySelector('.qz-h'); if(b.mode==='perch'||b.mode==='point'){ closeBub(); busy('head-shake',perch); } setTimeout(function(){ if(h){ h.hidden=false; pop(h); } },900); say('A wrong answer gets a kind head shake, then a hint card.'); } }); });

    /* sending */
    function plane(){ if(RM()) return; var p=document.createElement('i'); p.className='kplane'; stage.appendChild(p); var c=rectOf(col), dx=c.x1-60-b.x-18, dy=c.y1-30-(b.y-SIZE*.62); p.style.left=(b.x+18)+'px'; p.style.top=(b.y-SIZE*.62)+'px';
      p.animate([{transform:'translate(0,0) rotate(-40deg)',opacity:1},{transform:'translate('+dx*.5+'px,-90px) rotate(-80deg)',opacity:1,offset:.5},{transform:'translate('+dx+'px,'+dy+'px) rotate(-160deg)',opacity:0}],{duration:600,easing:'ease-in-out'}).onfinish=function(){ p.parentNode&&p.parentNode.removeChild(p); }; }
    function add(html,cls){ var n=document.createElement(cls==='me'?'div':'article'); n.className=cls; n.innerHTML=html; col.appendChild(n); pop(n); return n; }
    function settle(){ if(b.ledge&&b.ledge.el&&b.ledge.el!==dock&&b.mode==='perch'){ goHome(); } }
    function carry(){ b.mode='walk'; sp.flip=false; sp.set('carrying'); var badge=stage.querySelector('[data-mat-count]');
      tween(b.x,W()-60,1.3,function(v){ b.x=v; place(); },function(){ if(badge){ badge.textContent=String((+badge.textContent||0)+1); pop(badge); } say('He carried the new flashcards to Materials, so you know where they went.'); goHome(); }); }
    function send(){ var v=ta.value.trim(); if(!v||b.mode==='fall'||b.mode==='held') return; var cards=/flashcard/i.test(v), quiz=/quiz|question that checks/i.test(v); ta.value=''; chipHost.innerHTML=''; closeBub(); closeMenu();
      goHome(function(){ b.mode='busy'; sp.set('paper-plane',function(){ b.mode='busy'; sp.set('typing'); }); place(); plane(); say('He throws your message, then types while Keating writes.');
        setTimeout(function(){ add('<p></p>','me').firstChild.textContent=v; },320);
        var th; setTimeout(function(){ th=add('<div class="who"><span class="eb">Keating</span><span class="dots"><i></i><i></i><i></i></span></div>','tu'); },900);
        setTimeout(function(){ if(th) th.remove(); add('<div class="who"><span class="eb">Keating</span></div><div class="prose"><p>'+(cards?'Six cards, built from the three ideas you just used. They are in Materials.':quiz?'One question, then: why do the <code>after</code> lines print in reverse?':'Before I answer: what do you already expect to happen, and why?')+'</p></div>','tu'); if(cards) carry(); else perch(); },2500); }); }
    if(sendBtn) sendBtn.addEventListener('click',send);
    if(ta){ ta.addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } }); ta.addEventListener('input',function(){ watch=1.4; idle=0; if(b.mode==='sleep') wake(); }); }

    all.push(function(dt){
      if(b.mode==='fall'){ b.vy+=G*dt; b.x+=b.vx*dt; var ny=b.y+b.vy*dt; if(b.x<SIZE/2){ b.x=SIZE/2; b.vx=-b.vx*.5; } if(b.x>W()-SIZE/2){ b.x=W()-SIZE/2; b.vx=-b.vx*.5; } if(ny<SIZE+46){ ny=SIZE+46; b.vy=Math.abs(b.vy)*.3; }
        var L=b.vy>0?ledges().filter(function(l){ return (b.only?l.el===b.only.el:true)&&b.x>l.x0+8&&b.x<l.x1-8&&l.y>=b.y-2&&l.y<=ny+.01; }).sort(function(a,c){ return a.y-c.y; })[0]:null;
        if(L){ b.y=L.y; b.ledge=L; land(); } else { b.y=ny; b.rot=clamp(b.vx*.02,-20,20); place(); } }
      if(b.mode==='perch'){ if(watch>0&&ta){ watch-=dt; var r=ta.getBoundingClientRect(); lookAt(sp,r.left+Math.min(r.width-20,20+ta.value.length*7*zk()),r.top+14); sp.mood='flat'; } else { if(sp.mood==='flat') sp.mood=''; lookAt(sp,ptr.x,ptr.y); }
        var pr=el.getBoundingClientRect(), near=Math.hypot(ptr.x-(pr.left+pr.width/2),ptr.y-(pr.top+pr.height*.35))<46*zk(); if(sp.mood===''||sp.mood==='wide') sp.mood=near&&!drag?'wide':'';
        if(!menu&&!bub){ idle+=dt; if(idle>12){ b.mode='sleep'; sp.set('yawning'); say('Twelve quiet seconds: a yawn, then sleep.'); } } }
      sp.step(dt); });
    var h=home(); b.ledge=h.L; b.x=h.x; b.y=h.L.y; perch();
    window.addEventListener('resize',function(){ if(b.mode==='perch'&&b.ledge){ var L=ledges().filter(function(l){ return l.el===b.ledge.el; })[0]; if(L){ b.ledge=L; b.y=L.y; b.x=clamp(b.x,L.x0+20,L.x1-20); place(); } } });
    stage.__bot={b:b,sp:sp,send:send,settle:settle};
  });

  /* ── gallery: one shared frame counter drives every tile ── */
  $$(document,'.kgal').forEach(function(g){ if(!KB.gallery) return; g.style.setProperty('--gimg','url('+KB.gallery+')'); g.style.setProperty('--gn',META.gallery.length); var f=0, acc=0; all.push(function(dt){ if(RM()) return; acc+=dt*7; if(acc>=1){ acc=0; f=(f+1)%8; g.style.setProperty('--f',f); } }); });
})();
