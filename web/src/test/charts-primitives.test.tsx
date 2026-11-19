import { expect, test } from "bun:test";
import { renderToStaticMarkup as html } from "react-dom/server";
import * as C from "../design-system/charts";
import { Meter as KitMeter } from "../design-system/kit";
const data = [{label:"Quiz",value:4},{label:"Review",value:0}];
test("legacy Meter keeps the div, clamped value, tone, fill transform, ref-compatible attributes and class hooks", () => {
  expect(KitMeter).toBe(C.Meter);
  const out = html(<KitMeter className="custom" data-id="score" label="Score" value={200} max={100} tone="series3"/>);
  for (const part of ['<div data-id="score"', 'k-meter k-series3', 'custom','role="meter"', 'aria-label="Score"', 'aria-valuenow="100"', '<span','scaleX(1)']) expect(out).toContain(part);
  expect(html(<C.Meter value={NaN} max={0}/>)).toContain('aria-valuetext="0 of 1"');
  expect(html(<C.Meter value={2} max={4} threshold={{value:3,label:"Pass"}}/>)).toContain('aria-label="2 of 4, Pass 3"');
  expect(html(<C.Meter max={100} indeterminate/>)).not.toContain("aria-valuenow");
});
test("steps preserve counts at zero, twelve and thirteen", () => {
  for (const total of [0,12,13]) {
    const out = html(<C.Progress done={0} total={total}/>);
    expect(out).toContain(`aria-label="0 of ${total}"`);
    expect(out.match(/data-step=/g)?.length ?? 0).toBe(total===12 ? 12 : 0);
    expect(out.includes("k-meter k-ink")).toBe(total===13);
  }
});
test("clock says the strict quarter and tenth thresholds", () => {
  for (const [s,end] of [[25,""],[24," · Warning"],[10," · Warning"],[9," · Critical"],[0," · Critical"]] as const)
    expect(html(<C.Countdown remaining={s} total={100}/>)).toContain(`aria-label="${s} s left${end}"`);
});
test("ranked bars, segments and legend expose the same values, including zero", () => {
  const out = html(<C.StackBar data={data} selected="Review" onSelect={()=>{}}/>);
  expect(out).toContain('aria-label="Quiz 4, Review 0"');
  expect(out.match(/data-kc-enter="grow"/g)).toHaveLength(1);
  expect(out).toContain('aria-pressed="true"');
  expect(html(<C.Legend entries={data}/>)).toContain('aria-label="Quiz 4, Review 0"');
  expect(html(<C.BarList data={[...data].reverse()}/>)).toContain('aria-label="Quiz 4, Review 0"');
  const four = [...data,...data];
  expect(()=>html(<C.StackBar data={four}/>)).toThrow(RangeError);
  expect(()=>html(<C.LineChart series={four.map(d=>({...d,points:[]}))}/>)).toThrow(RangeError);
});
test("range, samples, grids and timeline describe their data", () => {
  expect(html(<C.IntervalPlot data={[{label:"A",value:7,range:[5,9]},{label:"B",value:3}]} band={[6,8]}/>)).toContain('aria-label="A 7, range 5 to 9, B 3, Too few signals, Leader range 6 to 8"');
  const samples=html(<C.LineChart connect={false} series={[{label:"Policy",points:[{x:3,y:8},{x:1,y:4}]}]}/>);
  expect(samples).toContain('aria-label="Policy 1 4, Policy 3 8"');
  expect(samples).not.toContain("<polyline");
  expect(html(<C.HeatGrid data={data}/>)).toContain('aria-label="Quiz 4, Review 0"');
  expect(html(<C.StateGrid states={{ok:"Passed",bad:"Failed",warn:"Partial"}} data={[{label:"Evidence",state:"warn"}]}/>)).toContain('aria-label="Evidence Partial"');
  expect(html(<C.Timeline lanes={[{label:"Draft",bands:[{label:"Checks",start:1,end:3,waiting:true}]}]}/>)).toContain('aria-label="Draft Checks 1 3 Waiting"');
});
test("disclosures are native tables with the plotted values in drawing order", () => {
  const rows = ["A","B","C","D"].map((label,value)=>({label,value}));
  const out = html(<C.BarList data={rows}/>);
  expect(out).toContain('<summary>View as table</summary>');
  for (const d of rows) expect(out).toContain('<th scope="row">'+d.label+'</th><td>'+d.value+'</td>');
  expect(html(<C.ChartTable columns={["Task","Count"]} rows={[["Review",0]]}/>)).toContain("<caption>Review 0</caption>");
});
test("frame, stat and tooltip supply their accessible readings", () => {
  expect(html(<C.ChartFrame title="Policy" reading="Score 71" scope="All time">71</C.ChartFrame>)).toContain('aria-label="Policy, All time, Score 71"');
  expect(html(<C.Stat label="Runs" value={0}/>)).toContain('aria-label="Runs 0"');
  expect(html(<C.ChartTooltip text="Score 71" x={0} y={0} above={false} id="tip"/>)).toContain('>Score 71</div>');
});
test("empty collections have a reading and never draw a nonfinite coordinate", () => {
  for (const chart of [<C.BarList data={[]}/>,<C.StackBar data={[]}/>,<C.IntervalPlot data={[]}/>,<C.LineChart series={[]}/>,<C.HeatGrid data={[]}/>,<C.StateGrid data={[]} states={{ok:"Passed",warn:"Partial",bad:"Failed"}}/>,<C.Timeline lanes={[]}/>]) {
    const out=html(chart);
    expect(out).toContain('aria-label="No data"');
    expect(out).not.toMatch(/NaN|Infinity/);
  }
});
