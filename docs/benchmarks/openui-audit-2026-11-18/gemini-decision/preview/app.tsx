import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { UiDocument } from "../../../../../packages/learner-contracts/src/index";
import { SimulationRenderer } from "../../../../../web/src/components/SimulationRenderer";
// The common bundler extracts this internal application component and its dependencies.
import { QuestionGroup } from "../../../../../web/src/keating/openui/shared-renderer";
import { MarkdownBlock } from "./text";

type Sample = {
  key: "spinner" | "bus"; label: string; prompt: string; targets: string[]; draft: number;
  model: string; judge: string; text: string; outsideWords: number; trimmedWords: number; note: string;
  segments: ({type: "text"; content: string} | {type: "document"; document: UiDocument})[];
};
const samples: Sample[] = JSON.parse(document.getElementById("replies")!.textContent!);
const selectedKey = () => location.hash === "#bus" ? "bus" : "spinner";

function ReleasedSample({ sample }: { sample: Sample }) {
  const [round, setRound] = useState(0);
  const [finished, setFinished] = useState(false);
  return <>
    <div className="request"><h2>Learner request</h2><blockquote>{sample.prompt}</blockquote></div>
    <p className="description" data-release-meta>Released draft {sample.draft} · {sample.outsideWords} words outside the interface</p>
    <article className="reply" aria-label="Released tutor reply">{sample.segments.map((part, i) => {
      if (part.type === "text") return <div key={i} className="reply-prose"><MarkdownBlock content={part.content} /></div>;
      const doc = part.document;
      const node = doc.nodes[0];
      return <section key={i} className="activity" data-canonical-node={node.type}>
        <h2>{doc.title}</h2>{doc.description && <p className="description">{doc.description}</p>}
        {node.type === "simulation" && <SimulationRenderer node={node} storage={null} />}
        {node.type === "question-group" && <QuestionGroup key={round} node={node} disabled={false}
          onAction={() => { setFinished(true); return true; }} />}
        {finished && <button type="button" className="restart" onClick={() => { setFinished(false); setRound(n => n + 1); }}>Try another answer</button>}
      </section>;
    })}</article>
    <div className="notes">
      <details><summary>Decision and review</summary>
        <p>Google’s <code>{sample.judge}</code> guided <code>{sample.model}</code> toward {sample.targets.join(" or ")}. The teaching gate released draft {sample.draft}.</p>
        {sample.trimmedWords > 0 && <p>The gate removed {sample.trimmedWords} words after the checkpoint before releasing this reply.</p>}
        <p>{sample.note}</p>
        {sample.key === "bus" && <p>The chart initially varies the load factor. Choose “Buses per hour” under Vary to graph frequency. Sharing settings with a tutor requires a connected lesson.</p>}
      </details>
      <details><summary>View the original reply</summary><pre>{sample.text}</pre></details>
    </div>
  </>;
}

function Preview() {
  const [active, setActive] = useState(selectedKey);
  const [visited, setVisited] = useState(() => new Set([selectedKey()]));
  useEffect(() => {
    const navigate = () => { const next = selectedKey(); setVisited(keys => new Set(keys).add(next)); setActive(next); };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  return <>
    <header className="masthead"><p>Keating <span aria-hidden="true">/</span> OpenUI study</p></header>
    <main><header className="intro"><h1>MiniMax with Gemini Decision</h1>
      <p>Google’s <code>gemini-decision-1</code> guided and reviewed these two replies from <code>MiniMax-M2.7-highspeed</code>. Try the released interfaces offline. Your inputs stay in this tab. The original run recorded no learner viewing or interaction.</p>
    </header>
      <nav aria-label="Choose a reply">{samples.map(s => <a key={s.key} href={"#" + s.key}
        aria-current={active === s.key ? "page" : undefined}>{s.label}</a>)}</nav>
      {samples.map(s => visited.has(s.key) && <section aria-label={s.label} key={s.key} hidden={s.key !== active}><ReleasedSample sample={s} /></section>)}
    </main>
  </>;
}

createRoot(document.getElementById("preview")!).render(<Preview />);
