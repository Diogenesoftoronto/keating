import { expect,test } from 'bun:test';
import { checkRestart } from './check_restart';
import catalog from './data/openui-conversations.json';

test('contract feedback accepts different useful wording without grading pedagogy',async()=>{
  for(const content of ['One hour has 60 minutes, so 2.5 × 60 = 150 minutes.',
    'Think of equal-sized pieces. What happens to their total when you cut each in half?']) {
    const result=await checkRestart({response:{content},tools:[],expected:{}});
    expect(result.contract_passed).toBe(true);expect(result.teaching_quality).toBeNull();
  }
});
test('inline OpenUI accepts surrounding explanation but rejects corrupt source and empty output',async()=>{
  const original=catalog.conversations[0].messages.find(m=>m.content.includes('activity = Flashcards('))!;
  const good=await checkRestart({response:{content:'Try recalling these before you reveal them.\n\n'+original.content},tools:[],expected:{component:'deck'}});
  expect(good.contract_passed).toBe(true);
  for(const content of ['', '<openui-quiz questions="fake" />',original.content.replace('LearningSurface(', 'MissingComponent(')]) {
    expect((await checkRestart({response:{content},tools:[],expected:{component:'deck'}})).contract_passed).toBe(false);
  }
});
test('native grading identifiers come from the submission, while notes can vary',async()=>{
  const tools=[{function:{name:'grade_quiz',parameters:{type:'object',properties:{result_id:{type:'string'},grades:{type:'array',items:{type:'object'}}},required:['result_id','grades']}}}];
  const args={result_id:'submitted-123',grades:[{question_id:'q2',verdict:'incorrect',note:'Try separating the two quantities.'}]};
  const check=(a:any)=>checkRestart({response:{tool_calls:[{id:'c',function:{name:'grade_quiz',arguments:JSON.stringify(a)}}]},tools,expected:{tool:'grade_quiz',identifiers:{result_id:'submitted-123'},question_ids:['q2']}});
  expect((await check(args)).contract_passed).toBe(true);
  expect((await check({...args,result_id:'invented'})).contract_passed).toBe(false);
  expect((await check({...args,grades:[args.grades[0],args.grades[0]]})).contract_passed).toBe(false);
  expect((await check({})).contract_passed).toBe(false);
});
