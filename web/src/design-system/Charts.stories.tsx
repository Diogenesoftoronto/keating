import { useEffect, useState } from "react";
import type { Meta } from "@storybook/react-vite";
import * as C from "./charts";
import "./kit/kit.css";

export default {title:"Design System/Charts",parameters:{layout:"padded"}} satisfies Meta;
const feedback = [{label:"Confident",value:41},{label:"Confused",value:12,pattern:true},{label:"Off-track",value:5}];
const sessions = Array.from({length:28},(_,i) => ({label:"April "+(i+1),value:[0,1,0,2,1,3,4,0,0][i%9]}));
const checks = [{label:"Citations",state:"ok"},{label:"Rubric coverage",state:"warn"},{label:"Verification",state:"bad"},{label:"Attribution",state:"ok"}] as const;
const states = {ok:"Passed",warn:"Partial",bad:"Failed"};
function Feedback() {
  const [selected,select] = useState("Confident");
  return <C.StackBar data={feedback} size="lg" selected={selected} onSelect={select}/>;
}
function Detail() {
  const tip = C.useChartTooltip();
  return <><button type="button" {...tip.bind("November 17, two learning sessions")}>November 17 · 2 sessions</button>{tip.tooltip}</>;
}
export const Meter = {render:() => <div className="kc-plot"><C.Meter value={8} max={10} valueText="8 of 10" tone="ok" threshold={{value:7,label:"Pass"}}/><C.Meter indeterminate max={100} valueText="Downloading model"/></div>};
export const Progress = {render:() => <C.Progress done={4} total={7} label="Course progress"/>};
export const Countdown = {render:() => <C.Countdown remaining={12} total={60}/>};
export const BarList = {render:() => <C.BarList data={[{label:"Mathematics",value:6},{label:"Computing",value:9},{label:"Language",value:4},{label:"Life sciences",value:3}]}/>};
export const StackBar = {render:() => <div className="kc-plot"><Feedback/><C.StackBar data={[{label:"Training",value:180},{label:"Validation",value:30},{label:"Holdout",value:0}]}/><C.StackBar data={[{label:"Reviewed",value:18},{label:"In review",value:4,pattern:true},{label:"Waiting",value:2}]}/></div>};
export const IntervalPlot = {render:() => <C.IntervalPlot band={[66,82]} data={[{label:"Sonnet",value:74,range:[66,82]},{label:"MiniMax",value:70,range:[61,79]},{label:"Gemma",value:58}]}/>};
export const LineChart = {render:() => <C.LineChart crosshair domain={[50,85]} series={["Benchmark","Evolved policy"].map((label,i) => ({label,points:[58,63,62,71].map((y,x) => ({x,y:y+i*4,label:"Run "+(x+1)}))}))}/>};
export const HeatGrid = {render:() => <C.HeatGrid columns={14} data={sessions} selected="April 9"/>};
export const StateGrid = {render:() => <C.StateGrid data={checks} states={states} columns={8}/>};
export const Timeline = {render:() => <C.Timeline lanes={[{label:"Response review",bands:[{label:"Draft",start:0,end:3},{label:"Queue",start:3,end:5,waiting:true},{label:"Verify",start:5,end:8}]}]}/>};
export const Stat = {render:() => <C.Stat label="Learning sessions" value={14} support="Across nine active days"/>};
export const Legend = {render:() => <C.Legend entries={feedback}/>};
export const ChartTooltip = {render:() => <Detail/>};
export const ChartTable = {render:() => <C.ChartTable columns={["Signal","Sessions"]} rows={feedback.map(d => [d.label,d.value])} caption="Learner feedback"/>};
export const ChartFrame = {render:() => <C.ChartFrame title="Session feedback" scope="All time" reading="41 sessions ended with a confident learner."><Feedback/></C.ChartFrame>};

const examples = [
  ["Quiz and download",Meter],["Course progress",Progress],["Exam clock",Countdown],["Topics",BarList],
  ["Feedback, dataset composition and review status",StackBar],["Benchmark outcome",IntervalPlot],["Policy scores",LineChart],
  ["Daily activity",HeatGrid],["Draft checks",StateGrid],["Review timeline",Timeline],["Usage",Stat],
  ["Feedback legend",Legend],["Session detail",ChartTooltip],["Feedback table",ChartTable],["Framed reading",ChartFrame],
] as const;
function Gallery() {
  const [dark,setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.toggle("dark",dark);
    return () => { root.classList.toggle("dark",wasDark); };
  },[dark]);
  return <main style={{background:"var(--card)",color:"var(--ink)",padding:".6rem"}}>
    <button type="button" aria-pressed={dark} onClick={()=>setDark(!dark)}>Dark theme</button>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,16rem),1fr))",gap:"1rem"}}>
      {examples.map(([name,example]) => <section key={name} style={{minWidth:0}}><h3>{name}</h3>{example.render()}</section>)}
    </div></main>;
}
export const Sheet = {render:() => <Gallery/>};
