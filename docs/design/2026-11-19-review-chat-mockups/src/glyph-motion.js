/* Keating glyph motion. Drives the parts named in keating-glyphs.mjs with Motion (motion.dev). */
(function(){
  var K=window.KMotion; if(!K) return;
  var animate=K.animate, hover=K.hover, stagger=K.stagger, SPEC=window.KGLYPHS||{};
  var mq=window.matchMedia('(prefers-reduced-motion: reduce)'), forced=null;
  function RM(){ return forced ? forced==='reduced' : mq.matches; }
  var EASE=[.2,.8,.2,1], SPRING={type:'spring',stiffness:480,damping:20}, SOFT={type:'spring',stiffness:260,damping:24};
  var REST={x:0,y:0,rotate:0,scale:1,scaleX:1,scaleY:1,opacity:1,pathLength:1};
  function parts(svg,tok){ var out=[]; tok.split(',').forEach(function(t){ svg.querySelectorAll('[data-p="'+t+'"]').forEach(function(e){ out.push(e); }); }); return out; }
  function opts(o,base){ o=Object.assign({},base,o||{}); if(o.stagger!=null){ o.delay=stagger(o.stagger,{startDelay:o.start||0}); delete o.stagger; delete o.start; } return o; }
  function rest(kf){ var r={}; Object.keys(kf).forEach(function(k){ r[k]=REST[k]; }); return r; }
  function run(svg,list,base){ (list||[]).forEach(function(e){ var els=parts(svg,e[0]); if(els.length) animate(els,e[1],opts(e[2],base)); }); }
  function start(svg){
    svg.setAttribute('data-lit','');
    var s=SPEC[svg.getAttribute('data-i')];
    if(s && !RM()){ run(svg,s.play,{duration:.42,ease:EASE}); run(svg,s.hold,SPRING); run(svg,s.loop,{duration:.7,ease:'easeInOut',repeat:Infinity}); }
    return function(){
      svg.removeAttribute('data-lit'); if(!s) return;
      (s.hold||[]).concat(s.loop||[]).forEach(function(e){ var els=parts(svg,e[0]); if(els.length) animate(els,rest(e[1]),RM()?{duration:0}:SOFT); });
    };
  }
  function pressed(svg){
    var s=SPEC[svg.getAttribute('data-i')]; if(!s||!s.press||RM()) return;
    animate(s.press.map(function(e){ return [parts(svg,e[0]),e[1],Object.assign({ease:EASE},e[2]||{})]; }));
  }
  var HOSTS='button,a,.chip,.tabs>span,.seg>span,.pass,.st-c,.menu>div,.cd,.ses,.q,.tr,.lnk,.find,.gl,.how';
  function bind(root){
    var map=new Map();
    root.querySelectorAll('svg.i[data-i]').forEach(function(svg){ if(svg.__k) return; svg.__k=1; var host=svg.closest(HOSTS)||svg; if(!map.has(host)) map.set(host,[]); map.get(host).push(svg); });
    map.forEach(function(svgs,host){
      hover(host,function(){ var ends=svgs.map(start); return function(){ ends.forEach(function(f){ f(); }); }; });
      host.addEventListener('pointerdown',function(){ svgs.forEach(pressed); });
      host.addEventListener('focusin',function(){ if(host.matches(':focus-visible')){ var ends=svgs.map(start); host.addEventListener('focusout',function(){ ends.forEach(function(f){ f(); }); },{once:true}); } });
    });
  }
  function once(svg,ms){ var end=start(svg); setTimeout(end,ms||1000); }
  function swap(svg,name){ var s=SPEC[name]; if(!s) return; svg.setAttribute('data-i',name); svg.innerHTML=s.d; }
  window.KGlyph={bind:bind,once:once,swap:swap,RM:RM,setMotion:function(v){ forced=v; document.documentElement.setAttribute('data-motion',v==='reduced'?'reduce':'full'); },EASE:EASE,SPRING:SPRING,SOFT:SOFT};
  bind(document);
})();
