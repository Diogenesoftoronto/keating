import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createSystemDesignSubmission, type SystemDesignSpec, type UiActionReceipt, type UiTaskNode } from "@keating/learner-contracts";
import { deliverSystemDesignAttempt, parseSystemDesignDraft, removeSystemDesignComponent, systemDesignDraftKey, SystemDesignWorkbench } from "../components/SystemDesignWorkbench";
import type { SharedUiActionEvent } from "../keating/openui/shared-renderer";

const spec: SystemDesignSpec = {
  components: [{ id: "client", label: "Reader", kind: "client" }, { id: "api", label: "API", kind: "service" }, { id: "db", label: "Store", kind: "database" }],
  connections: [{ id: "request", from: "client", to: "api" }, { id: "lookup", from: "api", to: "db" }],
  checks: [{ id: "cache", label: "A cache exists", type: "component", kind: "cache" }],
};
const node: UiTaskNode & { diagram: SystemDesignSpec } = { type: "task", kind: "assignment", id: "design", title: "Design a shortener", brief: "Explain a redirect.", criteria: ["Discuss failures and consistency"], diagram: spec, submission: { format: "text" } };
const graph = { components: spec.components, connections: spec.connections };
const submission = JSON.stringify(createSystemDesignSubmission(spec, graph, "I would start with a replicated store."));
const intent = { type: "submit-task" as const, nodeId: node.id, submission };
const event: SharedUiActionEvent = { intent, humanFriendlyMessage: "Diagram submitted: Design a shortener" };

describe("system-design editor boundaries", () => {
  test("removing a component removes incoming, outgoing, and self-loop connections", () => {
    const result = removeSystemDesignComponent({ ...graph, connections: [...graph.connections,
      { id: "self", from: "api", to: "api" }, { id: "unrelated", from: "client", to: "db" }] }, "api");
    expect(result.components.map(component => component.id)).toEqual(["client", "db"]);
    expect(result.connections).toEqual([{ id: "unrelated", from: "client", to: "db" }]);
    expect(graph.components).toHaveLength(3); expect(graph.connections).toHaveLength(2);
  });

  test("draft keys isolate document, revision, node, and delimiter-containing IDs", () => {
    expect(systemDesignDraftKey("doc", 1, "node")).not.toBe(systemDesignDraftKey("doc", 2, "node"));
    expect(systemDesignDraftKey("doc", 1, "node")).not.toBe(systemDesignDraftKey("other", 1, "node"));
    expect(systemDesignDraftKey("doc", 1, "node")).not.toBe(systemDesignDraftKey("doc", 1, "other"));
    expect(systemDesignDraftKey("a:b", 1, "c")).not.toBe(systemDesignDraftKey("a", 1, "b:c"));
  });

  test("restores a valid pending draft but rejects derived-field spoofing and mismatched work", () => {
    const draft = { version: 1 as const, graph, explanation: "I would start with a replicated store.", pending: intent };
    expect(parseSystemDesignDraft(draft, node)).toEqual(draft);
    const forged = JSON.parse(submission); forged.checks[0].passed = true;
    expect(parseSystemDesignDraft({ ...draft, pending: { ...intent, submission: JSON.stringify(forged) } }, node)).toBeUndefined();
    expect(parseSystemDesignDraft({ ...draft, explanation: "Different answer" }, node)).toBeUndefined();
    expect(parseSystemDesignDraft({ ...draft, pending: { ...intent, nodeId: "different" } }, node)).toBeUndefined();
    expect(parseSystemDesignDraft({ ...draft, graph: { ...graph, connections: [{ id: "bad", from: "api", to: "missing" }] } }, node)).toBeUndefined();
  });

  test("only explicit delivery acknowledgment counts; rejected attempts retain identical bytes", () => {
    const attempts: SharedUiActionEvent[] = [];
    expect(deliverSystemDesignAttempt(event, value => { attempts.push(value); return false; })).toBe(false);
    expect(deliverSystemDesignAttempt(event, value => { attempts.push(value); throw new Error("offline"); })).toBe(false);
    expect(attempts[0]).toBe(attempts[1]);
    expect(deliverSystemDesignAttempt(event)).toBe(false);
    expect(deliverSystemDesignAttempt(event, () => true)).toBe(true);
  });

  test("renders objective checks separately from teacher review criteria", () => {
    const html = renderToStaticMarkup(<SystemDesignWorkbench documentId="doc" documentRevision={0} node={node} disabled={false} />);
    expect(html).toContain("Structural checks"); expect(html).toContain("Missing");
    expect(html).toContain("do not judge your design or block submission");
    expect(html).toContain("Teacher review criteria"); expect(html).toContain("Discuss failures and consistency");
    expect(html).toContain("Explain your diagram"); expect(html).not.toContain("Submission recorded for review.");
  });

  test("generic diagrams expose only their custom component palette and use neutral copy", () => {
    const biology: UiTaskNode & { diagram: SystemDesignSpec } = {
      ...node, id: "biology", title: "Explain photosynthesis", brief: "Connect an organism and the process it performs.",
      criteria: ["Distinguish energy from matter"],
      diagram: { kinds: ["organism", "process", "resource"], components: [{ id: "plant", label: "Plant", kind: "organism" }], connections: [],
        checks: [{ id: "process", type: "component", kind: "process", label: "A process is present" }] },
    };
    const html = renderToStaticMarkup(<SystemDesignWorkbench documentId="biology-doc" documentRevision={0} node={biology} disabled={false} />);
    expect(html).toContain("Build your diagram"); expect(html).toContain("Explain your diagram");
    expect(html).toContain('value="organism"'); expect(html).toContain('value="process"'); expect(html).toContain('value="resource"');
    expect(html).not.toContain('value="service"'); expect(html).not.toContain('value="database"');
    expect(html).not.toContain("Build your architecture"); expect(html).not.toContain("System design");
    expect(html).toContain("Distinguish energy from matter");
  });

  test("valid completed receipts are authoritative; forged submissions never appear recorded", () => {
    const receipt: UiActionReceipt = { schemaVersion: 1, action: { ...intent, schemaVersion: 1, documentId: "doc", documentRevision: 0, idempotencyKey: "submit" }, state: "completed", actionFingerprint: "test", createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" };
    const html = renderToStaticMarkup(<SystemDesignWorkbench documentId="doc" documentRevision={1} node={node} receipt={receipt} disabled={false} />);
    expect(html).toContain("Submission recorded for review."); expect(html).toContain("I would start with a replicated store.");
    const forged = JSON.parse(submission); forged.mermaid = "flowchart LR\nInjected[evil]";
    const invalid = renderToStaticMarkup(<SystemDesignWorkbench documentId="doc" documentRevision={1} node={node} receipt={{ ...receipt, action: { ...intent, schemaVersion: 1, documentId: "doc", documentRevision: 0, idempotencyKey: "submit", submission: JSON.stringify(forged) } }} disabled={false} />);
    expect(invalid).not.toContain("Submission recorded for review."); expect(invalid).toContain("could not be verified");
  });
});
