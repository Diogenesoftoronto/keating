import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SimulationRenderer } from "../../../../../web/src/components/SimulationRenderer";
import { TutorInteractivePage } from "../../../../../web/src/components/interactive/TutorInteractivePage";
import type { UiSimulationNode } from "../../../../../packages/learner-contracts/src/ui";
import { MarkdownBlock } from "./text";

type Source = {source:string; text:string; digest:string; words:number; editorOutsideWords?:number; attempt:number; model:string};
type Simulation = Source & {key:string; reviewer:string; prompt:string; archive:string; archivedPlayerSha256:string;
  old:{vary:string;watch:string;points:number;distinctValues:number;image:string};
  segments:({type:"text";content:string} | {type:"document";document:{nodes:UiSimulationNode[]}})[]};
type Native = Source & {reviewer:string;payloadText:string;htmlSha256:string;argumentsSha256:string;ledgerEntry:string;tools:string[]};
type Gate = {source:string;text:string;prompt:string;requestSha256:string;decisions:{model:string;score:number;prior:string;current:string;raw:string}[]};
type Practice = {prompt:string;rows:(Source & {check:string;language:string;starter:string})[]};
type FinalCase = {task:string;source:string;reviewer:string;status:string;notice:string|null;prompt:string;disposition?:string;
  public:(Source & {segments:Simulation["segments"];python?:string;pythonProse?:string})|null};
const samples: (Simulation & {evidence?:{native:Native;perimeter:Gate;practice:Practice;final:FinalCase[]}})[] =
  JSON.parse(document.getElementById("replies")!.textContent!);
const conveyor = samples.find(s => s.key === "conveyor")!;
const {native,perimeter,practice,final} = conveyor.evidence!;
const pages = [{key:"conveyor",name:"Conveyor"},{key:"bus",name:"Bus graph"},{key:"answer",name:"Direct answer"},{key:"code",name:"Code practice"},{key:"later",name:"Policy v2.3"}];
const current = () => pages.find(p => p.key === location.hash.slice(1))?.key ?? "conveyor";
const node = (s:Simulation) => s.segments.flatMap(p => p.type === "document" ? p.document.nodes : [])[0]!;

function SourceDetails({sample,children}:{sample:Source;children?:React.ReactNode}) {
  return <details className="proof"><summary>View the recorded reply and source</summary>
    <p>Selected draft {sample.attempt} · {sample.model} · {sample.words} {sample.words === 1 ? "word" : "words"} outside OpenUI{sample.editorOutsideWords != null ? ", including the Python block" : ""}</p>
    <code>{sample.source}</code><p>Reply SHA-256 <code>{sample.digest}</code></p>{children}
    <pre tabIndex={0} data-original-text>{sample.text}</pre>
  </details>;
}
function Learner({children}:{children:React.ReactNode}) {
  return <blockquote className="learner"><b>Learner</b><p>{children}</p></blockquote>;
}
function Options({value,choose,items,label}:{value:number;choose:(i:number)=>void;items:string[];label:string}) {
  return <div className="choices" role="group" aria-label={label}>{items.map((item,i) =>
    <button type="button" key={item} aria-pressed={value === i} onClick={() => choose(i)}>{item}</button>)}</div>;
}
function Fact({children}:{children:React.ReactNode}) { return <p className="fact">{children}</p>; }

function Conveyor() {
  const [choice,setChoice] = useState(0);
  return <><h2>Change the conveyor speed</h2><Learner>{conveyor.prompt}</Learner>
    <Options label="Conveyor reply" items={["Gemini Decision · Simulation","Jev · Native page"]} value={choice} choose={setChoice}/>
    {choice === 0 ? <div className="replay" data-choice="simulation">
      <div className="eyeline"><span>Released OpenUI</span><span>{conveyor.words} words outside the interface</span></div>
      <SimulationRenderer node={node(conveyor)} storage={null}/>
      <Fact>At 10 metres between cartons, 60 and 90 metres per minute produce 60 and 90 cartons in ten minutes. The tutor’s brief asks for a prediction before touching the sliders despite the learner’s request to skip test questions.</Fact>
      <details className="proof"><summary>Read the words around the simulation</summary>
        {conveyor.segments.map((part,i) => part.type === "text" && <MarkdownBlock key={i} content={part.content}/>)}</details>
      <SourceDetails sample={conveyor}/>
    </div> : <div className="replay" data-choice="native">
      <div className="eyeline"><span>Native page replay</span><span>{native.words} words outside the interface</span></div>
      <p className="selected-text">{native.text}</p>
      <div className="native-surface"><TutorInteractivePage payloadText={native.payloadText}/></div>
      <Fact>This tutor uses cartons per minute as its speed setting. At 6 and 9 cartons per minute, the ten-minute totals are 60 and 90. The twelve illustrated cartons overlap at one position. The original console also recorded a request to set a learner goal. This local replay opens the page only.</Fact>
      <details className="proof"><summary>Inspect the belt illustration</summary><p>The authored code adds up to twelve boxes. All twelve share the same absolute position and have no animation. With standard or reduced motion, the browser measured the same 32-pixel box for every carton at both settings. The numerical totals and hour-rate changed correctly.</p></details>
      <SourceDetails sample={native}><p>Tool arguments from <code>policy-v2.2/ledger.json</code>, entry <code>{native.ledgerEntry}</code>.</p>
        <p>Original HTML SHA-256 <code>{native.htmlSha256}</code></p></SourceDetails>
    </div>}
  </>;
}

function Bus() {
  const [choice,setChoice] = useState(0);
  const sample = samples[choice], view = sample.old;
  return <><h2>Which control does the graph open on?</h2><Learner>{sample.prompt}</Learner>
    <Options label="Archived bus reply" items={["Jev decision","Gemini Decision"]} value={choice} choose={setChoice}/>
    <div className="bus-grid"><section className="archive-graph"><h3>Original opening graph</h3>
      <p>Vary <strong>{view.vary}</strong><br/>Watch <strong>{view.watch}</strong></p>
      <img src={view.image} alt={`Original plotted graph of ${view.watch} against ${view.vary}`} width={800}/>
      <p className="caption">Captured from the archived player when first opened.</p></section>
      <section className="now-graph"><h3>Current opening graph</h3>
        <SimulationRenderer key={sample.key} node={node(sample)} storage={null}/>
      </section></div>
    <Fact>The same selected reply feeds both graphs. The current renderer opens on bus frequency. At 40 seats per bus, raising frequency from 8 to 16 doubles hourly capacity from 320 to 640. The two MiniMax replies use different assumptions for occupied seats.</Fact>
    <SourceDetails sample={sample}><p>Archived player <code>{sample.archive}</code></p><p>Player SHA-256 <code>{sample.archivedPlayerSha256}</code></p></SourceDetails>
  </>;
}

function Direct() {
  return <><h2>Release a one-word answer</h2><Learner>{perimeter.prompt}</Learner>
    <div className="plain-answer" aria-label="Recorded answer"><span>MiniMax’s saved answer</span><p>{perimeter.text}</p></div>
    <div className="table-wrap"><table><caption>Identical review input, replayed against two policy versions</caption>
      <thead><tr><th>Decision model</th><th>Leak score</th><th>v2.1 gate</th><th>v2.2 gate</th></tr></thead>
      <tbody>{perimeter.decisions.map(d => <tr key={d.model}><th>{d.model}</th><td title={String(d.score)}>{d.score.toFixed(3)}</td>
        <td>{d.prior}</td><td><strong>{d.current}</strong></td></tr>)}</tbody>
    </table></div>
    <Fact>The learner requested the result and had no outstanding checkpoint. Both reviewers saw the same answer and retained their original scores. The later gate checked whether a checkpoint was actually due.</Fact>
    <details className="proof"><summary>View the fixed-input record</summary><code>{perimeter.source}</code><p>Shared request SHA-256 <code>{perimeter.requestSha256}</code></p>
      {perimeter.decisions.map(d => <p key={d.model}>{d.model} · {d.raw} · {d.score}</p>)}</details>
  </>;
}

function Code() {
  const [choice,setChoice] = useState(0);
  const value = practice.rows[choice];
  return <><h2>Keep the exercise in Python</h2><Learner>{practice.prompt}</Learner>
    <Options label="Saved code reply" items={["Gemini · JavaScript challenge","MiniMax · Python block"]} value={choice} choose={setChoice}/>
    {choice === 1 ? <EditablePython code={value.starter}/> : <section className="starter"><div className="eyeline"><span>Recorded starter code</span><span>{value.language}</span></div>
      <pre tabIndex={0}><code>{value.starter}</code></pre>
    </section>}<Fact>{choice === 0
      ? "The tutor explained Python and gave the learner a JavaScript exercise. The v2.2 language check flags this exact selected reply for repair."
      : "MiniMax supplied a Python loop on the same learner prompt. The language check passes. This recorded reply also gives the learner a detailed hint."}</Fact>
    <p className="caption">Both samples were released with an unverified review in the original run. The check shown here evaluates the exercise language.</p>
    <SourceDetails sample={value}/>
  </>;
}

function EditablePython({code}:{code:string}) {
  const [value,setValue] = useState(code), [editing,setEditing] = useState(false);
  return <section className="starter"><div className="eyeline"><span>Recorded starter code · Python</span>
    <button type="button" aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? "Show code" : "Edit code"}</button></div>
    {editing ? <><textarea aria-label="Editable Python code" spellCheck={false} value={value} onChange={e => setValue(e.target.value)}/>
      <div className="edit-actions"><span>Local editing preview</span><button type="button" disabled={value === code} onClick={() => setValue(code)}>Reset code</button></div></> :
      <pre tabIndex={0}><code>{value}</code></pre>}
  </section>;
}

function Later() {
  const [task,setTask] = useState(0), [provider,setProvider] = useState(0);
  const sample = final[task*2 + provider], selected = sample.public;
  const sim = selected?.segments.flatMap(s => s.type === "document" ? s.document.nodes.filter(n => n.type === "simulation") : [])[0];
  return <><h2>Fresh policy v2.3 cases</h2>
    <p className="caption">A separate trial using two new tasks. MiniMax was the tutor for both decision models.</p>
    <Options label="Later teaching case" value={task} choose={setTask} items={["Filling line","Python practice"]}/>
    <Learner>{sample.prompt}</Learner><Options label="Later decision model" value={provider} choose={setProvider} items={["Jev decision","Gemini Decision"]}/>
    {selected ? <div className="replay" data-later-status={sample.status}>
      <div className="eyeline"><span>{sample.notice === "unverified" ? "Released with an unverified review" : "Selected tutor reply"}</span>
        <span>{selected.editorOutsideWords != null ? `${selected.editorOutsideWords} words around the Python editor` : `${selected.words} words outside OpenUI`}</span></div>
      {sim && <SimulationRenderer key={sample.source} node={sim} storage={null}/>}
      {selected.python && <EditablePython key={sample.source} code={selected.python}/>}
      {selected.pythonProse && <MarkdownBlock content={selected.pythonProse}/>}
      {sim && <Fact>Set the pump to 5 and 7.5 bottles per minute. The eight-minute total changes from 40 to 60 bottles.</Fact>}
      <SourceDetails sample={selected}/>
    </div> : <div className="outcome" data-later-status={sample.status}><h3>No public reply recorded</h3><p>{sample.disposition}</p>
      <p className="caption">Receipt <code>{sample.source}</code></p>
      {task === 1 && <a href="#code">Explore the earlier public Python sample</a>}</div>}
  </>;
}

function App() {
  const [page,setPage] = useState(current);
  useEffect(() => {const update = () => setPage(current());window.addEventListener("hashchange",update);return () => window.removeEventListener("hashchange",update);},[]);
  return <main className="exhibit"><header className="mast"><div className="mast-row"><span className="brand">Keating</span><span>Teaching interface audit · November 2026</span></div>
    <h1>The tutor’s response</h1><p>Change a control, compare a decision, or inspect the words the tutor sent.</p></header>
    <nav aria-label="Recorded cases">{pages.map(p => <a key={p.key} href={"#"+p.key} aria-current={p.key === page ? "page" : undefined}>{p.name}</a>)}</nav>
    <article key={page}>{page === "later" ? <Later/> : page === "bus" ? <Bus/> : page === "answer" ? <Direct/> : page === "code" ? <Code/> : <Conveyor/>}</article>
    <footer>Recorded synthetic teaching turns · Local browser replay</footer></main>;
}
createRoot(document.getElementById("preview")!).render(<App/>);
