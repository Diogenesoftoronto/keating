import {expect,test} from 'bun:test';
import {check} from './interaction_check';
const catalog=await Bun.file(new URL('./data/openui-conversations.json',import.meta.url)).json();
test('authored activities compile, submit and grade actual canonical IDs',async()=>{
 for(const kind of ['quiz','flashcards','question','simulation','exam']){
  const component=({quiz:'Quiz',flashcards:'Flashcards',question:'Question',simulation:'Simulation',exam:'Exam'} as any)[kind];
  const convo=catalog.conversations.find((c:any)=>c.messages.some((m:any)=>m.role==='assistant'&&m.content.includes(`= ${component}(`)));
  const response=convo.messages.find((m:any)=>m.role==='assistant'&&m.content.includes(`= ${component}(`));
  const scenario={id:`probe-${kind}`,kind,component,count:kind==='exam'?20:4,topic:'Equivalent fractions'};
  const result:any=await check({scenario,response});expect(result.passed).toBe(true);
  if(result.expected_grading){
   const g=result.expected_grading;
   const args=g.name==='grade_quiz'?{result_id:g.result_id,grades:g.question_ids.map((id:string)=>({question_id:id,verdict:'incorrect'}))}:{topic:g.topic,results:[{question:g.checks[0].question,verdict:'incorrect'}]};
   const grading={content:'',tool_calls:[{id:'grading',function:{name:g.name,arguments:JSON.stringify(args)}}]};
   const executed:any=await check({scenario,response:grading,expected_grading:g});expect(executed.passed).toBe(true);expect(executed.tools_executed).toBe(1);
   if(g.name==='grade_quiz')args.result_id='unrelated';else args.results[0].question='Unsubmitted question';
   grading.tool_calls[0].function.arguments=JSON.stringify(args);
   expect((await check({scenario,response:grading,expected_grading:g})).passed).toBe(false);
  }
 }
});
test('legacy creation calls and source announcements do not pass as OpenUI',async()=>{
 const scenario={id:'quiz',kind:'quiz',component:'Quiz',count:4};
 for(const response of [{content:'Quiz ready.'},{content:'',tool_calls:[{function:{name:'quiz',arguments:'{}'}}]}])expect((await check({scenario,response})).passed).toBe(false);
});
