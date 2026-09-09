/** Isolated report controls over Keating's canonical compiled data; no backend or persistence. */
import { compileOpenUISourceToSharedDocument } from "../../packages/learner-contracts/src/openui-source";
import { parseSimulationExpression, evaluateSimulationExpression } from "../../packages/learner-contracts/src/simulation-expression";
import { parseOpenUIMessageSegments } from "../../web/src/keating/openui/segments";
import { objectiveCredit } from "../../web/src/keating/openui/quiz-progress";

export function compileMessage(source:string,id:string) {
  return parseOpenUIMessageSegments(source,id).filter(s=>s.type==='openui').map(s=>{
    if(s.format!=='source'||!s.complete)throw Error('Incomplete OpenUI source');
    return compileOpenUISourceToSharedDocument(s.program,{documentId:s.metadata.id,retention:s.metadata.lifecycle,createdAt:'2026-09-06T20:00:00.000Z',updatedAt:'2026-09-06T20:00:00.000Z'});
  });
}
function el(tag:string,text='',cls='') {const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;}
function button(text:string,fn:()=>void) {const b=el('button',text) as HTMLButtonElement;b.type='button';b.addEventListener('click',fn);return b;}
function question(q:any,onChange:(answer:string)=>void) {
  const box=el('fieldset');box.append(el('legend',q.prompt));
  if(q.choices?.length){
    for(const option of q.choices){const label=el('label','', 'preview-choice');const input=document.createElement('input');input.type='radio';input.name=`preview-${q.id}`;input.value=option.id;input.addEventListener('change',()=>onChange(option.id));label.append(input,document.createTextNode(option.label));box.append(label);}
  }
  if(!q.choices?.length||q.allowText){const label=el('label','Your reasoning');const input=document.createElement('textarea');input.rows=3;input.addEventListener('input',()=>onChange(input.value));label.append(input);box.append(label);}
  return box;
}
function renderNode(host:HTMLElement,n:any) {
  const box=el('section','','preview-activity');host.append(box);
  if(n.type==='deck'){
    let index=0,revealed=false;const ratings:number[]=[];
    const draw=()=>{box.replaceChildren(el('h4',n.title));if(index===n.cards.length){box.append(el('p',`${index} cards reviewed · ${ratings.filter(r=>r===0).length} difficult recalls`),el('p','This was a local report preview. It does not establish mastery.'),button('Review again',()=>{index=0;ratings.length=0;draw();}));return;}
      box.append(el('p',`Card ${index+1} of ${n.cards.length}`,'preview-progress'));
      const card=button(revealed?n.cards[index].back:n.cards[index].front,()=>{revealed=!revealed;draw();});card.className='preview-flashcard';card.setAttribute('aria-label',`${revealed?'Answer':'Recall prompt'}: ${card.textContent}. ${revealed?'Hide':'Reveal'} answer`);box.append(card,el('p',revealed?'How well did you recall it?':'Recall your answer, then tap the card.'));
      const controls=el('div','','preview-controls');['Again','Hard','Good','Easy'].forEach((label,r)=>{const b=button(label,()=>{ratings.push(r);index++;revealed=false;draw();});b.disabled=!revealed;controls.append(b);});box.append(controls);
    };draw();return;
  }
  if(n.type==='quiz'){
    let index=0;const answers:Record<string,string>={};const exam=n.mode==='exam';
    const draw=()=>{box.replaceChildren(el('h4',n.title),el('p',`${exam?'Exam':'Quiz'} · ${n.questions.length} questions${exam?' · untimed report preview':''}`,'preview-progress'));
      const q=n.questions[index];const next=button(index===n.questions.length-1?'Submit preview':'Next question',()=>{if(index<n.questions.length-1){index++;draw();}else results();});next.disabled=!answers[q.id]?.trim();
      const field=question(q,value=>{answers[q.id]=value;next.disabled=!value.trim();});
      field.querySelectorAll('input').forEach(input=>{input.checked=input.value===answers[q.id];});const text=field.querySelector('textarea');if(text)text.value=answers[q.id]??'';
      box.append(el('p',`${index+1} / ${n.questions.length}`),field);
      const controls=el('div','','preview-controls');const prev=button('Previous',()=>{index--;draw();});prev.disabled=index===0;controls.append(prev,next);box.append(controls);
    };
    const results=()=>{box.replaceChildren(el('h4','Preview submitted'));let scored=0,total=0,pending=0;
      for(const q of n.questions){const credit=objectiveCredit(q,answers[q.id]??'');if(credit===undefined)pending++;else{total++;scored+=credit;}const row=el('details');row.append(el('summary',`${q.prompt} — ${credit===undefined?'Needs tutor grading':credit===1?'Correct':'Review'}`));const mine=q.choices?.find((o:any)=>o.id===answers[q.id])?.label??answers[q.id];const ref=q.choices?.find((o:any)=>o.id===q.correctAnswer)?.label??q.correctAnswer;row.append(el('p',`Your answer: ${mine}`),el('p',`Reference: ${ref}`),el('p',q.explanation??''));box.append(row);}
      box.prepend(el('p',`${scored} / ${total} objective points · ${pending} open-ended answers need tutor grading. No model is called in this preview.`));box.append(button('Try again',()=>{index=0;Object.keys(answers).forEach(k=>delete answers[k]);draw();}));
    };draw();return;
  }
  if(n.type==='question-group'||n.type==='question'){
    box.append(el('h4',n.title??'Think it through'));const questions=n.type==='question-group'?n.questions:[n];const answers:Record<string,string>={};const submit=button('Submit preview',()=>{box.replaceChildren(el('h4','Your response'),...questions.map((q:any)=>el('p',q.choices?.find((o:any)=>o.id===answers[q.id])?.label??answers[q.id])),el('p','Response stays in this preview. Use Next message to read the authored learner response.'));});submit.disabled=true;
    questions.forEach((q:any)=>box.append(question(q,value=>{answers[q.id]=value;submit.disabled=questions.some((x:any)=>!answers[x.id]?.trim());})));box.append(submit);return;
  }
  if(n.type==='simulation'){
    box.append(el('h4',n.title),el('p',n.brief??''));const values=Object.fromEntries(n.parameters.map((p:any)=>[p.id,p.value]));const outputs=el('div','','preview-readouts');
    const update=()=>{outputs.replaceChildren();for(const r of n.readouts){const parsed=parseSimulationExpression(r.expr,Object.keys(values));const value=parsed.ok?evaluateSimulationExpression(parsed.node,values):undefined;outputs.append(el('p',`${r.label}: ${value===undefined?'No value':value.toFixed(r.precision??0)} ${r.unit??''}`));}};
    for(const p of n.parameters){const label=el('label',p.label);const input=document.createElement('input');const value=el('output',String(p.value));input.type='range';input.min=String(p.min);input.max=String(p.max);input.step=String(p.step);input.value=String(p.value);input.addEventListener('input',()=>{values[p.id]=Number(input.value);value.textContent=input.value;update();});label.append(value,input);box.append(label);}box.append(outputs);update();return;
  }
  if(n.type==='notes'){box.append(el('h4',n.title));const label=el('label','Your notes');const text=document.createElement('textarea');text.rows=9;text.value=n.value??'';text.placeholder=n.placeholder??'';label.append(text);box.append(label);return;}
  box.append(el('h4',n.title??n.type),el('p',n.body??n.text??'This component is available as source; this report does not implement its controls.'));
}
export function renderPreview(host:HTMLElement,source:string,id:string) {
  host.replaceChildren();
  try{const documents=compileMessage(source,id);if(!documents.length)return false;
    host.append(el('p','Interactive report preview · inputs stay here; no model request or saved learner progress.','preview-notice'));
    for(const doc of documents)for(const n of doc.nodes)renderNode(host,n);
    return true;
  }catch{host.append(el('p','This OpenUI output did not compile. Its original source is preserved below.'));return true;}
}
