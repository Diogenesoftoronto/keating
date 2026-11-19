(function(){
  var W=1120;
  if(!getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim()){document.documentElement.classList.add('standalone');}
  function fit(){
    document.querySelectorAll('.fit').forEach(function(f){
      var c=f.querySelector('.canvas'); if(!c) return;
      var z=f.clientWidth/W;
      if('zoom' in c.style){ c.style.zoom=z; }
      else { c.style.transformOrigin='0 0'; c.style.transform='scale('+z+')'; f.style.height=(c.offsetHeight*z)+'px'; }
    });
  }
  window.addEventListener('resize',fit);
  if(window.ResizeObserver){ new ResizeObserver(fit).observe(document.body); }
  fit();
  function group(sel,fn){
    document.querySelectorAll(sel).forEach(function(g){
      g.addEventListener('click',function(e){
        var b=e.target.closest('button'); if(!b||!g.contains(b)) return;
        g.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});
        fn(b.dataset.v,g); fit();
      });
    });
  }
  group('[data-tog="theme"]',function(v){var apply=function(){document.querySelectorAll('.kt').forEach(function(k){k.classList.toggle('dark',v==='dark');});}; if(window.KFx) window.KFx.theme(v,apply); else apply();});
  group('[data-tog="fx"]',function(v){ if(window.KFx) window.KFx.set(v); });
  group('[data-tog="voice"]',function(v){document.querySelectorAll('.kt').forEach(function(k){k.classList.toggle('v-mono',v==='mono');});});
  group('[data-tog="view"]',function(v,g){g.closest('.board').dataset.view=v;});
  group('[data-tog="mat"]',function(v,g){var s=g.closest('.board').querySelector('.chat'); if(!s) return; if(window.KMat) window.KMat(s,v==='on'); else s.classList.toggle('mat-on',v==='on');});
  group('[data-tog="motion"]',function(v){ document.documentElement.setAttribute('data-motion',v==='reduced'?'reduce':'full'); if(window.KGlyph) window.KGlyph.setMotion(v); });
})();
