/** Execute canonical activity submissions in memory; never calls external tools. */
import { compileOpenUISourceToSharedDocument, validateUiDocument } from '../../packages/learner-contracts/src/index.js';
import { parseOpenUIMessageSegments } from '../../web/src/keating/openui/segments';
import { dispatchSharedUiAction } from '../../web/src/keating/openui/shared-actions';
import { createOpenUIActionLearnerResponse, createQuestionLearnerResponse, serializeLearnerResponse } from '../../web/src/keating/learner-response';
import { applyReview, initialSrsState } from '../../web/src/keating/srs';
import { objectiveCredit } from '../../web/src/keating/openui/quiz-progress';
import { createAssessmentTools } from '../../web/src/keating/browser-tools/assessment';
import { parseSimulationExpression, evaluateSimulationExpression } from '../../packages/learner-contracts/src/simulation-expression';
const AT='2026-09-07T05:00:00.000Z';
export async function check(input:any) {
 const {scenario,response}=input;const content=response.content??'';const calls=response.tool_calls??[];
 const fail=(feedback:string)=>({passed:false,feedback,feedback_source:'fresh-response-contract-check',tools_executed:0});
 if(input.expected_grading){
  const expected=input.expected_grading;const checks=expected.checks??[];
  const storage={getQuestionChecks:async()=>checks,gradeQuestionCheck:async(id:string,grade:any)=>{const row=checks.find((q:any)=>q.id===id);if(!row)throw Error('Unknown check');Object.assign(row,grade);}} as any;
  const available=createAssessmentTools(storage,async()=>[]);const tool_results=[];
  if(calls.length!==1||calls[0].function.name!==expected.name)return fail(`The submitted activity requires exactly one ${expected.name} call. Do not grade unsubmitted work or create a replacement activity.`);
  const call=calls[0];const args=typeof call.function.arguments==='string'?JSON.parse(call.function.arguments):call.function.arguments;
  if(expected.name==='grade_quiz'){
   if(args.result_id!==expected.result_id)return fail('Use the resultId from this actual quiz submission.');
   if(!Array.isArray(args.grades)||args.grades.length!==expected.question_ids.length||new Set(args.grades.map((g:any)=>g.question_id)).size!==expected.question_ids.length||args.grades.some((g:any)=>!expected.question_ids.includes(g.question_id)||g.verdict!=='incorrect'))return fail('Grade each submitted open-ended answer once, using its exact question id. The learner answered “I do not know yet”; do not mark that correct or grade objective items.');
  }else if(args.topic!==expected.topic||!Array.isArray(args.results)||args.results.length!==1||args.results[0].question!==checks[0].question||args.results[0].verdict!=='incorrect')return fail('Record the pending diagnostic answer under its exact topic and question. “I do not know yet” does not demonstrate a correct answer.');
  const result=await (available.find(t=>t.name===expected.name)!.execute as any)(call.id??'eval-call',args);
  tool_results.push({role:'tool',tool_call_id:call.id??'eval-call',name:expected.name,content:result.content.map((c:any)=>c.text??'').join('\n')});
  return {passed:true,feedback:'The grading call matched the actual submitted IDs, graded only pending work, and executed successfully in isolated memory.',feedback_source:'fresh-tool-execution',tools_executed:1,tool_results};
 }
 if(scenario.kind==='identity')return {passed:!calls.length&&/latest version of keating bot/i.test(content),feedback:'The identity target is latest version of Keating Bot; preserve this while learning interactions.',feedback_source:'identity-check',tools_executed:0};
 if(scenario.kind==='arithmetic')return {passed:!calls.length&&/\b56\b/.test(content),feedback:'7 times 8 is 56.',feedback_source:'arithmetic-check',tools_executed:0};
 if(calls.length)return fail(`This request requires inline OpenUI ${scenario.component}, not a native creation tool. Returned calls: ${calls.map((c:any)=>c.function.name).join(', ')}.`);
 const segments=parseOpenUIMessageSegments(content,scenario.id);const surfaces=segments.filter(s=>s.type==='openui');
 if(surfaces.length!==1)return fail(`Return one complete OpenUI surface containing ${scenario.component}; the current response contains ${surfaces.length} recognized surfaces.`);
 const s=surfaces[0];if(!s.complete)return fail('The OpenUI fence is incomplete. Close it and keep the activity concise enough for the output limit.');
 let document:any;
 try{document=s.format==='source'?compileOpenUISourceToSharedDocument(s.program,{documentId:s.metadata.id,createdAt:AT,updatedAt:AT}):s.document;if(!validateUiDocument(document))throw Error('Invalid canonical document');}catch(error){return fail(`Keating could not compile this response: ${(error as Error).message}. Use the exact current component argument order and plain object arrays; do not invent constructor helpers.`);}
 const type=scenario.kind==='flashcards'?'deck':scenario.kind==='exam'?'quiz':scenario.kind==='question'?'question-group':scenario.kind;
 const node=document.nodes.find((n:any)=>n.type===type||(scenario.kind==='question'&&n.type==='question'));
 if(!node)return fail(`The compiled document lacks the requested ${scenario.component} activity.`);
 if(scenario.kind==='exam'&&node.mode!=='exam')return fail('An exam must use Exam with at least twenty questions, not an ordinary Quiz.');
 if(scenario.kind==='quiz'&&node.mode==='exam')return fail('This request is a short practice Quiz, not an Exam.');
 if(['quiz','exam'].includes(scenario.kind)&&node.questions.length!==scenario.count)return fail(`The learner requested ${scenario.count} questions; this response contains ${node.questions.length}.`);
 if(scenario.kind==='flashcards'&&node.cards.length!==scenario.count)return fail(`The learner requested ${scenario.count} cards; this response contains ${node.cards.length}.`);
 if(['quiz','exam','flashcards'].includes(scenario.kind)&&document.retention!=='resumable')return fail('Use the resumable lifecycle for this activity so it can be continued later.');
 if(scenario.kind==='question'&&(node.type==='question-group'?node.questions.length:1)!==1)return fail('Ask one focused diagnostic question and wait.');
 const memory=new Map<string,string>();
 const result:any={passed:true,feedback:'The requested activity compiled through Keating’s current contract.',feedback_source:'fresh-response-contract-and-action-check',tools_executed:0,document};
 function submit(intent:any,message:string){const dispatched=dispatchSharedUiAction({getItem:k=>memory.get(k)??null,setItem:(k,v)=>{memory.set(k,v);}},document,intent,AT);const {schemaVersion,documentId,documentRevision,idempotencyKey,...params}=dispatched.action;result.followup={role:'user',content:serializeLearnerResponse(createOpenUIActionLearnerResponse({kind:'canonical',type:dispatched.action.type,humanFriendlyMessage:message,params,document:{id:document.id,lifecycle:document.retention,revision:document.revision},action:dispatched.action,sourceDocument:dispatched.sourceDocument,receipt:dispatched.receipt},{id:`${scenario.id}-submission`,submittedAt:AT}))};result.action_executed=true;}
 if(scenario.kind==='flashcards'){
  const ratings=node.cards.map((c:any,i:number)=>{const rating=i<2?0:2;const outcome=applyReview(initialSrsState(Date.parse(AT)),rating,Date.parse(AT));return {cardId:c.id,rating,appliedIntervalDays:outcome.appliedIntervalDays,easeAfter:outcome.next.ease};});
  submit({type:'complete-deck',nodeId:node.id,ratings,summary:{reviewed:ratings.length,lapses:2}},'I reviewed the cards and struggled with two.');
 }else if(scenario.kind==='quiz'){
  const credits:Record<string,number>={};const pending:string[]=[];
  const answers=node.questions.map((q:any)=>{const probe=objectiveCredit(q,q.correctAnswer??'');const answer=probe===undefined?'I do not know yet.':q.correctAnswer??'';if(probe===undefined)pending.push(q.id);else credits[q.id]=objectiveCredit(q,answer)??0;return {questionId:q.id,answer};});
  const points=Object.values(credits).reduce((a,b)=>a+b,0);const resultId=`${node.id}-result`;
  submit({type:'complete-quiz',nodeId:node.id,resultId,answers,score:Object.values(credits).filter(v=>v===1).length,partialCreditPoints:points,partialCredits:credits,pendingGradeQuestionIds:pending,flaggedQuestionIds:[],skippedQuestionIds:[],timing:{totalMs:60000,perQuestionMs:Object.fromEntries(node.questions.map((q:any)=>[q.id,60000/node.questions.length]))}},'I submitted. Please grade the open-ended answers.');
  if(!pending.length)return fail('The requested mixed quiz must include an open-ended answer for tutor grading.');
  result.expected_grading={name:'grade_quiz',result_id:resultId,question_ids:pending};
 }else if(scenario.kind==='question'){
  const q=node.type==='question-group'?node.questions[0]:node;
  result.followup={role:'user',content:serializeLearnerResponse(createQuestionLearnerResponse({topic:scenario.topic,source:'openui',answers:[{header:'My reasoning',question:q.prompt,answer:'I do not know yet.',grading:'pending'}]},{id:`${scenario.id}-check`,submittedAt:AT}))};
  result.expected_grading={name:'grade_question_checks',topic:scenario.topic,checks:[{id:`${scenario.id}-check`,topic:scenario.topic,question:q.prompt,grading:'pending',createdAt:Date.parse(AT)}]};
 }else if(scenario.kind==='simulation'){
  if(!node.parameters.length||!node.readouts.length)return fail('The simulation needs a control and a computed readout.');
  for(const r of node.readouts){const parsed=parseSimulationExpression(r.expr,node.parameters.map((p:any)=>p.id));if(!parsed.ok)return fail('The readout expression does not parse.');for(const edge of ['min','max']){const value=evaluateSimulationExpression(parsed.node,Object.fromEntries(node.parameters.map((p:any)=>[p.id,p[edge]])));if(value===undefined)return fail('The simulation readout is not finite at a parameter boundary.');}}
  result.expression_boundaries_checked=true;
 }
 return result;
}
if(import.meta.main){try{const output=await check(await Bun.file(process.argv[2]).json());await Bun.write(process.argv[3],JSON.stringify(output,null,2));}catch(e){await Bun.write(process.argv[3],JSON.stringify({passed:false,feedback:`Validation/execution rejected this response: ${(e as Error).message}`,feedback_source:'fresh-response-contract-check',tools_executed:0}));}}
