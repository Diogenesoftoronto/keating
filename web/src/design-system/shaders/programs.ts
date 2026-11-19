// Shader equations and constants from the review/chat design prototype.
export const vertex = "attribute vec2 p; void main(){ gl_Position=vec4(p,0.,1.); }";
const header = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uR;uniform float uT;uniform vec2 uM;uniform float uS;uniform vec4 uA;uniform vec4 uB;uniform sampler2D uX;
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float t=0.,a=.5;for(int i=0;i<4;i++){t+=vn(p)*a;p=p*2.03+.17;a*=.5;}return t;}
float bay2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
float bay4(vec2 a){return bay2(.5*a)*.25+bay2(a);}`;

export const fragments = {
  paper: header + `
void main(){vec2 px=gl_FragCoord.xy;vec2 q=px/uA.x;
float a=texture2D(uX,q+uS).r,b=texture2D(uX,q*1.37+vec2(.31,.67)+uS).r;
float t=mix(a,b,smoothstep(.35,.65,vn(q*1.7+uS*9.)));
float fib=vn(vec2(px.x*.07,px.y*.9)+uS*40.)*vn(px*.35+uS*7.);
t=mix(1.-fib*.9,t,uB.x);
float v=1.-(1.-t)*uA.y+(h21(px+uS*91.)-.5)*uA.z+(fbm(px/uR.y*3.+uS)-.5)*uA.w;
gl_FragColor=vec4(vec3(clamp(v,0.,1.)),1.);}`,
  crt: header + `
void main(){vec2 px=gl_FragCoord.xy;vec2 uv=px/uR;uv.y=1.-uv.y;float asp=uR.x/uR.y;
float scan=step(mod(px.y,3.),1.)*.13;
float vig=smoothstep(.38,.9,length((uv-.5)*vec2(1.,.92)))*.4;
float y=fract(uT*.085+uS)+.035*sin(uT*.9)*step(.62,fract(uT*.037));
float roll=smoothstep(.1,0.,abs(uv.y-y))*.05;
float n=(h21(px+floor(uT*24.))-.5)*.03+(h21(vec2(floor(uT*24.),3.))-.5)*.012;
float d=length((uv-uM)*vec2(asp,1.));float d2=length((uv-uB.xy)*vec2(asp,1.));
float glow=exp(-d*d*42.)*.11*uA.x+exp(-d2*d2*26.)*.07*uB.z;
float l=clamp(roll+glow+n,0.,1.),k=clamp(scan+vig,0.,1.);
gl_FragColor=vec4(vec3(.29,.89,.53)*l,l+k-l*k);}`,
  power: header + `
void main(){vec2 uv=gl_FragCoord.xy/uR;float p=uA.x;float y=abs(uv.y-.5)*2.,x=abs(uv.x-.5)*2.;float hh,ww,l;
if(p<.5){float q=p/.5;hh=mix(1.,.006,smoothstep(0.,.72,q));ww=mix(1.,.004,smoothstep(.72,1.,q));l=smoothstep(.15,1.,q)*.92;}
else{float q=(p-.5)/.5;ww=mix(.004,1.,smoothstep(0.,.28,q));hh=mix(.006,1.,smoothstep(.22,1.,q));l=(1.-smoothstep(0.,.85,q))*.85;}
float ins=step(y,hh)*step(x,ww);
float halo=(1.-ins)*exp(-max(y-hh,0.)*26.)*exp(-max(x-ww,0.)*26.)*l*.5;
vec3 ph=uB.rgb;vec3 c=mix(vec3(.016,.03,.022)+ph*halo,ph*l,ins);
gl_FragColor=vec4(c,mix(1.,l,ins));}`,
  field: header + `
void main(){vec2 px=gl_FragCoord.xy;vec2 uv=px/uR;uv.y=1.-uv.y;float asp=uR.x/uR.y;
vec2 g=floor(px/uA.x);vec2 p=g*uA.x/uR.y;
float v=fbm(p*2.1+vec2(uT*.03,-uT*.018)+uS);
float d=length((uv-uM)*vec2(asp,1.));float lamp=exp(-d*d*17.)*uA.y;
float edge=smoothstep(.2,.66,length((uv-vec2(.5,.46))*vec2(asp*.6,1.)));
float dots=step(bay4(g),(v-.4)*1.3*edge);
float ln=(1.-texture2D(uX,vec2(px.x,uR.y-px.y)/uA.z+vec2(uT*.003,uT*.0015)).r)*uA.w;
float show=step(bay4(g),lamp*1.25)*ln;
float a=clamp(dots*.22+ln*.06*edge+show*.75,0.,1.)*uB.a;
gl_FragColor=vec4(uB.rgb*a,a);}`,
  ink: header + `
void main(){vec2 uv=gl_FragCoord.xy/uR;vec2 p=vec2(uv.x*uR.x/uR.y,uv.y)*uA.x;
vec2 fl=vec2(fbm(p*1.3+uS)-.5,fbm(p*1.3+7.3+uS)-.5)*uA.y;float t=uT*uA.z;float f0=fract(t),f1=fract(t+.5);
vec2 dr=vec2(t*.06,t*.02);
vec3 a=texture2D(uX,p+fl*f0+dr).rgb,b=texture2D(uX,p+fl*f1+dr+.37).rgb;vec3 c=mix(a,b,abs(1.-2.*f0));
float m=sin(p.x*9.+fbm(p*3.+t)*7.)*.5+.5;vec3 pr=mix(vec3(.08,.45,.24),vec3(.86,.94,.86),m*m);
c=mix(pr,c,uB.x);gl_FragColor=vec4(c*uB.yzw*uA.w,uA.w);}`,
};
export type Effect = keyof typeof fragments;
