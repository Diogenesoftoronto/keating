import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { estimateCost, presentMessage } from "../../web/public/reports/learning-to-teach/report.js";
import { compileMessage } from "../report-site/openui-preview";
const report = await Bun.file(new URL("../../web/public/reports/learning-to-teach/report-data.json",import.meta.url)).json();

test("chat prompt viewers resolve exact historical content rather than the later revision",()=>{
  for(const [digest,prompt] of Object.entries(report.system_prompts) as [string,any][]){
    expect(createHash('sha256').update(prompt.text).digest('hex')).toBe(digest);
    expect(Buffer.byteLength(prompt.text)).toBe(prompt.bytes);
  }
  const historical=report.three_arm.system_prompt_sha256;
  expect(report.system_prompts[historical]).toBeDefined();
  expect(report.conversation_system_prompt_sha256).toBe(historical);
  for(const arm of ['before','after','sdpo'])for(const trace of report.interaction_round[arm]){
    expect(trace.system_prompt_sha256).toBe(historical);
  }
  expect(report.later_system_prompt_sha256).not.toBe(historical);
  expect(report.system_prompts[report.later_system_prompt_sha256].label).toContain('not used');
});

test("cache scenarios apply the discount once and affect only prefill",()=>{
  const cold=estimateCost(report.cost,0), warm=estimateCost(report.cost,100);
  expect(cold.total).toBeCloseTo(report.cost.cache_scenarios[0].token_total_usd,8);
  expect(warm.total).toBeCloseTo(report.cost.cache_scenarios.at(-1).token_total_usd,8);
  expect(cold.train).toBe(warm.train);
  expect(cold.output).toBe(warm.output);
  expect(estimateCost(report.cost,50).total).toBeCloseTo((cold.total+warm.total)/2,8);
});

test("every conversation message has a readable explorer representation",()=>{
  for(const conversation of report.conversations)for(const message of conversation.messages){
    const presented=presentMessage(message);
    expect(typeof presented.content).toBe("string");
    expect(presented.content.length).toBeGreaterThan(0);
  }
});


test("report previews compile every authored OpenUI message with the shared contract",()=>{
  const types=new Set<string>();
  for(const c of report.conversations)for(const [i,m] of c.messages.entries()){
    if(m.role==='assistant'&&m.content.startsWith('```openui')){
      const docs=compileMessage(m.content,`${c.id}-${i}`);expect(docs.length).toBe(1);
      for(const n of docs[0].nodes)types.add(n.type);
    }
  }
  for(const type of ['deck','quiz','question-group','simulation','notes'])expect(types.has(type)).toBe(true);
});


test("three-arm report preserves every predeclared scenario and shared learner input",()=>{
  const comparison=report.three_arm;
  expect(comparison.traces.length).toBe(comparison.scenarios.length*3);
  for(const scenario of comparison.scenarios)for(const arm of comparison.arms){
    const trace=comparison.traces.find(t=>t.scenario===scenario.id&&t.arm===arm);
    expect(trace).toBeDefined();expect(trace.error_type).toBeUndefined();
    expect(trace.messages.filter(m=>m.role==='user').map(m=>m.content)).toEqual(scenario.turns);
    expect(trace.messages.filter(m=>m.role==='assistant').length).toBe(scenario.turns.length);
  }
});

test("interaction comparison preserves failures and excludes evaluation families from SDPO",async()=>{
  const round=report.interaction_round;
  const training=await Bun.file(new URL('./data/interaction-sdpo.json',import.meta.url)).json();
  const families=new Set(training.cases.map(c=>c.family));
  expect(round.cases.length).toBe(7);
  for(const scenario of round.cases){
    expect(families.has(scenario.family)).toBe(false);
    for(const arm of ['before','after','sdpo']){
      const trace=round[arm].find(t=>t.scenario.id===scenario.id);
      expect(trace.messages[0].content).toBe(scenario.prompt);
      expect(trace.passed).toBe(trace.creation.passed&&(trace.grading?.passed??true));
      expect(trace.creation.feedback.length).toBeGreaterThan(0);
      if(trace.creation.passed&&scenario.component){
        expect(compileMessage(trace.messages[1].content,`${arm}-${scenario.id}`).length).toBe(1);
      }
    }
  }
  for(const arm of ['before','after','sdpo']){
    expect(round[arm].length).toBe(round.cases.length);
    expect(round[arm+'_passed']).toBe(round[arm].filter(t=>t.passed).length);
  }
  expect(round.training_rollouts.creation_passes).toBe(0);
});
