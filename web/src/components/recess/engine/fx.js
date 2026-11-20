// Recess shader pass: lays the game over the chat. Owner: the shader lane.
// Two passes a frame. Pass 1 runs at half resolution: it blurs the emissive layer (only what
// should glow) into a bloom texture and keeps a decaying copy of the last frame in it, so fast
// things leave phosphor afterglow (terminal) or a wet-ink smear (paper). Its alpha holds the
// picture's blurred coverage, which pass 2 uses for ink bleed and the halftone drop shadow.
// Pass 2 composites at full resolution over the real DOM text (premultiplied alpha: rgb with a
// low alpha adds light, which is how the terminal glows without hiding the text underneath).
// Sources and reasoning: research/shaders.md.
export const RecessFx = (function () {
  "use strict";
  const VS = "attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}";
  const HEAD = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;uniform vec2 uR;uniform float uDark;
`;
  // pass 1, half resolution: bilinear taps of the full-size emissive layer (each tap already
  // averages four texels; dual-filter style, the small target does most of the blurring),
  // max-merged with the previous frame so bright things leave a trail.
  const BS = HEAD + `uniform sampler2D uE,uG,uPv;uniform float uK;
void main(){vec2 t=3./uR,u=vec2(t.x,-t.y);vec4 e=texture2D(uE,v)*.2+(texture2D(uE,v+t)+texture2D(uE,v-t)+texture2D(uE,v+u)+texture2D(uE,v-u))*.2;
float a=(texture2D(uG,v+t*.6).a+texture2D(uG,v-t*.6).a)*.5;
vec3 pv=texture2D(uPv,vec2(v.x,1.-v.y)).rgb*uK*mix(vec3(1.,.8,.75),vec3(.75,1.,.82),uDark);
gl_FragColor=vec4(max(e.rgb*1.4,pv),a);}`;
  const FS = HEAD + `uniform sampler2D uG,uE,uB;uniform float uT,uTg,uHit,uFlash,uFocus,uOn,uCalm,uWx,uWipe,uThr,uTilt,uPg,uCa,uCare,uTw;
uniform vec4 uMv,uBs,uDn,uFl;uniform vec2 uCh;
uniform vec2 uP,uN;uniform vec3 uInk,uGlow;uniform vec4 uS[4],uZ[4],uEu;
// arithmetic hash (no sin): cheaper on phones and software GL, and stable at mediump
float h21(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){return vn(p)*.62+vn(p*2.03+.17)*.31;}
float bay2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
// +1/32 so a cell never lights at zero coverage (step(0.,0.) is 1)
float bay4(vec2 a){return bay2(.5*a)*.25+bay2(a)+.031;}
vec4 over(vec4 t,vec4 u){return t+u*(1.-t.a);}
vec4 bt(vec2 p){return texture2D(uB,vec2(p.x,1.-p.y));}
void main(){
  float asp=uR.x/uR.y,mo=1.-uCalm;vec2 pc=v*uR,A=vec2(asp,1.),t=1./uR;
  // shockwaves bend the game layer and leave a bright ring
  vec2 d=vec2(0.);float ring=0.,vis=0.;
  if(uN.x>0.)for(int i=0;i<4;i++){vec4 s=uS[i];if(s.w>0.){vec2 dv=(v-s.xy)*A;float dist=length(dv),w=dist-s.z*.95;
    float fade=s.w*exp(-s.z*2.4),env=exp(-w*w*240.)*fade;d-=dv/(dist+1e-4)*env*.03;ring+=env;vis+=exp(-w*w*1500.)*fade;}}
  // heat shimmer in the plume under his jets: only the game layer bends (the DOM cannot)
  vec2 j=(v-uP)*A;j=vec2(j.x*cos(uTilt)+j.y*sin(uTilt),j.y*cos(uTilt)-j.x*sin(uTilt));
  float pl=uThr*smoothstep(.0,.05,j.y)*smoothstep(.22,.06,j.y)*smoothstep(.035+j.y*.25,0.,abs(j.x));
  if(pl>.001)d.x+=(vn(pc*.06+vec2(0.,uT*14.))-.5)*.006*pl;
  // slam: a crest runs both ways along the composer from where the boss landed; words there lift
  float rp=0.;if(uFl.w>0.){float fy=(v.y-uFl.y)*uR.y,fx=abs(v.x-uFl.x)*uR.x-uFl.z;
    rp=exp(-fx*fx*.002)*smoothstep(-60.,0.,fy)*step(fy,6.)*uFl.w;d.y-=rp*3.*t.y;rp=step(bay4(pc*.5),rp*.6)*.16;}
  vec2 q=v+d*mo/A;
  float ca=(uCa*.010+ring*.0035)*mo;
  vec4 c0=texture2D(uG,q),cl=texture2D(uG,q+vec2(ca,0.)),cr=texture2D(uG,q-vec2(ca,0.)),ec=texture2D(uE,q);
  vec4 c=vec4(cl.r,c0.g,cr.b,max(c0.a,max(cl.a,cr.a)*.85));
  // second wind: the field falls back behind the question (he stays), and comes back as a ring
  // that re-inks the page outward from him. Hang and the last chance drain colour from all but
  // the bullets (emissive), so what can still hurt keeps its red.
  float bd=length((v-uP)*A),dn=0.;if(uDn.z>0.)dn=uDn.z*smoothstep(.03,.09,bd)*step(uDn.w,length((v-uDn.xy)*A));
  float gr=uMv.x*.55+uMv.w*.85+dn;if(gr>0.){c.rgb=mix(c.rgb,vec3(dot(c.rgb,vec3(.3,.59,.11))),min(gr,1.)*(1.-ec.a));c*=1.-dn*.55;}
  // bloom from pass 1 (four bilinear taps = a soft tent), with a faint aperture grille on the terminal
  vec2 o=t*2.5,u=vec2(o.x,-o.y);vec4 b=(bt(q+o)+bt(q-o)+bt(q+u)+bt(q-u))*.25;
  b*=1.-dn*.7;float bm=max(b.r,max(b.g,b.b));
  // paper fibre (the app's paper shader): ink loses a little where the fibre is high
  vec4 col;
  if(uDark>.5){
    vec3 m=vec3(1.)+.14*(step(mod(pc.x,3.),1.)*vec3(1.,-1.,-1.)+step(2.,mod(pc.x,3.))*vec3(-1.,-1.,1.));
    vec3 gl=b.rgb*m*1.15+uGlow*bm*.25;
    col=c+vec4(gl,bm*.35)*(1.-c.a);
    // his own lamp: a soft phosphor pool around the bot, light only
    col.rgb+=uGlow*exp(-bd*bd*38.)*.05*uOn*(.35+uCare*.85);
  }else{
    float fib=h21(floor(vec2(pc.x*.08,pc.y*.9)));
    c*=1.-fib*.16*(1.-ec.a);
    // ink bleed follows the paper fibre; red-pen glow sits under the ink as a wash
    float bl=clamp(b.a*1.3-c.a,0.,1.)*(.12+fib*.22);
    col=c+vec4(uInk*bl,bl)*(1.-c.a);
    col=col+vec4(b.rgb*.4,bm*.32)*(1.-col.a);
    // halftone drop shadow: lifted things (enemies, loose words) float a few px above the page
    vec4 sb=bt(q-t*vec2(4.,6.));
    float sa=smoothstep(.12,.55,sb.a-max(sb.r,max(sb.g,sb.b))*1.6)*(1.-col.a);
    float hs=step(bay4(pc*.5),sa*.5)*.14*uOn;
    col=over(col,vec4(uInk*hs,hs));
  }
  // the page slides by: two dither layers at two speeds (parallax), and drifting motes.
  // uPg is integrated on game time in JS: hit-stop freezes it, slow motion thickens it, a streak
  // speeds it up, a plot twist runs it backwards, a hang and Calm stop it.
  float tt=uPg;
  vec2 g1=floor(pc/4.),g2=floor(pc/2.);
  float far=step(bay4(g1),(vn(vec2(g1.x*.45,g1.y*.012-tt*.9))-.72)*2.);
  float ny=g2.y*.012-tt*4.4,near=step(bay4(g2),(h21(vec2(g2.x,floor(ny)))-.93)*14.*fract(ny));
  vec2 mp=pc-vec2(sin(uTg*.4+pc.y*.004)*10.,-tt*190.);vec2 mc=floor(mp/38.);
  float mr=h21(mc),mote=step(.84,mr)*smoothstep(1.7,.5,length(fract(mp/38.)*38.-fract(vec2(mr*7.,mr*13.))*30.-4.));
  mote*=mix(.55,.6+.4*sin(uT*3.+mr*40.),uDark);
  float fa=(far*mix(.06,.09,uDark)+near*mix(.09,.14,uDark)+mote*mix(.25,.5,uDark))*uOn;
  // boss weather: cloud shadows that thicken with each phase (static on the terminal), and a
  // front that sweeps down the arena when a phase turns
  if(uWx>0.){float cl=fbm(pc/uR.y*2.6+vec2(uTg*.06,-uTg*.02));cl=smoothstep(.45,.75,cl)*uWx;
    float wf=exp(-pow((v.y-uWipe*1.3+.15)*9.,2.))*step(0.,uWipe)*(1.-uWipe);
    // a clear moat round every drawn thing and round him, so bullets and the bot always read
    float moat=(1.-smoothstep(.03,.25,b.a+bm*1.5))*smoothstep(.05,.15,bd);
    fa+=(step(bay4(g1),cl*.4+wf*.7)*mix(.05,.04,uDark)+step(.985-cl*.04,h21(pc+fract(uT)*91.))*uDark*.3)*moat;}
  // slam crest; the charge leaves a wake of ink dashes in its lane; inhale draws spokes inward
  fa+=rp;
  if(uCh.y>0.){float bh=(v.x-uBs.x)*uCh.x*uR.x;
    fa+=step(.62,h21(floor(pc/vec2(70.,3.))))*smoothstep(-460.,-60.,bh)*step(bh,0.)*smoothstep(1.,.3,abs(v.y-uBs.y)/uBs.w)*uCh.y*.28;}
  if(uMv.z>0.){vec2 r2=pc-uBs.xy*uR;float rr=length(r2);
    fa+=step(.8,h21(vec2(floor(atan(r2.y,r2.x)*40.),3.)))*step(.72,fract(rr*.022+uTg*2.2))*smoothstep(380.,70.,rr)*uMv.z*mix(.15,.22,uDark);}
  fa*=1.-dn;
  col=over(col,vec4(mix(uInk,uGlow,uDark)*fa,fa));
  // hang: a hung window goes pale. A frosted veil over the page only, never over what is drawn
  if(uMv.x>0.){float fr=uMv.x*(.12+step(bay4(pc*.5),.5)*.08)*(1.-col.a);col=over(col,vec4(mix(vec3(1.),uInk*.3,uDark)*fr,fr));}
  // plot twist: the page turns over, right to left: a fold line with its shadow behind it
  if(uTw>=0.){float fx=(v.x-1.05+uTw*1.2)*asp,sh=smoothstep(0.,.06,-fx)*smoothstep(.3,.06,-fx)*.3,el=exp(-fx*fx*3000.)*.6;
    sh=step(bay4(pc*.5),sh)*.18;col=over(vec4(mix(vec3(1.),uGlow,uDark*.5)*el,el),over(col,vec4(mix(uInk,vec3(0.),uDark)*sh,sh)));}
  // graze sparks: a tiny ring where a bullet scraped past him
  float gz=0.;if(uN.y>0.)for(int i=0;i<4;i++){vec4 z=uZ[i];if(z.z<.3){float dd=length(pc-z.xy*uR)-z.z*70.*z.w;gz+=exp(-dd*dd*.35)*(1.-z.z/.3);}}
  gz=clamp(gz,0.,1.)*.5;
  // bright ring where a shockwave passes
  float rg=clamp(vis*.7+ring*.12,0.,1.)*(1.-uCalm*.6);
  col=over(vec4(mix(uGlow,vec3(1.),.4)*rg*uDark+uGlow*rg*(1.-uDark)*.7,rg*mix(.55,1.,uDark)),col);
  col.rgb+=uGlow*gz;col.a=min(1.,col.a+gz*(1.-uDark)*.6);
  // Eureka: the page turns over. A disc grows from where he spent it; inside it the game layer
  // goes negative and the lesson sits under a dithered wash, edged by a bright line.
  if(uEu.w>0.){float ed=length((v-uEu.xy)*A),er=uEu.z*1.7,ek=1.-smoothstep(.12,.55,uEu.z);
    float ins=step(ed,er)*ek*smoothstep(.04,.1,ed);col.rgb=mix(col.rgb,(col.a-dot(col.rgb,vec3(.3,.59,.11)))*mix(uGlow*.7,uGlow+.25,uDark),ins*.8);
    float wa=step(bay4(pc*.5),.45)*ins*.22,el=exp(-pow((ed-er)*90.,2.))*ek*.8;
    col=over(vec4(mix(uInk,uGlow,uDark)*wa,wa),col);col=over(vec4(mix(uGlow,vec3(1.),.5)*el,el),col);}
  if(uDn.w>0.){float rd=length((v-uDn.xy)*A)-uDn.w,re=exp(-rd*rd*5000.)*(1.-uDn.w/1.95)*.75;col=over(vec4(mix(uGlow,vec3(1.),.3)*re,re),col);}
  // focus dims the edges so the small hitbox is easy to read; the thesis window spotlights the boss
  // and him; the last chance closes a tunnel on him; down dims the rest
  float k=smoothstep(.1,.55,bd)*(.2*uFocus+uMv.w*.35)+dn*.12;
  if(uMv.y>0.)k+=uMv.y*.16*smoothstep(0.,.12,length(max(abs(v-uBs.xy)-uBs.zw,0.)*A))*smoothstep(.05,.2,bd);
  // terminal: scanlines with a slow rolling band (the app's CRT surface) and a rounded-glass
  // vignette. No geometric warp: what you see must be where it is.
  vec2 rv=abs(v-.5)*2.;float corner=length(max(rv-vec2(.72),0.))/.28;
  if(uDark>.5){float y=fract(uT*.085);float roll=smoothstep(.08,0.,abs(v.y-y))*mo;
    k+=(step(mod(pc.y,3.),1.)*.11*(1.-roll*.6)+smoothstep(.42,.98,length((v-.5)*vec2(1.,.92)))*.3+smoothstep(.55,1.,corner)*.35)*uOn;
    col.rgb+=uGlow*roll*.025*uOn;}
  else{k+=smoothstep(.5,1.05,length((v-.5)*vec2(1.,.92)))*.1*uOn;}
  k=clamp(k+uWx*.06*smoothstep(.3,1.,length(v-.5)*1.4),0.,1.);
  col=over(vec4(mix(uInk,vec3(0.),uDark)*k,k),col);
  // hurt: a warm edge (not a saturated red). flash: eased out by the caller, capped in JS.
  float hv=smoothstep(.25,.95,length(v-.5)*1.25)*uHit*.5*(1.-uCalm*.5);
  col=over(vec4(vec3(.74,.3,.22)*hv,hv),col);
  float fl=uFlash*.55*mo;
  col=over(vec4(mix(vec3(1.),uGlow,.25)*fl,fl),col);
  gl_FragColor=col;
}`;
  function post(canvas) {
    // The glow pass is a luxury: on software WebGL it costs most of the frame, so it never starts there.
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, failIfMajorPerformanceCaveat: true });
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || "") : "";
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)) { gl.getExtension("WEBGL_lose_context")?.loseContext(); return null; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader"); return s; };
    const vs = sh(gl.VERTEX_SHADER, VS);
    const prog = (src, names) => {
      const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, src)); gl.bindAttribLocation(pr, 0, "p"); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || "link");
      const U = { pr }; for (const n of names.split(" ")) U[n] = gl.getUniformLocation(pr, n); return U;
    };
    const M = prog(FS, "uG uE uB uR uT uTg uDark uHit uFlash uFocus uOn uCalm uWx uWipe uThr uTilt uPg uCa uCare uTw uMv uBs uDn uFl uCh uP uN uInk uGlow uS uZ uEu");
    const B = prog(BS, "uE uG uPv uR uK uDark");
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const mkTex = (unit) => {
      const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };
    mkTex(0); mkTex(1); // units 0, 1: picture and glow, uploaded every frame
    // two half-size targets, ping-ponged: one is written while the other is last frame
    const half = [mkTex(2), mkTex(3)], fbo = [gl.createFramebuffer(), gl.createFramebuffer()];
    let hw = 1, hh = 1, W = 1, H = 1, cur = 0;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.useProgram(B.pr); gl.uniform1i(B.uE, 1); gl.uniform1i(B.uG, 0);
    gl.useProgram(M.pr); gl.uniform1i(M.uG, 0); gl.uniform1i(M.uE, 1);
    gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0);
    let lost = false, lastRT = -1, ring = null, euT = 9, eu = new Float32Array(4), wx = 0, wipe = -1, hooked = null;
    const shocks = new Float32Array(16), graze = new Float32Array(16), flashes = [-9, -9, -9];
    let gi = 0, lastFlash = 0, flashGate = 1;
    // the boss's moves and the bot's moments, each eased so nothing pops: page clock (pg) and its
    // direction, own clocks that Calm, a hang and second wind hold still (tg, rt)
    const F = () => new Float32Array(4), mv = F(), bx = F(), dnv = F(), fl = F(), ch = new Float32Array(2);
    let pg = 0, tg = 0, rt = 0, lastT = 0, pdir = 1, twT = 9, slT = 9, snap = 0, lc = 0, rvT = 9;
    const ease = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-dt * r));
    for (let i = 0; i < 4; i++) graze[i * 4 + 2] = 9;
    const contextLost = () => { lost = true; };
    canvas.addEventListener("webglcontextlost", contextLost);
    const clearHalf = () => { for (let i = 0; i < 2; i++) { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[i]); gl.clear(gl.COLOR_BUFFER_BIT); } gl.bindFramebuffer(gl.FRAMEBUFFER, null); };
    // listen once per game object: grazes and boss phases are moments, not state
    const listen = (G) => {
      hooked = G;
      G.on("graze", (d) => { const k = gi++ % 4 * 4; graze[k] = d.x / G.W; graze[k + 1] = d.y / G.H; graze[k + 2] = 0; graze[k + 3] = G.dpr; });
      G.on("bossPhase", (d) => { if (!d.first && !G.calm) wipe = 0; });
      G.on("start", () => { wx = 0; wipe = -1; euT = 9; twT = slT = rvT = 9; lc = snap = 0; dnv[2] = 0; mv.fill(0); ch[1] = 0; lastT = 0; if (!lost) clearHalf(); });
      G.on("attack", (d) => {
        if (d.kind === "slam") { slT = 0; fl[0] = d.e.x / G.W; } else if (d.kind === "twist") twT = 0; else if (d.kind === "resume") snap = 1;
      });
      G.on("hitPending", () => { lc = 1; });
      G.on("lastChance", () => { lc = Math.min(lc, 0.5); });
      G.on("revive", (d) => { rvT = 0; dnv[0] = d.x / G.W; dnv[1] = d.y / G.H; });
    };
    return {
      get lost() { return lost; },
      resize(w, h) {
        W = w; H = h; hw = Math.max(1, w >> 1); hh = Math.max(1, h >> 1);
        for (let i = 0; i < 2; i++) {
          gl.activeTexture(gl.TEXTURE2 + i); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, hw, hh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[i]); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, half[i], 0);
        }
        clearHalf();
      },
      dispose() {
        canvas.removeEventListener("webglcontextlost", contextLost);
        if (!lost) gl.getExtension("WEBGL_lose_context")?.loseContext();
        lost = true;
      },
      clear() { if (!lost) { gl.viewport(0, 0, W, H); gl.clear(gl.COLOR_BUFFER_BIT); clearHalf(); } },
      // picture: the game canvas. glow: the emissive canvas. G: the game object.
      draw(picture, glow, G) {
        if (lost) return;
        if (hooked !== G) listen(G);
        const f = G.fx, P = G.P, pal = G.pal, rdt = lastRT < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, G.RT - lastRT)); lastRT = G.RT;
        // photosensitivity: at most three flash onsets in any second, whoever asked for them
        if (f.flash > lastFlash + 0.2) { flashGate = G.RT - flashes[0] > 1 ? 1 : 0; if (flashGate) { flashes.shift(); flashes.push(G.RT); } }
        lastFlash = f.flash;
        // Eureka: G.ring appears when he spends one; the disc outlives it a little
        if (G.ring && G.ring !== ring && !G.calm) { euT = 0; eu[0] = G.ring.x / G.W; eu[1] = G.ring.y / G.H; if (G.RT - flashes[0] > 1) { flashes.shift(); flashes.push(G.RT); } else euT = 9; }
        ring = G.ring; euT += rdt; eu[2] = euT; eu[3] = euT < 0.6 ? 1 : 0;
        // boss weather eases toward the phase (0 none, then .4, .6, .8, 1)
        const bs = G.boss && !G.boss.dead && G.boss.stage >= 0 ? Math.min(1, 0.4 + G.boss.stage * 0.2) : 0;
        wx += (bs - wx) * (1 - Math.exp(-rdt * 1.5)); if (wipe >= 0) { wipe += rdt / 1.1; if (wipe > 1) wipe = -1; }
        // the boss: frost while bullets hang, spotlight in the thesis window, pull while inhaling,
        // a wake while charging. Its box feeds the spotlight, the spokes and the wake's height.
        const dT = Math.max(0, Math.min(0.1, G.T - lastT)), Bo = G.boss && !G.boss.dead && G.boss, mo = Bo && Bo.move, frz = !!(Bo && Bo.frz), down = G.state === "down", c = !G.calm;
        lastT = G.T; lc = Math.max(0, lc - rdt * (lc > 0.5 ? 1.4 : 3));
        mv[0] = ease(mv[0], +frz, 7, rdt); mv[1] = ease(mv[1], +(mo === "thesis"), 5, rdt); mv[2] = ease(mv[2], +(mo === "inhale" && Bo.act === "attack"), 4, rdt); mv[3] = lc;
        if (Bo) { bx[0] = Bo.x / G.W; bx[1] = Bo.y / G.H; bx[2] = Bo.w / 2 / G.W; bx[3] = Bo.h / 2 / G.H; }
        const chg = mo === "charge" && Bo.vx; if (chg) ch[0] = Math.sign(Bo.vx); ch[1] = ease(ch[1], +!!chg, chg ? 12 : 3, rdt);
        slT += dT; twT += dT; rvT += rdt; snap = Math.max(0, snap - rdt * 7);
        fl[1] = G.floorY / G.H; fl[2] = slT * 240; fl[3] = c && slT < 0.9 ? 1 - slT / 0.9 : 0;
        // second wind: fade in under the question; a revive sweeps it away as a ring from him
        const ringOn = c && rvT < 0.8;
        dnv[2] = down ? ease(dnv[2], 1, 4, rdt) : ringOn ? dnv[2] : c && rvT < 2 ? 0 : dnv[2] * Math.exp(-rdt * 6); dnv[3] = ringOn ? rvT * 2.4 : 0;
        // the page clock: game time, so hit-stop freezes it; a twist turns it round for a moment
        pdir = ease(pdir, twT < 1.4 ? -1.6 : 1, 5, rdt);
        if (c && !frz && !down) { pg += dT * f.speed * (1 + (G.mult - 1) * 0.086) * pdir; tg += dT; rt += rdt; }
        let gzLive = 0; for (let i = 0; i < 4; i++) if ((graze[i * 4 + 2] += rdt) < 0.3) gzLive = 1;
        // afterglow lasts longer when time is thick (focus, slow motion)
        const thick = Math.max(f.focus, f.slow < 1 ? 1 : 0), k = Math.pow((G.dark ? 0.75 : 0.5) + thick * 0.12, rdt * 60);
        gl.activeTexture(gl.TEXTURE0); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
        gl.activeTexture(gl.TEXTURE1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glow);
        // pass 1: bloom + afterglow into half[cur], reading last frame from half[1 - cur]
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[cur]); gl.viewport(0, 0, hw, hh); gl.useProgram(B.pr);
        gl.uniform1i(B.uPv, 3 - cur); gl.uniform2f(B.uR, W, H); gl.uniform1f(B.uK, G.calm ? k * 0.5 : k); gl.uniform1f(B.uDark, G.dark ? 1 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        // pass 2: composite to the canvas
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(M.pr);
        shocks.fill(0); f.shocks.forEach((s, i) => { if (i > 3) return; shocks[i * 4] = s.x / G.W; shocks[i * 4 + 1] = s.y / G.H; shocks[i * 4 + 2] = s.t; shocks[i * 4 + 3] = s.s; });
        const care = G.care ? G.care.charge : 0.75, u1 = (n, x) => gl.uniform1f(M[n], x), u4 = (n, x) => gl.uniform4fv(M[n], x);
        gl.uniform1i(M.uB, 2 + cur); gl.uniform2f(M.uR, W, H); gl.uniform2fv(M.uCh, ch);
        u1("uT", rt); u1("uTg", tg); u1("uDark", +G.dark); u1("uHit", f.hit); u1("uFlash", flashGate ? f.flash : 0); u1("uFocus", f.focus); u1("uOn", f.on); u1("uCalm", +G.calm);
        u1("uPg", pg); u1("uCa", f.hit + snap); u1("uCare", care); u1("uTw", twT < 0.55 && !G.calm ? twT / 0.55 : -1); u1("uWx", wx); u1("uWipe", wipe);
        u1("uThr", G.calm || G.state === "idle" ? 0 : P.thrust * (0.5 + care * 0.67)); u1("uTilt", P.tilt || 0);
        u4("uMv", mv); u4("uBs", bx); u4("uDn", dnv); u4("uFl", fl); u4("uS", shocks); u4("uZ", graze); u4("uEu", eu);
        gl.uniform2f(M.uP, P.x / G.W, P.y / G.H); gl.uniform3fv(M.uInk, pal.inkRGB); gl.uniform3fv(M.uGlow, pal.glowRGB); gl.uniform2f(M.uN, f.shocks.length, gzLive);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        cur = 1 - cur;
      },
    };
  }

  return { post };
})();
