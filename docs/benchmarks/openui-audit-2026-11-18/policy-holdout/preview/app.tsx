import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SimulationRenderer } from "../../../../../web/src/components/SimulationRenderer";
// The build exposes the existing internal component without importing unrelated activity types.
import { QuestionGroup } from "../../../../../web/src/keating/openui/shared-renderer";
import { MarkdownBlock } from "./text";

const samples = JSON.parse(document.getElementById("replies")!.textContent!);
const keyFromHash = () => location.hash === "#bus" ? "bus" : "spinner";

function Sample({ sample }: { sample: typeof samples[number] }) {
  const [generation, setGeneration] = useState(0);
  const [completed, setCompleted] = useState(false);
  return <>
    <div className="request"><h2>Learner request</h2><blockquote>{sample.prompt}</blockquote></div>
    <article aria-label="Released tutor reply" className="reply">
      {sample.segments.map((segment, i) => segment.type === "text"
        ? <div className="reply-prose" key={i}><MarkdownBlock content={segment.content} /></div>
        : <section className="activity" key={i} data-canonical-node={segment.document.nodes[0].type}>
          <h2>{segment.document.title}</h2>
          {segment.document.description && <p className="description">{segment.document.description}</p>}
          {segment.document.nodes[0].type === "simulation"
            ? <SimulationRenderer node={segment.document.nodes[0]} storage={null} />
            : <QuestionGroup key={generation} node={segment.document.nodes[0]} disabled={false}
              onAction={() => { setCompleted(true); return true; }} />}
          {completed && <button type="button" className="restart" onClick={() => { setCompleted(false); setGeneration(n => n + 1); }}>Try another answer</button>}
        </section>)}
    </article>
    <div className="notes">
      <details><summary>What to notice</summary><p>{sample.note}</p></details>
      <details><summary>View the original reply</summary><pre>{sample.text}</pre></details>
    </div>
  </>;
}

function Preview() {
  const [selected, setSelected] = useState(keyFromHash);
  const [visited, setVisited] = useState(() => new Set([keyFromHash()]));
  useEffect(() => {
    function navigate() { const next = keyFromHash(); setVisited(keys => new Set(keys).add(next)); setSelected(next); }
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  return <>
    <header className="masthead"><p>Keating <span aria-hidden="true">/</span> OpenUI study</p></header>
    <main><header className="intro"><h1>Try the MiniMax replies</h1>
      <p>Two synthetic learning requests, answered by MiniMax-M2.7-highspeed. These offline controls keep your inputs in this tab. Learner viewing in the original run was unobserved.</p></header>
      <nav aria-label="Choose a reply">{samples.map(sample => <a key={sample.key} href={"#" + sample.key}
        aria-current={selected === sample.key ? "page" : undefined}>{sample.label}</a>)}</nav>
      {samples.map(sample => visited.has(sample.key) && <section key={sample.key} aria-label={sample.label} hidden={selected !== sample.key}><Sample sample={sample} /></section>)}
    </main>
  </>;
}
createRoot(document.getElementById("preview")!).render(<Preview />);
