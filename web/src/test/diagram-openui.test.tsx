import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createParser } from "@openuidev/react-lang";
import { compileOpenUISourceToSharedDocument, createDiagramSubmission, parseDiagramSubmission, type DiagramSpec } from "@keating/learner-contracts";
import { keatingOpenUILibrary, keatingOpenUIPrompt } from "../keating/openui/library";
import { SharedUiDocumentRenderer } from "../keating/openui/shared-renderer";
import { dispatchSharedUiAction } from "../keating/openui/shared-actions";
import { createOpenUIActionLearnerResponse } from "../keating/learner-response";

const spec: DiagramSpec = {
  kinds: ["resource", "process"],
  components: [{ id: "water", label: "Surface water", kind: "resource" }, { id: "evaporation", label: "Evaporation", kind: "process" }],
  connections: [{ id: "heating", from: "water", to: "evaporation", label: "Energy input" }],
  checks: [{ id: "transformation", label: "Resource reaches a process", type: "path", fromKind: "resource", toKind: "process" }],
};
const source = `root = LearningSurface([cycle], "Water cycle", null, "resumable")\ncycle = Diagram("water-cycle", "Explain evaporation", "Connect the processes and explain what drives each transformation.", ${JSON.stringify(spec.components)}, ${JSON.stringify(spec.connections)}, ${JSON.stringify(spec.checks)}, ["Distinguish movement of water from the energy driving the process."], "resumable", ${JSON.stringify(spec.kinds)})`;

test("Diagram compiles custom subject categories and exposes appropriate controls and review hooks", () => {
  const parsed = createParser(keatingOpenUILibrary.toJSONSchema()).parse(source);
  expect(parsed.meta.errors).toEqual([]);
  const document = compileOpenUISourceToSharedDocument(source, { documentId: "biology", createdAt: "2026-10-12T00:00:00.000Z" });
  expect(document.nodes[0]).toMatchObject({ type: "task", diagram: spec });
  const html = renderToStaticMarkup(<SharedUiDocumentRenderer document={document} />);
  expect(html).toContain("Build your diagram");
  expect(html).toContain('value="resource"');
  expect(html).toContain('value="process"');
  expect(html).not.toContain('value="database"');
  expect(html).not.toContain("Build your architecture");
  expect(keatingOpenUIPrompt).toContain("System design interviews are one example");
});

test("a generic diagram reaches tutor review with its original subject criteria and verified topology", () => {
  const document = compileOpenUISourceToSharedDocument(source, { documentId: "biology", createdAt: "2026-10-12T00:00:00.000Z" });
  const graph = { components: spec.components, connections: spec.connections };
  const submission = JSON.stringify(createDiagramSubmission(spec, graph, "Energy transferred to surface water allows molecules to enter the air; the diagram arrow names the transformation, not evidence of its rate."));
  const values = new Map<string, string>();
  const dispatched = dispatchSharedUiAction({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }, document, { type: "submit-task", nodeId: "water-cycle", submission });
  expect(parseDiagramSubmission(submission, spec)?.kind).toBe("diagram");
  const response = createOpenUIActionLearnerResponse({
    kind: "canonical", type: "submit-task", params: {}, humanFriendlyMessage: "Diagram submitted: Water cycle",
    document: { id: document.id, revision: document.revision, lifecycle: "resumable" },
    action: dispatched.action, sourceDocument: dispatched.sourceDocument, receipt: dispatched.receipt,
  });
  expect(response.review.title).toBe("Diagram submitted");
  expect(response.review.items).toContainEqual({ label: "Teacher review criteria", value: "Distinguish movement of water from the energy driving the process." });
  expect(response.review.items.find(item => item.label === "Structural checks")?.value).toContain("Present: Resource reaches a process");
  expect(response.agentInstruction).toContain("do not assume every diagram is software architecture");
  expect(response.agentInstruction).toContain("not a correctness grade");
  expect(response.agentInstruction).not.toContain("Probe sizing assumptions");
});

test("a custom palette rejects category drift rather than silently substituting infrastructure types", () => {
  const invalid = source.replace('"kind":"resource"', '"kind":"database"');
  expect(() => compileOpenUISourceToSharedDocument(invalid, { documentId: "bad-biology" })).toThrow();
});
