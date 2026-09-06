// Strudel transforms double-quoted literals into patterns. Keep slider data out of its compiler.
export const MUSIC_CONTROLS_PRELUDE = "const controls=globalThis.__keatingMusicControls;\n";

/** Trusted iframe controller. Authored code is evaluated only by the isolated Strudel runtime. */
export const MUSIC_PLAYER_SCRIPT = String.raw`
(() => {
const settings=JSON.parse(document.getElementById('settings').textContent);
const editor=document.getElementById('code'),play=document.getElementById('play'),stop=document.getElementById('stop'),status=document.getElementById('status');
const canvas=document.getElementById('visual'),context=canvas.getContext('2d'),caption=document.getElementById('visual-caption'),table=document.getElementById('events');
const editDetails=document.getElementById('edit');
const scope=settings.visualization==='scope',reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const values=Object.create(null),parameters=settings.controls||[],noteNames=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
let repl,wanted=false,playing=false,frame=0,timer=0,busy=false,queued=false,lastDraw=0,lastCycle=-1,events=[],signal=null;
editor.value=settings.code;
function noteLabel(midi){const n=Math.round(midi);return noteNames[((n%12)+12)%12]+(Math.floor(n/12)-1);}
function format(value,unit){return unit==='MIDI'?noteLabel(value)+' · '+value:Number(value.toFixed(3)).toLocaleString()+(unit?' '+unit:'');}
parameters.forEach(parameter=>{
  values[parameter.id]=parameter.value;
  const label=document.createElement('label'),row=document.createElement('span'),name=document.createElement('span'),output=document.createElement('output'),input=document.createElement('input');
  label.className='control';row.className='control-label';name.textContent=parameter.label;
  input.type='range';input.min=parameter.min;input.max=parameter.max;input.step=parameter.step||'any';input.value=parameter.value;
  input.setAttribute('aria-label',parameter.label+(parameter.unit?' ('+parameter.unit+')':''));
  function update(){output.textContent=format(values[parameter.id],parameter.unit);input.setAttribute('aria-valuetext',output.textContent);input.style.setProperty('--fill',((values[parameter.id]-parameter.min)/(parameter.max-parameter.min)*100)+'%');}
  input.addEventListener('input',()=>{const next=Number(input.value);if(!Number.isFinite(next))return;values[parameter.id]=Math.min(parameter.max,Math.max(parameter.min,next));update();if(wanted){clearTimeout(timer);timer=setTimeout(apply,90);}});
  row.append(name,output);label.append(row,input);document.getElementById('controls').append(label);update();
});
function reportSize(){parent.postMessage({type:'keating-music-resize',height:Math.ceil(document.body.getBoundingClientRect().height)},'*');}
new ResizeObserver(reportSize).observe(document.body);
function dimensions(){const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}context.setTransform(dpr,0,0,dpr,0,0);return{w,h,left:42,right:w-12,top:14,bottom:h-28};}
function grid(box){const{w,h,left,right,top,bottom}=box;context.clearRect(0,0,w,h);context.strokeStyle='#2d4336';context.lineWidth=1;context.fillStyle='#a8beb0';context.font='10px system-ui';context.textBaseline='middle';for(let i=0;i<=4;i++){const x=left+(right-left)*i/4;context.beginPath();context.moveTo(x,top);context.lineTo(x,bottom);context.stroke();context.textAlign=i===4?'right':i===0?'left':'center';context.fillText(scope?(i===0?'0':i===4?signal?((signal.length/strudel.getAudioContext().sampleRate)*1000).toFixed(1)+' ms':'time':''):i===4?'1 cycle':i===0?'0':String(i/4),x,bottom+15);}context.textAlign='right';}
function readEvents(cycle){
  lastCycle=cycle;
  try{events=(repl?.state.pattern?.queryArc(cycle,cycle+1)||[]).slice(0,128).flatMap(event=>{
    const value=event.value||{},span=event.part||event.whole,raw=Array.isArray(value.note)?value.note:[value.note];
    return raw.flatMap(note=>{let midi=typeof note==='number'?note:typeof note==='string'?strudel.noteToMidi(note):Number.isFinite(value.freq)&&value.freq>0?69+12*Math.log2(value.freq/440):NaN;
      const start=Number(span?.begin)-cycle,end=Number(span?.end)-cycle;
      return Number.isFinite(midi)&&Number.isFinite(start)&&Number.isFinite(end)&&end>start?[{midi,start:Math.max(0,start),end:Math.min(1,end)}]:[];});
  });}catch(error){events=[];caption.textContent='This pattern has no drawable note events.';}
  table.replaceChildren();
  events.forEach(event=>{const row=document.createElement('tr');[noteLabel(event.midi),event.start.toFixed(3),event.end.toFixed(3)].forEach(value=>{const cell=document.createElement('td');cell.textContent=value;row.append(cell);});table.append(row);});
  if(!scope)caption.textContent=events.length?events.length+' notes · one cycle · pitch ↑':'';
  canvas.dataset.eventCount=String(events.length);
}
function drawRoll(box,position){
  const{left,right,top,bottom}=box,notes=[...new Set(events.map(event=>event.midi))].sort((a,b)=>b-a),min=notes.length?Math.min(...notes)-2:48,max=Math.max(min+16,(notes[0]||60)+2),pitchY=midi=>bottom-(midi-min)/(max-min)*(bottom-top),noteHeight=Math.max(8,Math.min(15,(bottom-top)/(max-min)*1.4));
  notes.forEach(midi=>{const y=pitchY(midi);context.fillStyle='#a8beb0';context.textAlign='right';context.fillText(noteLabel(midi),left-7,y);context.strokeStyle='#2d4336';context.beginPath();context.moveTo(left,y);context.lineTo(right,y);context.stroke();});
  events.forEach(event=>{const row=notes.indexOf(event.midi),y=pitchY(event.midi)-noteHeight/2,active=playing&&!reducedMotion.matches&&position>=event.start&&position<event.end;context.fillStyle=active?'#a7f8c1':row%2?'#dbb876':'#4be388';context.globalAlpha=active?1:.8;context.beginPath();context.roundRect(left+event.start*(right-left)+1,y,Math.max(2,(event.end-event.start)*(right-left)-3),noteHeight,3);context.fill();context.globalAlpha=1;});
  if(playing&&!reducedMotion.matches){context.strokeStyle='#e4fbed';context.lineWidth=1.5;const x=left+position*(right-left);context.beginPath();context.moveTo(x,top);context.lineTo(x,bottom);context.stroke();}
}
function drawScope(box){
  const{left,right,top,bottom}=box,middle=(top+bottom)/2,scale=(bottom-top)/2;
  const data=playing?strudel.getAnalyzerData('time',1):null;let peak=0,squares=0;
  if(data?.length){data.forEach(sample=>{if(Number.isFinite(sample)){peak=Math.max(peak,Math.abs(sample));squares+=sample*sample;}});const crossing=data.findIndex((sample,index)=>index>0&&data[index-1]<=0&&sample>0),start=crossing>=0&&crossing+512<data.length?crossing:0;signal=data.subarray(start,Math.min(start+512,data.length));}
  const range=Math.max(.125,2**Math.ceil(Math.log2(Math.max(peak,.001))));
  context.fillStyle='#a8beb0';context.textAlign='right';[['+'+range,top],['0',middle],['−'+range,bottom]].forEach(([label,y])=>{context.fillText(label,left-8,y);context.strokeStyle='#2d4336';context.beginPath();context.moveTo(left,y);context.lineTo(right,y);context.stroke();});
  if(!data?.length||!signal)return;
  context.beginPath();context.strokeStyle='#72eda0';context.lineWidth=2;
  signal.forEach((sample,index)=>{if(!Number.isFinite(sample))return;const x=left+index/(signal.length-1)*(right-left),y=middle-sample/range*scale;if(index===0)context.moveTo(x,y);else context.lineTo(x,y);});context.stroke();
  caption.textContent='Live output · peak '+peak.toFixed(3)+' · RMS '+Math.sqrt(squares/data.length).toFixed(3);
  canvas.dataset.signalPeak=String(peak);
}
function draw(){if(!context)return;const box=dimensions();if(box.w<1)return;grid(box);if(scope)drawScope(box);else{const now=playing?repl.scheduler.now():lastCycle<0?0:lastCycle,cycle=Math.floor(now);if(repl?.state.pattern&&cycle!==lastCycle)readEvents(cycle);drawRoll(box,now-cycle);}}
function animate(time){if(!playing)return;const interval=reducedMotion.matches?250:33;if(time-lastDraw>=interval){draw();lastDraw=time;}frame=requestAnimationFrame(animate);}
new ResizeObserver(draw).observe(canvas);
function playbackControls(){play.hidden=playing&&!editDetails.open;play.textContent=playing?'↻ Apply':'▶ Play';}
function halt(){wanted=false;queued=false;clearTimeout(timer);repl?.stop();if(window.strudel)strudel.hush();playing=false;cancelAnimationFrame(frame);stop.disabled=true;play.disabled=false;playbackControls();status.textContent='Stopped.';canvas.dataset.playing='false';draw();}
async function apply(){
  queued=true;if(busy)return;busy=true;play.disabled=true;
  try{while(queued&&wanted){queued=false;globalThis.__keatingMusicControls=Object.freeze(Object.fromEntries(Object.entries(values)));const source=${JSON.stringify(MUSIC_CONTROLS_PRELUDE)}+editor.value;await repl.evaluate(source);if(!wanted){repl.stop();break;}if(repl.state.error)throw repl.state.error;playing=true;lastCycle=-1;stop.disabled=false;playbackControls();status.textContent=parameters.length?'Playing · sliders update the sound live.':'Playing.';canvas.dataset.playing='true';cancelAnimationFrame(frame);frame=requestAnimationFrame(animate);draw();}}
  catch(error){halt();status.textContent=String(error.message||error).slice(0,240);}
  finally{busy=false;play.disabled=false;}
}
play.addEventListener('click',async()=>{wanted=true;stop.disabled=false;play.disabled=true;status.textContent='Starting audio…';try{await strudel.getAudioContext().resume();await strudel.initAudio({disableWorklets:true});if(wanted)await apply();}catch(error){halt();status.textContent=String(error.message||error).slice(0,240);}});
stop.addEventListener('click',halt);
editDetails.addEventListener('toggle',()=>{playbackControls();reportSize();});
addEventListener('pagehide',halt);document.addEventListener('visibilitychange',()=>{if(document.hidden&&wanted)halt();});
addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='keating-music-stop')halt();});
async function prepare(){try{if(!window.strudel)throw new Error('Strudel could not load. Reopen this lab to try again.');repl=await strudel.initStrudel({editPattern:pattern=>scope?pattern.analyze(1):pattern});play.disabled=false;status.textContent='Press Play to explore.';draw();}catch(error){status.textContent=String(error.message||error).slice(0,240);}}
document.getElementById('visual-title').textContent=scope?'Waveform':'Pattern';
document.getElementById('note-data').hidden=scope;
canvas.setAttribute('aria-label',scope?'Oscilloscope of the actual Strudel audio output. Labeled amplitude scale adapts to the signal. Time is in milliseconds.':'Strudel note events in one cycle. Horizontal position is time; each row is a pitch. Note data is also available below.');
prepare();
})();
`;
