// Offline. Reparse the unedited tutor text with the same release parser used by chat.
import { plugin } from "bun";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const here = import.meta.dir;
const release = process.env.KEATING_AUDIT_RELEASE;
if (!release)
  throw Error("Set KEATING_AUDIT_RELEASE to the clean 4.2.0 checkout");
const rev = Bun.spawnSync([
  "rtk",
  "proxy",
  "git",
  "-C",
  release,
  "rev-parse",
  "HEAD",
])
  .stdout.toString()
  .trim();
if (rev !== "feb14a770371032619839271cfb3d1a4fe5079ff")
  throw Error("Wrong release");
await plugin({
  name: "raw-md",
  setup(b) {
    b.onLoad({ filter: /\.md(?:\?raw)?$/ }, async (a) => ({
      contents:
        "export default " +
        JSON.stringify(await Bun.file(a.path.replace(/\?raw$/, "")).text()),
      loader: "js",
    }));
  },
});
const fromRelease = (path) => import(join(release, path));
const { parseOpenUIMessageSegments } = await fromRelease(
  "web/src/keating/openui/segments.ts",
);
const { tryCompileOpenUISourceToSharedDocument } = await fromRelease(
  "packages/learner-contracts/src/openui-source.ts",
);
const { SharedUiDocumentRenderer } = await fromRelease(
  "web/src/keating/openui/shared-renderer.tsx",
);
const requireWeb = createRequire(join(release, "web/package.json"));
const { createElement } = requireWeb("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const cases = json(join(here, "scenarios.json"));
const layout = new Set(["markdown", "text", "rows", "callout"]);
const labels = {
  question: "Question",
  "question-group": "Question",
  quiz: "Quiz",
  deck: "Flashcards",
  simulation: "Simulation",
  "concept-map": "ConceptMap",
  "coding-challenge": "CodingChallenge",
  "language-practice": "LanguagePractice",
  "study-plan": "StudyPlan",
  "music-lab": "MusicLab",
  notes: "SharedNotes",
};
const words = (t) => t.trim().split(/\s+/u).filter(Boolean).length;
function inspect(text, key) {
  const segments = parseOpenUIMessageSegments(text, {
    sessionId: "audit",
    messageId: key,
  });
  const parts = [],
    issues = [],
    nodes = [],
    renders = [];
  let marked = 0,
    validDocuments = 0;
  for (const seg of segments) {
    if (seg.type === "text") {
      parts.push({ type: "text", text: seg.content });
      continue;
    }
    marked++;
    if (!seg.complete) {
      issues.push("incomplete fence");
      parts.push({ type: "invalid" });
      continue;
    }
    const parsed =
      seg.format === "document"
        ? { ok: !!seg.document, document: seg.document, message: seg.error }
        : tryCompileOpenUISourceToSharedDocument(
            seg.program || seg.rawProgram,
            {
              documentId: seg.metadata.id,
              revision: seg.metadata.revision,
              retention: seg.metadata.lifecycle,
              createdAt: "2026-11-18T00:00:00Z",
              updatedAt: "2026-11-18T00:00:00Z",
            },
          );
    if (!parsed.ok) {
      issues.push(parsed.message || "invalid document");
      parts.push({ type: "invalid" });
      continue;
    }
    validDocuments++;
    nodes.push(...parsed.document.nodes);
    parts.push({ type: "nodes", nodes: parsed.document.nodes });
    try {
      const html = renderToStaticMarkup(
        createElement(SharedUiDocumentRenderer, { document: parsed.document }),
      );
      renders.push({
        ok: html.includes("data-shared-openui-document="),
        controls: (html.match(/<(?:button|input|textarea|select)\b/g) || [])
          .length,
      });
    } catch (err) {
      renders.push({ ok: false, reason: err.name });
    }
  }
  const component = (node) => {
    if (node.type === "task" && node.diagram) return "Diagram";
    if (node.type === "task") return node.kind;
    if (node.type === "quiz" && node.mode === "exam") return "Exam";
    return labels[node.type] ?? node.type;
  };
  const components = [
    ...new Set(nodes.filter((n) => !layout.has(n.type)).map(component)),
  ];
  return {
    marked,
    validDocuments,
    components,
    issues,
    parts,
    nodes,
    renders,
    outsideWords: words(
      segments
        .filter((s) => s.type === "text")
        .map((s) => s.content)
        .join(" "),
    ),
    layoutOnly: validDocuments > 0 && !components.length,
  };
}
const records = [];
for (const file of readdirSync(join(here, "evidence"))
  .filter((f) => f.includes("--") && f.endsWith(".json"))
  .sort()) {
  const r = json(join(here, "evidence", file));
  const scenario = cases.find((s) => s.id === r.scenario);
  const offered = [
    ...new Set((r.decision?.families ?? []).flatMap((f) => f.components)),
  ];
  const fit = scenario.fit.map((x) =>
    x === "diagram" ? "Diagram" : (labels[x] ?? x),
  );
  function score(response, key) {
    if (!response) return null;
    const s = inspect(response.text, r.id + "-" + key);
    return {
      ...s,
      stop: response.stop,
      toolNames: response.toolNames ?? [],
      text: response.text,
      fits: fit.some((x) => s.components.includes(x)),
      matchesOffer: offered.some((x) => s.components.includes(x)),
    };
  }
  const selected = r.drafts.find((x) => x.attempt === r.selection);
  records.push({
    id: r.id,
    cohort: r.cohort ?? "primary",
    model: r.model,
    scenario: r.scenario,
    group: scenario.group,
    offered,
    planAction: r.decision?.action ?? null,
    directives: r.directives,
    practiceDirective:
      r.directives?.some((t) =>
        t.includes("Provide one requested OpenUI practice activity"),
      ) ?? false,
    phase: r.phase,
    reason: r.reason,
    selection: r.selection,
    unverified: r.release?.unverified ?? null,
    // The release callback is text-only. For a native tool-only release, the selected
    // public message has the same tool names enforced by approvedMessage().
    final:
      r.phase === "released" && selected?.response
        ? score(
            {
              text: r.release?.text ?? r.publicText ?? "",
              stop: selected.response.stop,
              toolNames: r.publicToolNames ?? selected.response.toolNames,
            },
            "release",
          )
        : null,
    drafts: r.drafts.map((x) => score(x.response, "draft-" + x.attempt)),
    control: score(r.counterfactual?.response, "offer-removed"),
  });
}
writeFileSync(
  join(here, "scored.json"),
  JSON.stringify({ revision: rev, records }, null, 2) + "\n",
);
for (const r of records)
  console.log(
    r.model,
    r.scenario,
    r.planAction,
    r.offered.join("/"),
    r.final?.components.join("/") || "—",
    r.final?.fits,
    r.selection,
    r.final?.renders.map((x) => x.ok).join("/") || "—",
  );
