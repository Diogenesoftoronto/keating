/* Interface motion for the mock boards, with Motion (motion.dev). Nothing here hides content before it runs. */
(function(){
  var K=window.KMotion, G=window.KGlyph; if(!K||!G) return;
  var animate=K.animate, hover=K.hover, press=K.press, inView=K.inView, stagger=K.stagger;
  var RM=G.RM, EASE=G.EASE, SPRING=G.SPRING, SOFT=G.SOFT;
  document.documentElement.classList.add('kmo');
  function $$(r,s){ return Array.prototype.slice.call(r.querySelectorAll(s)); }
  function last(kf){ var o={}; Object.keys(kf).forEach(function(k){ var v=kf[k]; o[k]=Array.isArray(v)?v[v.length-1]:v; }); return o; }
  var run=null;
  function A(els,kf,opt){ if(!els) return null; if(els.length===0) return null; var c=RM()?animate(els,last(kf),{duration:0}):animate(els,kf,opt); if(run) run.push(c); return c; }
  function later(fn,ms){ if(RM()){ fn(); return; } var id=setTimeout(fn,ms); if(run) run.push({stop:function(){ clearTimeout(id); }}); }
  function wake(els,opt){ return A(els,{opacity:[.2,1],y:[10,0]},Object.assign({duration:.38,ease:EASE,delay:stagger(.04)},opt||{})); }
  function slide(els,dx,opt){ return A(els,{opacity:[.2,1],x:[dx,0]},Object.assign({duration:.36,ease:EASE,delay:stagger(.035)},opt||{})); }
  function ink(els,start){ return A(els,{backgroundSize:['0% 100%','100% 100%']},{duration:.55,ease:'easeInOut',delay:stagger(.16,{startDelay:start||0})}); }
  function count(el,to,suffix){ if(!el) return; if(RM()){ el.textContent=to+suffix; return; } var c=animate(0,to,{duration:.8,ease:EASE,onUpdate:function(v){ el.textContent=Math.round(v)+suffix; }}); if(run) run.push(c); }
  function cs(el,p){ return getComputedStyle(el).getPropertyValue(p); }
  function collapse(el){ var h=cs(el,'height'); el.style.overflow='hidden'; var c=A([el],{height:[h,'0px'],opacity:[1,0],paddingTop:0,paddingBottom:0,marginTop:0,marginBottom:0,borderTopWidth:0,borderBottomWidth:0},{duration:.26,ease:EASE}); var done=function(){ el.style.display='none'; }; if(c&&c.then) c.then(done); else done(); }

  /* ── entrances, played when a board scrolls into view ── */
  var ENTER={
    chat:function(r){
      slide($$(r,'.rail .ses'),-10);
      wake($$(r,'.thread .scroll .col > *'),{delay:stagger(.08,{startDelay:.1})});
      wake($$(r,'.dock .quick > *'),{delay:stagger(.05,{startDelay:.32})});
      A($$(r,'.dock .comp'),{opacity:[.2,1],y:[16,0]},Object.assign({delay:.22},SOFT));
    },
    empty:function(r){
      wake($$(r,'.hero > .bot, .hero > h1, .hero > p'),{delay:stagger(.08)});
      A($$(r,'.hero > .comp'),{opacity:[.2,1],y:[18,0]},Object.assign({delay:.22},SOFT));
      A($$(r,'.st-c'),{opacity:[.2,1],scale:[.94,1]},{duration:.3,ease:EASE,delay:stagger(.05,{startDelay:.4})});
    },
    strip:function(r){
      $$(r,'.strip > div').forEach(function(c,i){ wake($$(c,':scope > *'),{delay:stagger(.05,{startDelay:i*.09})}); });
      A($$(r,'.rail-p i.ok'),{scaleX:[0,1]},{duration:.5,ease:EASE,delay:.4});
      A($$(r,'.below .bar'),{scaleX:[0,1]},{duration:.5,ease:EASE,delay:.45});
      A($$(r,'.pill'),{opacity:[0,1],y:[16,0]},Object.assign({delay:.75},SPRING));
    },
    phones:function(r){
      wake($$(r,'.ph'),{delay:stagger(.1)});
      A($$(r,'.sheet'),{y:['105%','0%']},Object.assign({delay:.55},SOFT));
      ink($$(r,'.page mark, .page .sel'),.5);
    },
    index:function(r){
      A($$(r,'.track i'),{scaleX:[0,1]},{duration:.7,ease:EASE,delay:stagger(.3,{startDelay:.15})});
      count(r.querySelector('.big'),3,' of 7');
      wake($$(r,'.q'),{delay:stagger(.045,{startDelay:.12})});
      slide($$(r,'.pat'),18,{delay:.22});
      wake($$(r,'.pat .p, .pat .nx'),{delay:stagger(.1,{startDelay:.45})});
    },
    work:function(r){
      slide($$(r,'.out .tr'),-8);
      wake($$(r,'.page-in .turn'),{delay:stagger(.09,{startDelay:.08})});
      ink($$(r,'.page mark:not(.pending)'),.55);
      A($$(r,'.page .ref'),{scale:[0,1]},Object.assign({delay:stagger(.16,{startDelay:.9})},SPRING));
      slide($$(r,'.desk .pass, .desk .dl, .desk .nt'),18,{delay:stagger(.06,{startDelay:.2})});
    },
    note:function(r){
      var sel=r.querySelector('.sel'), fl=r.querySelector('.float'), ed=r.querySelector('.desk .nt.cur'), inp=ed&&ed.querySelector('.inp'), pick=fl&&fl.querySelector('[data-pick]');
      slide($$(r,'.spine > *'),-6,{delay:stagger(.025)});
      wake($$(r,'.page-in .turn'),{delay:stagger(.08)});
      slide($$(r,'.desk .dl, .desk .nt:not(.cur)'),18,{delay:stagger(.05,{startDelay:.2})});
      if(RM()||!sel||!fl||!ed||!inp) return;
      inp.dataset.t=inp.dataset.t||inp.textContent; var txt=inp.dataset.t; inp.textContent='';
      if(pick){ pick.classList.remove('pri'); pick.classList.add('gh'); }
      A([fl],{opacity:0},{duration:0}); A([ed],{opacity:0},{duration:0});
      A([sel],{backgroundSize:['0% 100%','100% 100%']},{duration:.8,ease:'easeInOut',delay:.5});
      A([fl],{opacity:[0,1],y:[8,0],scale:[.92,1]},Object.assign({delay:1.35},SPRING));
      later(function(){ if(pick){ pick.classList.add('pri'); pick.classList.remove('gh'); A([pick],{scale:[.9,1]},SPRING); var g=pick.querySelector('.k'); } },2050);
      A([ed],{opacity:[0,1],x:[26,0]},Object.assign({delay:2.3},SOFT));
      var t=animate(0,txt.length,{duration:1.7,delay:2.75,ease:'linear',onUpdate:function(v){ inp.textContent=txt.slice(0,Math.round(v)); }}); if(run) run.push(t);
    },
    panes:function(r){
      $$(r,'.pane').forEach(function(p,i){ wake($$(p,'.desk > .pass, .desk > .menu, .desk-b > *'),{delay:stagger(.04,{startDelay:i*.12})}); });
      A($$(r,'.sc i.on'),{scale:[.4,1]},Object.assign({delay:stagger(.1,{startDelay:.55})},SPRING));
      A($$(r,'.sc i.sug'),{opacity:[0,1],scale:[1.3,1]},{duration:.3,ease:EASE,delay:stagger(.08,{startDelay:.8})});
    },
    glyphs:function(r){
      A($$(r,'.gl'),{opacity:[.2,1],y:[8,0]},{duration:.3,ease:EASE,delay:stagger(.016)});
      $$(r,'.gl svg').forEach(function(s,i){ later(function(){ G.once(s,1100); },300+i*75); });
    },
    demo:function(r){ wake($$(r,'.gdemo > *, .fxgrid > *'),{delay:stagger(.05)}); },
    onb:function(r){
      wake($$(r,'.stage > *:not(.fx)'),{delay:stagger(.1)});
      wake($$(r,'[data-w]'),{delay:stagger(.06,{startDelay:.15})});
      A($$(r,'.steps li'),{opacity:[.2,1],y:[-6,0]},{duration:.3,ease:EASE,delay:stagger(.07)});
    },
    dash:function(r){
      wake($$(r,'[data-w]'),{delay:stagger(.06)});
      A($$(r,'[data-grow]'),{scaleX:[0,1]},{duration:.6,ease:EASE,delay:stagger(.03,{startDelay:.25})});
      A($$(r,'.iv .pt'),{scale:[0,1]},Object.assign({delay:stagger(.09,{startDelay:.6})},SPRING));
      A($$(r,'svg.lchart'),{clipPath:['inset(0% 100% 0% 0%)','inset(0% 0% 0% 0%)']},{duration:1,ease:'easeInOut',delay:.35});
      A($$(r,'.hm i'),{opacity:[0,1]},{duration:.25,delay:stagger(.004,{startDelay:.2})});
    }
  };
  $$(document,'.board').forEach(function(b){
    var roots=$$(b,'[data-enter]'); if(!roots.length) return;
    function play(){ (b.__run||[]).forEach(function(c){ try{ c.stop(); }catch(e){} }); run=b.__run=[]; roots.forEach(function(root){ var f=ENTER[root.getAttribute('data-enter')]; if(f) f(root); }); run=null; }
    inView(roots[0],function(){ if(!b.__seen){ b.__seen=1; if(!RM()) play(); } },{amount:.2});
    var rp=document.createElement('button'); rp.className='rp'; rp.setAttribute('data-replay',''); rp.textContent='Replay'; b.querySelector('.board-h').appendChild(rp); rp.addEventListener('click',play);
  });

  /* ── always-on loops ── */
  function loops(){
    if(RM()) return;
    $$(document,'.dots').forEach(function(d){ animate($$(d,'i'),{y:[0,-3,0],opacity:[.3,1,.3]},{duration:.9,repeat:Infinity,ease:'easeInOut',delay:stagger(.15)}); });
    animate($$(document,'.rail-p b'),{opacity:[1,.45,1]},{duration:1.4,repeat:Infinity,ease:'easeInOut'});
  }
  loops();

  /* ── press and hover feedback ── */
  press('.kt .b, .kt .ib, .kt .send',function(el){ if(RM()) return; animate(el,{scale:.95},{duration:.08}); return function(){ animate(el,{scale:1},SPRING); }; });
  $$(document,'.st-c, .cd:not(.on), .gl').forEach(function(el){
    hover(el,function(){ if(RM()) return; var inkc=cs(el,'--ink').trim()||'#1c211b'; animate(el,{x:-2,y:-2,boxShadow:'4px 4px 0px 0px '+inkc},SPRING); return function(){ animate(el,{x:0,y:0,boxShadow:'0px 0px 0px 0px '+inkc},SOFT); }; });
  });

  /* ── tabs: the underline leaves one tab and arrives in the next ── */
  function tabs(root){
    $$(root,'.kt .tabs').forEach(function(t){
      if(t.__w) return; t.__w=1;
      var items=$$(t,':scope > span');
      items.forEach(function(s){ var u=document.createElement('i'); u.className='ul'; s.appendChild(u); });
      items.forEach(function(s,i){ s.addEventListener('click',function(){
        var cur=-1; items.forEach(function(x,j){ if(x.classList.contains('on')) cur=j; }); if(cur===i||cur<0) return;
        var fwd=i>cur, a=items[cur].querySelector('.ul'), b=s.querySelector('.ul');
        items[cur].classList.remove('on'); s.classList.add('on');
        a.style.transformOrigin=fwd?'100% 50%':'0% 50%'; b.style.transformOrigin=fwd?'0% 50%':'100% 50%';
        A([a],{scaleX:[1,0]},{duration:.16,ease:'easeIn'}); A([b],{scaleX:[0,1]},Object.assign({delay:.1},SPRING));
        t.dispatchEvent(new CustomEvent('k:tab',{detail:i,bubbles:true}));
      }); });
    });
  }
  tabs(document);

  /* ── review desk: swap tab bodies, accept proposals, score the rubric ── */
  var WORDS=['Poor','Weak','Adequate','Strong','Excellent'];
  function wire(root){
    $$(root,'.sc').forEach(function(sc){
      if(sc.__w) return; sc.__w=1; var cells=$$(sc,'i'), lab=sc.querySelector('span');
      cells.forEach(function(c,i){ c.style.cursor='pointer'; c.addEventListener('click',function(){ cells.forEach(function(x){ x.classList.remove('on','sug'); }); c.classList.add('on'); if(lab) lab.textContent=WORDS[i]; A([c],{scale:[.5,1]},SPRING); }); });
    });
    $$(root,'.nt.prop').forEach(function(card){
      if(card.__w) return; card.__w=1;
      $$(card,'button').forEach(function(btn){
        var label=btn.textContent.trim();
        if(label==='Apply') btn.addEventListener('click',function(){
          $$(card.closest('.desk')||root,'.sc i.sug').forEach(function(c,k){ later(function(){ var sc=c.closest('.sc'), lab=sc.querySelector('span'), idx=$$(sc,'i').indexOf(c); c.classList.remove('sug'); c.classList.add('on'); if(lab) lab.textContent=WORDS[idx]; A([c],{scale:[.4,1]},SPRING); },k*110); });
          collapse(card);
        });
        if(label==='Accept') btn.addEventListener('click',function(){ accept(root,card); });
        if(label==='Dismiss'||btn.title==='Dismiss proposed scoring') btn.addEventListener('click',function(){ var dl=card.previousElementSibling; collapse(card); if(dl&&dl.classList.contains('dl')&&/Proposed/.test(dl.textContent)) collapse(dl); });
      });
    });
  }
  function accept(root,card){
    var scr=card.closest('.scr')||document, dl=card.previousElementSibling, row=card.querySelector('.row'), nh=card.querySelector('.nh');
    card.classList.remove('prop');
    var n=$$(scr,'.page .ref').length+1, badge=document.createElement('i'); badge.className='ref'; badge.style.margin='0'; badge.textContent=n; nh.insertBefore(badge,nh.firstChild);
    A([badge],{scale:[0,1]},SPRING); A($$(card,'.k'),{scale:[1,1.7,1]},{duration:.4,ease:EASE});
    A([card],{x:[0,-4,0]},{duration:.3,ease:EASE});
    if(row) collapse(row);
    if(dl&&dl.classList.contains('dl')&&/Proposed/.test(dl.textContent)) collapse(dl);
    var m=scr.querySelector('.page mark.pending');
    if(m){ m.classList.remove('pending'); m.classList.add('g'); A([m],{backgroundSize:['0% 100%','100% 100%']},{duration:.6,ease:'easeInOut'}); var r=document.createElement('i'); r.className='ref'; r.textContent=n; m.insertAdjacentElement('afterend',r); A([r],{scale:[0,1]},Object.assign({delay:.5},SPRING)); }
    $$(scr,'.desk .dl span:first-child').forEach(function(s){ if(/on this session/.test(s.textContent)) s.textContent=n+' on this session'; });
    var cnt=scr.querySelector('.desk .tabs > span .cnt'); if(cnt){ cnt.textContent=n; A([cnt],{scale:[1.6,1]},SPRING); }
    var tk=scr.querySelector('.out .tr.on .tk'); if(tk){ var g=document.createElement('i'); g.className='k g'; tk.appendChild(g); A([g],{scale:[0,1]},SPRING); }
  }
  wire(document);
  $$(document,'.scr.rv .desk').forEach(function(desk){
    var tabsEl=desk.querySelector('.tabs'); if(!tabsEl) return;
    function after(){ var out=[], n=tabsEl.nextElementSibling; while(n){ out.push(n); n=n.nextElementSibling; } return out; }
    var orig=after();
    tabsEl.addEventListener('k:tab',function(e){
      var panes=$$(document,'.panes .pane .desk'); if(panes.length<3) return;
      after().forEach(function(x){ x.remove(); });
      var nodes=orig;
      if(e.detail>0){ nodes=[]; var c=panes[e.detail===1?0:2].querySelector('.tabs').nextElementSibling; while(c){ var k=c.cloneNode(true); k.removeAttribute('style'); $$(k,'[style*="opacity"]').forEach(function(x){ x.style.opacity=''; x.style.transform=''; }); nodes.push(k); c=c.nextElementSibling; } }
      nodes.forEach(function(x){ desk.appendChild(x); });
      G.bind(desk); wire(desk);
      A(nodes,{opacity:[0,1],x:[14,0]},{duration:.26,ease:EASE,delay:stagger(.03)});
    });
  });

  /* ── review index: filter the queue ── */
  $$(document,'.idx').forEach(function(idx){
    var chips=$$(idx,'.lhead .chip'), rows=$$(idx,'.q');
    var tests=[function(){ return true; },function(g){ return !g.classList.contains('fin')&&!g.classList.contains('dr'); },function(g){ return g.classList.contains('dr'); },function(g){ return g.classList.contains('fin'); }];
    chips.forEach(function(c,i){ c.style.cursor='pointer'; c.addEventListener('click',function(){
      chips.forEach(function(x){ x.classList.remove('on'); }); c.classList.add('on'); A([c],{scale:[.94,1]},SPRING);
      rows.forEach(function(r){
        r.dataset.h=r.dataset.h||cs(r,'height'); var show=tests[i](r.querySelector('.stg')), hidden=r.dataset.off==='1';
        if(show&&hidden){ r.dataset.off='0'; r.style.display=''; A([r],{height:['0px',r.dataset.h],opacity:[0,1],paddingTop:['0px','9px'],paddingBottom:['0px','9px']},{duration:.28,ease:EASE}); }
        if(!show&&!hidden){ r.dataset.off='1'; r.style.overflow='hidden'; var k=A([r],{height:[r.dataset.h,'0px'],opacity:[1,0],paddingTop:['9px','0px'],paddingBottom:['9px','0px']},{duration:.24,ease:EASE}); if(k&&k.then) k.then(function(){ if(r.dataset.off==='1') r.style.display='none'; }); }
      });
    }); });
  });

  /* ── chat: pick a session, open materials, draft from a chip, send ── */
  $$(document,'.scr.chat').forEach(function(chat){
    var rows=$$(chat,'.rail .ses'), ttl=chat.querySelector('.top .ttl b');
    rows.forEach(function(r){ r.addEventListener('click',function(){ rows.forEach(function(x){ x.classList.remove('on'); }); r.classList.add('on'); A([r],{x:[-8,0]},SPRING); if(ttl){ ttl.textContent=r.querySelector('b').textContent; A([ttl],{opacity:[0,1],y:[5,0]},{duration:.25,ease:EASE}); } }); });
    var mat=chat.querySelector('.mat');
    chat.__mat=function(on){
      if(!mat) return;
      if(on){ chat.classList.add('mat-on'); A([mat],{opacity:[0,1],x:[32,0]},SOFT); wake($$(mat,'.mat-b > *'),{delay:stagger(.05,{startDelay:.12})}); }
      else { var c=A([mat],{opacity:[1,0],x:[0,32]},{duration:.18,ease:'easeIn'}); var done=function(){ chat.classList.remove('mat-on'); }; if(c&&c.then) c.then(done); else done(); }
    };
    var ta=chat.querySelector('.dock .ta'), send=chat.querySelector('.dock .send'), col=chat.querySelector('.thread .scroll .col');
    if(!ta||!send||!col) return;
    var hint=ta.textContent, typing=null;
    $$(chat,'.quick .chip').forEach(function(ch){ ch.addEventListener('click',function(){
      var txt=ch.textContent.trim()+', please.'; ta.classList.add('typed'); if(typing) typing.stop();
      if(RM()){ ta.textContent=txt; return; }
      typing=animate(0,txt.length,{duration:.45,ease:'linear',onUpdate:function(v){ ta.textContent=txt.slice(0,Math.round(v)); }});
      A([ch],{y:[0,-3,0]},{duration:.25,ease:EASE});
    }); });
    send.addEventListener('click',function(){
      if(!ta.classList.contains('typed')) return;
      var me=document.createElement('div'); me.className='me'; var p=document.createElement('p'); p.textContent=ta.textContent; me.appendChild(p);
      var tu=document.createElement('article'); tu.className='tu'; tu.innerHTML='<div class="who"><i class="bot"></i><span class="eb">Keating</span><span class="dots"><i></i><i></i><i></i></span></div><div class="prose" style="color:var(--ink-soft)"><p>Keating is thinking</p></div>';
      ta.classList.remove('typed'); ta.textContent=hint;
      col.appendChild(me); A([me],{opacity:[0,1],y:[46,0],scale:[.96,1]},SOFT);
      later(function(){ col.appendChild(tu); A([tu],{opacity:[0,1],y:[10,0]},{duration:.3,ease:EASE}); if(!RM()) animate($$(tu,'.dots i'),{y:[0,-3,0],opacity:[.3,1,.3]},{duration:.9,repeat:Infinity,ease:'easeInOut',delay:stagger(.15)}); },520);
    });
  });
  window.KMat=function(scr,on){ if(scr.__mat) scr.__mat(on); else scr.classList.toggle('mat-on',on); };

  /* ── copy: the glyph becomes a check, then returns ── */
  $$(document,'[data-copy]').forEach(function(b){ b.addEventListener('click',function(){ var s=b.querySelector('svg.i'); if(!s||s.getAttribute('data-i')==='check') return; G.swap(s,'check'); G.once(s,900); setTimeout(function(){ G.swap(s,'copy'); },1300); }); });
  $$(document,'.gl').forEach(function(g){ g.addEventListener('click',function(){ var s=g.querySelector('svg.i'); if(s) G.once(s,1000); }); });

  /* ── choices, a generated activity grid, and chart tooltips ── */
  $$(document,'[data-pick]').forEach(function(g){ var items=$$(g,':scope > *'); items.forEach(function(it){ it.addEventListener('click',function(){ items.forEach(function(x){ x.classList.remove('on'); }); it.classList.add('on'); A([it],{scale:[.96,1]},SPRING); }); }); });
  $$(document,'[data-single]').forEach(function(g){ var items=$$(g,':scope > *'); items.forEach(function(it){ it.style.cursor='pointer'; it.addEventListener('click',function(){ items.forEach(function(x){ x.classList.remove('on'); }); it.classList.add('on'); A([it],{scale:[.94,1]},SPRING); }); }); });
  $$(document,'[data-multi] > *').forEach(function(it){ it.addEventListener('click',function(){ it.classList.toggle('on'); A([it],{scale:[.94,1]},SPRING); }); });
  ['hm','hm2'].forEach(function(id){
    var el=document.getElementById(id); if(!el) return; var weeks=id==='hm'?34:14, s=7, total=weeks*7;
    for(var i=0;i<total;i++){ s=(s*16807)%2147483647; var r=s/2147483647, v=r<.56-(i/total)*.22?0:r<.72?1:r<.85?2:r<.95?3:4; var c=document.createElement('i'); if(v) c.setAttribute('data-v',v); c.setAttribute('data-tip',v?v+(v>1?' sessions':' session'):'No sessions'); el.appendChild(c); }
    var sel=el.children[total-9]; if(sel){ sel.classList.add('sel'); sel.setAttribute('data-v','2'); sel.setAttribute('data-tip','2 sessions'); }
    $$(el,'i').forEach(function(c){ c.addEventListener('click',function(){ $$(el,'i').forEach(function(x){ x.classList.remove('sel'); }); c.classList.add('sel'); A([c],{scale:[.6,1]},SPRING); }); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-multi-one]'),function(it){ it.style.cursor='pointer'; it.addEventListener('click',function(){ it.classList.toggle('on'); A([it],{scale:[.94,1]},SPRING); }); });
  /* small companion sprites share one frame counter */
  if(document.querySelector('.kmini')){ var kf=0; setInterval(function(){ if(RM()||document.hidden) return; kf=(kf+1)%8; document.documentElement.style.setProperty('--f',kf); },140); }
  var tip=document.createElement('div'); tip.className='ktip'; document.body.appendChild(tip);
  document.addEventListener('pointerover',function(e){ var t=e.target.closest?e.target.closest('[data-tip]'):null; if(!t){ tip.style.opacity='0'; return; } tip.textContent=t.getAttribute('data-tip'); tip.style.opacity='1'; });
  document.addEventListener('pointermove',function(e){ if(tip.style.opacity==='1'){ tip.style.left=Math.min(e.clientX+12,innerWidth-270)+'px'; tip.style.top=(e.clientY+14)+'px'; } });

  /* ── small things ── */
  /* send throws a few phosphor pixels */
  function sparks(btn){
    if(RM()) return;
    for(var i=0;i<8;i++){ (function(){ var s=document.createElement('i'); s.className='spark'; btn.appendChild(s); var a=-Math.PI/2+(Math.random()-.5)*2.2, d=18+Math.random()*26;
      animate(s,{x:[0,Math.cos(a)*d],y:[0,Math.sin(a)*d],opacity:[1,0],scale:[1,.4]},{duration:.45+Math.random()*.25,ease:EASE}).then(function(){ s.remove(); }); })(); }
  }
  $$(document,'.send').forEach(function(b){ b.addEventListener('click',function(){ sparks(b); }); });
  /* the K's cursor blinks its own letter in Morse: long, short, long */
  if(!RM()){ var kpx=$$(document,'svg[data-i="kmark"] [data-p="px"]'); if(kpx.length) animate(kpx,{opacity:[1,1,0,0,1,1,0,0,1,1,0,0]},{duration:2.9,times:[0,.186,.188,.249,.251,.311,.313,.374,.376,.561,.563,1],ease:'linear',repeat:Infinity}); }
  /* on-screen keys go down with the real ones, and the review ones work */
  var KINDS=['p','s','g'];
  function seen(sel){ var r=document.querySelector(sel); return r&&r.closest('.board').__seen?r:null; }
  function pickKind(n){
    var r=seen('[data-enter="note"]'); if(!r) return; var btns=$$(r,'.float .b').slice(0,3), segs=$$(r,'.desk .nt.cur .seg > span'), card=r.querySelector('.desk .nt.cur');
    btns.forEach(function(b,i){ b.classList.toggle('pri',i===n); b.classList.toggle('gh',i!==n); b.style.color=i===n?'':'var(--ink)'; });
    segs.forEach(function(s,i){ s.classList.toggle('on',i===n); });
    if(card){ KINDS.forEach(function(c){ card.classList.remove(c); }); card.classList.add(KINDS[n]); }
    if(btns[n]) A([btns[n]],{scale:[.9,1]},SPRING); if(segs[n]) A([segs[n]],{scale:[.94,1]},SPRING);
  }
  function stepTurn(d){
    var r=seen('[data-enter="work"]'); if(!r) return; var rows=$$(r,'.out .tr'), i=-1; rows.forEach(function(x,j){ if(x.classList.contains('on')) i=j; });
    var j=Math.max(0,Math.min(rows.length-1,i+d)); if(j===i||i<0) return; rows[i].classList.remove('on'); rows[j].classList.add('on'); A([rows[j]],{x:[d*-6,0]},SPRING);
  }
  $$(document,'[data-enter="work"] .out .tr').forEach(function(row,j,rows){ row.addEventListener('click',function(){ rows.forEach(function(x){ x.classList.remove('on'); }); row.classList.add('on'); A([row],{x:[-6,0]},SPRING); }); });
  function carpe(){
    if(RM()) return; A($$(document,'.bot'),{rotate:[0,360],y:[0,-8,0]},{duration:.7,ease:EASE});
    $$(document,'.hint em').forEach(function(em){ var t=em.textContent; em.textContent='carpe diem'; A([em],{opacity:[0,1]},{duration:.3}); setTimeout(function(){ em.textContent=t; },2600); });
    $$(document,'.send').forEach(sparks);
  }
  var typed='';
  document.addEventListener('keydown',function(e){
    if(e.metaKey||e.ctrlKey||e.altKey) return; var k=e.key.length===1?e.key.toUpperCase():(e.key==='Escape'?'Esc':e.key);
    $$(document,'kbd').forEach(function(el){ if(el.textContent.trim()===k&&el.getClientRects().length) A([el],{y:[0,1.5,0],scale:[1,.9,1]},{duration:.18}); });
    var n={'1':0,'2':1,'3':2}[k]; if(n!=null) pickKind(n);
    if(k==='J') stepTurn(1); if(k==='K') stepTurn(-1);
    typed=(typed+k).slice(-5); if(typed==='CARPE'){ typed=''; carpe(); }
  });
})();
