import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SimulationRenderer } from "../../../../../web/src/components/SimulationRenderer";
// The offline packager exposes the classroom's QuestionGroup component.
import { QuestionGroup } from "../../../../../web/src/keating/openui/shared-renderer";
import type { UiDocument, UiDocumentNode } from "../../../../../packages/learner-contracts/src/ui";
import { MarkdownBlock } from "./text";

type Segment = {type:"text";content:string} | {type:"document";document:UiDocument} | {type:"invalid"};
type Reply = {id:string; text:string; segments:Segment[]; components:string[]; editableCode:string[] | null; tools:{name:string}[]; words:number | null; fit:string | null; note:string | null};
type Cell = {id:string;caseId:string;tutor:string;arm:string;prompt:string;status:string;notice:string|null;offered:string[];codePracticeLanguage?:string|null;planKnown:boolean;attempts:number;first:Reply|null;final:Reply|null;replay:Reply|null;gateIssues:string[]};
type Rate = {pass:number;observed:number;unknown:number;scheduled:number};
type Arm = {arm:string;first:Rate;final:Rate;firstAction:Rate;finalAction:Rate;firstFenced:Rate;finalFenced:Rate;firstOfferUsed:Rate;finalOfferUsed:Rate};
type PrivateDraft = {number:number;text:string;complete:boolean;stop:string;status:string;tools:string[];checks:{name:string;status:string;probability:number|null}[]};
type Latest = {key:string;caseId:string;version:string;decision:string;prompt:string;reply:Reply|null;receipt:string;status:string;notice:string|null;attempt:number|null;classroomNotice:string|null;privateDrafts:PrivateDraft[]};
type Study = {cells:Cell[]; counts:Arm[];latest?:Latest[];classroom?:{headline:string;value:string;href:string;document:UiDocument}};
const data: Study = JSON.parse(document.getElementById("replies")!.textContent!)[0].study;
const names:Record<string,string> = {jev:"Jev",google:"Gemini Decision",none:"Unguided",minimax:"MiniMax M2.7 Highspeed",flash:"Gemini 3.1 Flash-Lite",
  "paper-fold":"Predict paper layers",irrigation:"Change the flow","python-sum":"Debug a Python loop",copper:"Answer a fact","paper-followup":"Respond to the learner’s guess",
  question:"Question","question-group":"Question group",simulation:"Simulation",python:"Python",javascript:"JavaScript",typescript:"TypeScript",released:"Released",ungated:"Direct tutor output",withheld:"Withheld","provider-error":"Provider error",
  "tile-bag":"Predict the tile shape","tile-bag-confirm":"Reply to the learner’s guess","authentic-confirmation":"Reply to the learner’s guess",
  "classroom-confirmation":"Type the answer in the classroom","multiples-loop":"Find a bug without hints"};
const label = (key:string) => names[key] ?? key;
const firstCell = () => data.cells.find(c => c.id === location.hash.slice(1)) ?? data.cells.find(c => c.caseId==="irrigation" && c.arm==="jev" && c.tutor==="minimax") ?? data.cells[0]!;
const rateText = (rate:Rate) => rate.observed ? rate.pass+" / "+rate.observed : "Unobserved";
const measures = {
  action:{name:"Learner’s requested control",keys:["firstAction","finalAction"],info:"Prediction fields, simulations and editable Python count when they match the learner’s action. The short-answer cases are excluded."},
  openui:{name:"OpenUI component",keys:["firstFenced","finalFenced"],info:"Counts a compiled OpenUI control on any of the four tasks. Editable Markdown is measured with the learner’s requested control."},
  fit:{name:"Reply fits the full request",keys:["first","final"],info:"Fable assessed the response against the enrolled task, including whether it respected a quiz opt-out or revealed a debugging hint."},
  offer:{name:"Tutor used a named offer",keys:["firstOfferUsed","finalOfferUsed"],info:"Only turns with a delivered decision naming a component family are eligible. A choice among several offered families counts once."},
} as const;

function Options({name,value,values,choose}:{name:string;value:string;values:string[];choose:(value:string)=>void}) {
  return <label className="fr-picker">{name}<select aria-label={name} value={value} onChange={event=>choose(event.target.value)}>
    {values.map(option=><option key={option} value={option}>{label(option)}</option>)}
  </select></label>;
}

function Editor({code,language}:{code:string;language:string}) {
  const [value,setValue] = useState(code);
  return <div className="fr-code"><label>Editable {language} starter<textarea spellCheck={false} value={value} onChange={e=>setValue(e.target.value)}/></label>
    <button type="button" disabled={value===code} onClick={()=>setValue(code)}>Reset code</button><small>Edits stay in this replay.</small></div>;
}

function Prose({text}:{text:string}) {
  const parts:React.ReactNode[]=[];
  let last=0;
  // The study exports editability through the actual Markdown parser. Here only
  // simple closed fences are offered for local edits; the original is always available.
  for (const match of text.matchAll(/^`{3}(python|py|javascript|js|typescript|ts)[ \t]*\r?\n([\s\S]*?)^`{3}[ \t]*$/gim)) {
    if(match.index>last) parts.push(<MarkdownBlock key={"p"+last} content={text.slice(last,match.index)}/>);
    parts.push(<Editor key={"e"+match.index} code={match[2]!.trimEnd()} language={match[1]!}/>);
    last=match.index+match[0].length;
  }
  if(last<text.length) parts.push(<MarkdownBlock key={"p"+last} content={text.slice(last)}/>);
  return <>{parts}</>;
}

function Control({node}:{node:UiDocumentNode}) {
  const [sent,setSent] = useState(false);
  if (node.type==="simulation") return <SimulationRenderer node={node} storage={null}/>;
  if (node.type==="question" || node.type==="question-group") {
    const group = node.type==="question-group" ? node : {type:"question-group" as const,id:node.id,questions:[node]};
    return <><QuestionGroup node={group} disabled={sent} onAction={()=>{setSent(true);return true;}}/>
      {sent && <p role="status" className="fr-ok">Answer recorded in this replay.</p>}</>;
  }
  if (node.type==="markdown") return <MarkdownBlock content={node.markdown}/>;
  return <p>Recorded component · {node.type}</p>;
}

function ReplySegments({reply}:{reply:Reply}){
  return <>{reply.segments.map((p,i)=>p.type==="text"?<Prose text={p.content} key={i}/>:p.type==="document"?<section className="fr-doc" key={i}>
    {p.document.title && <h3>{p.document.title}</h3>}{p.document.description && <p>{p.document.description}</p>}
    {p.document.nodes.map(n=><Control node={n} key={n.id}/>)}</section>:<p key={i}>This authored OpenUI block did not compile.</p>)}
    {reply.tools.length>0 && <p className="fr-note">Tool proposals in this reply · {reply.tools.map(t=>t.name).join(", ")}</p>}</>;
}

function LatestTurns({rows}:{rows:Latest[]}){
  const [id,choose]=useState(()=>new URLSearchParams(location.search).get("followup")??rows[0]!.key);
  useEffect(()=>{if(location.hash==="#final-policy") document.getElementById("final-policy")?.scrollIntoView();},[]);
  const row=rows.find(r=>r.key===id)??rows[0]!;
  return <section id="final-policy" aria-labelledby="final-policy-heading"><h2 id="final-policy-heading">After the learner made a guess</h2>
    <p className="fr-note">Try the original tile-bag question, then compare MiniMax’s replies to the same learner’s answer under each review policy. The Python exercise was a separate first turn.</p>
    <label className="fr-picker">Final check<select aria-label="Final check" value={row.key} onChange={event=>choose(event.target.value)}>
      {rows.map(r=><option key={r.key} value={r.key}>{label(r.caseId)} · {label(r.decision)} · {r.version}</option>)}</select></label>
    <blockquote>{row.prompt}</blockquote><section className="fr-reply" key={row.key} aria-label="Final policy outcome">
      <p className="fr-eyeline">{row.notice==="unverified"?"Best-effort release":label(row.status)}{row.attempt!==null && " · Draft "+row.attempt}</p>
      {row.reply?<ReplySegments reply={row.reply}/>:<p>The tutor did not release a teaching reply on this turn.</p>}
      {row.classroomNotice && <p><strong>The learner saw</strong> “{row.classroomNotice}”</p>}
      {row.privateDrafts.map(d=><details key={d.number}><summary>Private draft {d.number} · {d.complete?d.status==="unknown"?"review uncertain":"review "+d.status:"incomplete"}</summary>
        <pre tabIndex={0}>{d.text}</pre>
        {!d.complete && <p>Generation stopped with <code>{d.stop}</code>.</p>}
        {d.tools.length>0 && <p>Proposed tools · {d.tools.join(", ")}</p>}
        {d.checks.length>0 && <ul aria-label="Review findings">{d.checks.map(c=><li key={c.name}><code>{c.name}</code> · {c.status}{c.probability!==null && " · "+c.probability.toFixed(2)}</li>)}</ul>}
      </details>)}
      <a href={row.receipt}>Read the original receipt</a></section></section>;
}

function App() {
  const [cell,setCell] = useState(firstCell);
  const [measure,setMeasure] = useState<keyof typeof measures>("action");
  const metric=measures[measure];
  const [stage,setStage] = useState<"first"|"final"|"replay">("final");
  useEffect(()=>{
    const handle=()=>setCell(firstCell());
    addEventListener("hashchange",handle);return ()=>removeEventListener("hashchange",handle);
  },[]);
  function choose(key:"caseId"|"tutor"|"arm",value:string) {
    const wanted={caseId:cell.caseId,tutor:cell.tutor,arm:cell.arm,[key]:value};
    const next=data.cells.find(c=>c.caseId===wanted.caseId && c.tutor===wanted.tutor && c.arm===wanted.arm);
    if(next){setCell(next);location.hash=next.id;}
  }
  const visibleStage=stage==="replay" && !cell.replay?"final":stage;
  const reply=cell[visibleStage];
  const baseline=cell.arm==="none";
  const finalName=baseline ? "Unguided output" : "Released reply";
  const offers=[...cell.offered.map(label),...(cell.codePracticeLanguage?["Editable "+label(cell.codePracticeLanguage)]:[])];
  return <main className="fr-main">
    <header><p className="fr-kicker">Keating · Interface evaluation</p><h1>What reached the learner?</h1>
      <p>Explore the original replies to four learning requests. Each tutor tried each request with Jev, Gemini Decision and ordinary unguided generation.</p></header>
    <section aria-labelledby="review-score"><h2 id="review-score">How often the tutor delivered</h2>
      <label className="fr-picker fr-measure">Measure<select aria-label="Measure" value={measure} onChange={e=>setMeasure(e.target.value as keyof typeof measures)}>
        {Object.entries(measures).map(([id,m])=><option value={id} key={id}>{m.name}</option>)}
      </select></label>
      <div className="fr-table"><table><thead><tr><th>Decision guidance</th><th>First draft</th><th>Tutor output</th><th>Unknown final</th></tr></thead><tbody>
        {data.counts.map(c=><tr key={c.arm}><th>{label(c.arm)}</th>{metric.keys.map(key=>
          <td key={key}>{c[key].scheduled?rateText(c[key]):"—"}</td>)}<td>{c[metric.keys[1]].unknown}</td></tr>)}
      </tbody></table></div><p className="fr-note">{metric.info} The unguided output is its first draft. Guided outputs went through release review.</p></section>
    {data.classroom && <aside className="fr-live"><div><strong>{data.classroom.headline}</strong><p>{data.classroom.value}</p></div>
      <details className="fr-live-replay"><summary>Try the recorded classroom slider</summary>{data.classroom.document.nodes.map(n=><Control node={n} key={n.id}/>)}</details>
      <a href={data.classroom.href}>See the classroom after the change</a></aside>}
    <section aria-labelledby="review-case"><h2 id="review-case">Follow a turn</h2><div className="fr-pickers">
      <Options name="Learner task" value={cell.caseId} values={["irrigation","paper-fold","python-sum","copper","paper-followup"]} choose={v=>choose("caseId",v)}/>
      <Options name="Tutor" value={cell.tutor} values={["minimax","flash"]} choose={v=>choose("tutor",v)}/>
      <Options name="Decision guidance" value={cell.arm} values={["jev","google","none"]} choose={v=>choose("arm",v)}/>
    </div><blockquote>{cell.prompt}</blockquote>
    <dl className="fr-stages"><div><dt>Decision offered</dt><dd>{baseline?"Unguided":!cell.planKnown?"Unobserved":offers.length?offers.join(", "):"No component"}</dd></div>
      <div><dt>Tutor drafts returned</dt><dd>{cell.attempts}</dd></div><div><dt>Original outcome</dt><dd>{cell.notice==="unverified"?"Best-effort release":label(cell.status)}</dd></div></dl>
    <div className="fr-switch" role="group" aria-label="Tutor response stage">
      <button type="button" aria-pressed={visibleStage==="first"} onClick={()=>setStage("first")}>First draft</button>
      <button type="button" aria-pressed={visibleStage==="final"} onClick={()=>setStage("final")}>{finalName}</button>
      {cell.replay && <button type="button" aria-pressed={visibleStage==="replay"} onClick={()=>setStage("replay")}>After the fix · offline replay</button>}</div>
    {visibleStage==="replay" && <p className="fr-note">The repaired release policy chose this reply from the saved generation and review evidence.</p>}
    {reply ? <article key={cell.id+stage+reply.id} className="fr-reply" aria-label="Original tutor response">
      <div className="fr-eyeline">{reply.components.length ? reply.components.map(label).join(" · ") : reply.editableCode?.length ? "Editable "+reply.editableCode.join(", ") : "Tutor reply"}
        {reply.words!==null && <span>{reply.words} words around the controls</span>}</div>
      <ReplySegments reply={reply}/>
      {reply.note && <p className="fr-review"><strong>Review</strong> {reply.note}</p>}
      <details><summary>Original source and review status</summary><p>Rubric outcome · {reply.fit??"Unassessed"}</p><pre tabIndex={0}>{reply.text}</pre></details>
    </article>:<p role="status" className="fr-empty">No {stage==="first"?"completed first draft":baseline?"direct tutor output":"released reply"} was observed for this case.</p>}
    <details><summary>Inspect the original turn</summary><p><a href={"study/receipts/"+cell.id+".json"}>Open the turn receipt with every draft and review</a></p>
      {cell.gateIssues.length>0 && <><p>Review findings across attempts</p><ul>{cell.gateIssues.map(issue=><li key={issue}><code>{issue}</code></li>)}</ul></>}</details>
    </section>{data.latest?.length && <LatestTurns rows={data.latest}/>}
    <footer><a href="field-guide.html">Read Fable’s field guide</a><a href="report.html">Full report</a><a href="final.json">Machine-readable results</a><a href="../diagnostics.html?source=review">Inspect final outputs</a><a href="../diagnostics.html?source=review-first">Compare original drafts</a></footer>
  </main>;
}
createRoot(document.getElementById("preview")!).render(<App/>);
