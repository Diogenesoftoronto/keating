import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { benchmarkReviewScores, benchmarkReviewView, benchmarkReviewCoverage, benchmarkStoryCounts } from '../../web/public/reports/learning-to-teach/report.js';
const root = resolve(import.meta.dir, '../..');
const suite = resolve(root, 'scripts/training/benchmarks/teaching-v2');
const read = (name: string) => JSON.parse(readFileSync(name, 'utf8'));
const report = read(resolve(root, 'web/public/reports/learning-to-teach/report-data.json'));

test('published v2 retains the frozen authored definition and all planned model cases', () => {
  const data = report.benchmark_v2;
  expect(data).toBeDefined();
  const manifest = read(resolve(suite, 'manifest.json'));
  expect(data.manifest).toEqual(manifest);
  for (const [name, hash] of Object.entries(manifest.files)) {
    expect(createHash('sha256').update(readFileSync(resolve(suite, name))).digest('hex')).toBe(hash);
  }
  expect(data.cases).toEqual(read(resolve(suite, 'cases.json')).cases);
  expect(data.context).toEqual(read(resolve(suite, 'context.json')));
  expect(data.models).toHaveLength(15);
  const ids = data.cases.map((c: {id:string}) => c.id).sort();
  expect(ids).toHaveLength(48);
  for (const model of data.models) {
    expect(model.status).toBe('complete');
    expect(model.rows.map((r: {case_id:string}) => r.case_id).sort()).toEqual(ids);
    expect(model.model.toLowerCase()).not.toMatch(/claude|gemini/);
  }
  expect(data.judge_summary.human_ratings).toBeNull();
});

test('published v2 separates missing evidence, observed failures and whole-episode costs', () => {
  const data = report.benchmark_v2;
  expect(data).toBeDefined();
  for (const model of data.models) for (const row of model.rows) {
    if (row.stop !== 'final_response') expect(row.quality).toBeNull();
    if (['provider_error','harness_error'].includes(row.stop)) expect(row.contract_passed).toBeNull();
    if (['truncated','turn_limit'].includes(row.stop) && row.measurement_status === 'collected') expect(row.contract_passed).toBe(false);
    const costs = row.calls.map((call: {cost_usd:number|null}) => call.cost_usd);
    expect(row.known_cost_usd).toBeCloseTo(costs.reduce((a:number,b:number|null) => a+(b ?? 0),0), 10);
    if (costs.some((cost:number|null) => cost === null)) expect(row.cost_usd).toBeNull();
    else expect(row.cost_usd).toBeCloseTo(row.known_cost_usd,10);
    if (row.quality !== null) {
      if (row.quality_source === 'codex-subagent') {
        expect(row.quality_api).toBeNull();
        expect(row.supplemental_review).toBeDefined();
        expect(row.quality).toBe(row.quality_supplemental);
      } else expect(row.review.status).toBe('reviewed');
      expect(row.quality).toBeGreaterThanOrEqual(0); expect(row.quality).toBeLessThanOrEqual(100);
    }
  }
  expect(JSON.stringify(data)).not.toMatch(/tinker:\/\/|"key_file"|"api_key"|"owner_did"|"sampler_path"/);
});

test('review source filtering preserves original evidence and never invents missing API scores', () => {
  const apiReview = {status:'reviewed',ratings:[{score:0}]};
  const supplement = {reviewer_kind:'codex_subagent',ratings:[{score:2}]};
  const benchmark = {case_count:3,models:[{id:'one',label:'One',rows:[
    {case_id:'a',quality:0,quality_api:0,quality_supplemental:null,review:apiReview,contract_passed:true,cost_usd:0.1},
    {case_id:'b',quality:100,quality_api:null,quality_supplemental:100,review:{status:'error'},supplemental_review:supplement,contract_passed:false,cost_usd:0.2},
    {case_id:'c',quality:null,quality_api:null,quality_supplemental:null,contract_passed:null,cost_usd:null},
  ]}]};
  const before = JSON.stringify(benchmark);
  expect(benchmarkReviewView(benchmark,'api').models[0].rows.map(row=>row.quality)).toEqual([0,null,null]);
  expect(benchmarkReviewView(benchmark,'supplemental').models[0].rows.map(row=>row.quality)).toEqual([null,100,null]);
  const combined = benchmarkReviewView(benchmark,'combined');
  expect(combined.models[0].rows.map(row=>row.quality)).toEqual([0,100,null]);
  expect(combined.models[0].rows[0].review).toBe(apiReview);
  expect(combined.models[0].rows[1].supplemental_review).toBe(supplement);
  expect(combined.models[0].rows.map(row=>[row.contract_passed,row.cost_usd])).toEqual([[true,0.1],[false,0.2],[null,null]]);
  expect(JSON.stringify(benchmark)).toBe(before);
  expect(benchmarkReviewCoverage(benchmark)).toEqual([{id:'one',label:'One',api:1,supplemental:1,combined:2,planned:3,supplemental_fraction:0.5}]);
});

test('legacy exports and unavailable review sources remain usable without mechanical substitution', () => {
  expect(benchmarkReviewScores({quality:0})).toEqual({api:0,supplemental:null,combined:0});
  expect(benchmarkReviewScores({quality:95,quality_source:'codex-subagent'})).toEqual({api:null,supplemental:null,combined:null});
  expect(benchmarkReviewScores({quality:NaN,quality_supplemental:101})).toEqual({api:null,supplemental:null,combined:null});
  const legacy = {case_count:2,models:[{id:'one',label:'One',rows:[{quality:75,contract_passed:true},{quality:null,contract_passed:false}]}]};
  const unavailable = benchmarkReviewView(legacy,'supplemental');
  expect(unavailable.quality_available).toBe(false);
  expect(unavailable.models[0].rows.map(row=>row.quality)).toEqual([null,null]);
  expect(benchmarkReviewCoverage({case_count:2,models:[{id:'empty',label:'Empty',rows:[]}]})[0]).toEqual({id:'empty',label:'Empty',api:0,supplemental:0,combined:0,planned:2,supplemental_fraction:null});
  expect(()=>benchmarkReviewView(legacy,'unknown')).toThrow('Unknown review source');
});


test('chapter summaries distinguish checked coverage, ceiling and AI review coverage', () => {
  const data = { benchmark: { results: { case_ids: ['a','b'], arms: [
    {summary:{contracts:{passed:2,checked:2}}},
    {summary:{contracts:{passed:1,checked:2}}},
    {summary:{contracts:{passed:1,checked:1}}},
    {summary:{contracts:{passed:0,checked:0}}},
  ] } }, benchmark_v2: {case_count:2,models:[{id:'one',label:'One',rows:[
    {quality_api:0,quality_supplemental:null},
    {quality_api:null,quality_supplemental:50},
  ]},{id:'missing',label:'Missing',rows:[]}]}};
  expect(benchmarkStoryCounts(data)).toEqual({v1:{cases:2,arms:4,fully_checked:2,ceiling:1},v2:{cases:2,models:2,reviewed:2,planned:4}});
  expect(benchmarkStoryCounts({})).toEqual({v1:{cases:0,arms:0,fully_checked:0,ceiling:0},v2:null});
  const live = benchmarkStoryCounts(report);
  expect(live.v1.ceiling).toBe(1);
  expect(live.v2?.reviewed).toBe(benchmarkReviewCoverage(report.benchmark_v2).reduce((n,model)=>n+model.combined,0));
});

test('chronological chapters keep deep-link controls and public packaging hooks', () => {
  const html = readFileSync(resolve(root,'web/public/reports/learning-to-teach/index.html'),'utf8');
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g),match=>match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  const chapters = ['training','benchmark','benchmark-v2','benchmark-v3-0','benchmark-v3-1','benchmark-v3'];
  const positions = chapters.map(id=>html.indexOf(`id="${id}"`));
  expect(positions.every((position,index)=>position>=0 && (!index || position>positions[index-1]))).toBe(true);
  for (const id of chapters) expect(html).toContain(`href="#${id}"`);
  for (const id of ['probe','interaction-case','conversation','benchmark-case','benchmark-v2-charts','benchmark-v2-trace','later-prompt-viewer','benchmark-v3-explorer','benchmark-v3-results']) expect(ids).toContain(id);
  expect(html.indexOf('id="benchmark-v3-results"')).toBeGreaterThan(html.indexOf('id="benchmark-v3"'));
  expect(html.indexOf('id="benchmark-v3-explorer"')).toBeGreaterThan(html.indexOf('id="benchmark-v3"'));
  expect(html).toContain('src="./benchmark-v3-results.js"');
  expect(html).toContain('href="./benchmark-v3-results.css"');
  for (const hook of ['class="wordmark" href="/"','href="http://127.0.0.1:3001/">Open local Keating ↗','Local services must be running. Checkpoints have a 24-hour TTL. Browser click-through was not verified.']) expect(html).toContain(hook);
});
