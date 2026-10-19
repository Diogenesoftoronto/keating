import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { UiTaskNode, UiDocument, UiActionReceipt, DiagramSpec } from "@keating/learner-contracts";
import { SharedUiDocumentRenderer, type SharedUiActionEvent } from "../keating/openui/shared-renderer";
import { dispatchSharedUiAction } from "../keating/openui/shared-actions";
import { SystemDesignWorkbench } from "./SystemDesignWorkbench";

const interview: UiTaskNode & { diagram: DiagramSpec } = {
  type: "task", kind: "assignment", id: "url-shortener", title: "Design a URL shortener", estimatedMinutes: 35,
  brief: "Design a service that creates short links and redirects readers to the original URL. Assume **100 million links** and a read-heavy workload.\n\nBuild the architecture below, then explain one request end to end.",
  criteria: ["Explain how short IDs stay unique under concurrent writes.", "Discuss the consistency, availability, and latency tradeoffs.", "Describe a failure case and how the service recovers."],
  submission: { format: "text" },
  diagram: {
    components: [{ id: "reader", label: "Reader", kind: "client" }, { id: "api", label: "Redirect API", kind: "service" }, { id: "links", label: "Link store", kind: "database" }],
    connections: [{ id: "request", from: "reader", to: "api", label: "GET /short-id" }, { id: "lookup", from: "api", to: "links", label: "Look up destination" }],
    checks: [{ id: "client-store", label: "A request can reach durable storage", type: "path", fromKind: "client", toKind: "database" }, { id: "cache", label: "A cache handles repeated lookups", type: "component", kind: "cache" }, { id: "service-cache", label: "The API can query the cache", type: "connection", fromKind: "service", toKind: "cache" }],
  },
};

const processFlow: UiTaskNode & { diagram: DiagramSpec } = {
  type: "task", kind: "assignment", id: "editorial-process", title: "Map an editorial workflow", estimatedMinutes: 15,
  brief: "Show how a draft becomes a published article. Include the review decision and explain what happens if the reviewer asks for changes.",
  criteria: ["Explain both outcomes of the review decision.", "Show who owns a revision and how it returns to review."],
  submission: { format: "text" },
  diagram: {
    components: [{ id: "draft", label: "Draft", kind: "input" }, { id: "review", label: "Peer review", kind: "step" }, { id: "approved", label: "Approved?", kind: "decision" }, { id: "publish", label: "Published article", kind: "output" }],
    connections: [{ id: "start", from: "draft", to: "review", label: "Submit" }, { id: "judge", from: "review", to: "approved" }, { id: "accept", from: "approved", to: "publish", label: "Yes" }],
    checks: [{ id: "decision", label: "The workflow includes a decision", type: "component", kind: "decision" }, { id: "review-decision", label: "Review leads to a decision", type: "connection", fromKind: "step", toKind: "decision" }, { id: "publication-path", label: "An input can reach the published output", type: "path", fromKind: "input", toKind: "output" }],
  },
};

const biology: UiTaskNode & { diagram: DiagramSpec } = {
  type: "task", kind: "assignment", id: "photosynthesis", title: "Explain photosynthesis with a diagram", estimatedMinutes: 15,
  brief: "Connect the organism, process, and resources involved in photosynthesis. Label what each connection means, then explain where the glucose comes from.",
  criteria: ["Distinguish the source of energy from the sources of matter.", "Explain the roles of carbon dioxide, water, sunlight, and the plant."],
  submission: { format: "text" },
  diagram: {
    kinds: ["organism", "process", "resource"],
    components: [{ id: "sun", label: "Sunlight", kind: "resource" }, { id: "plant", label: "Plant", kind: "organism" }, { id: "photosynthesis", label: "Photosynthesis", kind: "process" }, { id: "glucose", label: "Glucose", kind: "resource" }],
    connections: [{ id: "energy", from: "sun", to: "plant", label: "Supplies energy" }, { id: "performs", from: "plant", to: "photosynthesis", label: "Performs" }, { id: "produces", from: "photosynthesis", to: "glucose", label: "Produces" }],
    checks: [{ id: "organism", label: "An organism participates", type: "component", kind: "organism" }, { id: "resource-path", label: "A resource reaches the process", type: "path", fromKind: "resource", toKind: "process" }, { id: "process-resource", label: "The process produces a resource", type: "connection", fromKind: "process", toKind: "resource" }],
  },
};

function Example({ node = interview, rejectDelivery = false, narrow = false }: { node?: typeof interview; rejectDelivery?: boolean; narrow?: boolean }) {
  const [events, setEvents] = useState<SharedUiActionEvent[]>([]);
  const documentId = useMemo(() => `story-system-design-${crypto.randomUUID()}`, []);
  return <div style={{ width: narrow ? "min(350px, calc(100vw - 32px))" : "min(800px, calc(100vw - 40px))", padding: "16px" }}>
    <SystemDesignWorkbench documentId={documentId} documentRevision={0} node={node} disabled={false} onAction={event => {
      setEvents(current => [...current, event]); return !rejectDelivery;
    }} />
    <details style={{ marginTop: "1rem" }}><summary>Submission evidence</summary><pre data-testid="system-design-evidence" style={{ overflow: "auto", maxWidth: "100%", fontSize: "12px" }}>{JSON.stringify(events, null, 2)}</pre></details>
  </div>;
}

const meta = { title: "Learning/Diagrams", component: Example, parameters: { layout: "centered" } } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const UrlShortener: Story = { args: {} };
export const EmptyStarter: Story = { args: { node: { ...interview, id: "blank-url-shortener", diagram: { ...interview.diagram, components: [], connections: [] } } } };
export const Mobile: Story = { args: { narrow: true } };
export const ProcessFlow: Story = { args: { node: processFlow } };
export const BiologyRelationships: Story = { args: { node: biology } };

export const EditAndSubmit: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("button", { name: "Add component" })).toBeEnabled());
    await userEvent.click(canvas.getByRole("button", { name: "Add component" }));
    const name = canvas.getByRole("textbox", { name: "Component 4" });
    await userEvent.clear(name); await userEvent.type(name, "Hot link cache");
    await userEvent.selectOptions(canvas.getAllByRole("combobox", { name: "Category" })[3]!, "cache");
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "From" }), "api");
    const cacheId = (canvas.getByRole("combobox", { name: "To" }) as HTMLSelectElement).options[4]!.value;
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "To" }), cacheId);
    await userEvent.type(canvas.getByRole("textbox", { name: "Connection label (optional)" }), "Read cached destination");
    await userEvent.click(canvas.getByRole("button", { name: "Connect" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Explain your diagram" }), "Use a unique ID constraint, cache common destinations, and fall back to the durable store on a cache miss. Replicate the store and monitor redirect latency.");
    await userEvent.click(canvas.getByRole("button", { name: "Submit diagram" }));
    expect(canvas.getByText("Submission recorded for review.")).toBeVisible();
    const events = JSON.parse(canvas.getByTestId("system-design-evidence").textContent!);
    expect(events).toHaveLength(1);
    const submission = JSON.parse(events[0].intent.submission);
    expect(submission.graph.components).toHaveLength(4);
    expect(submission.graph.connections).toHaveLength(3);
    expect(submission.checks.every((check: { passed: boolean }) => check.passed)).toBe(true);
  },
};

export const RetryRejectedDelivery: Story = {
  args: { rejectDelivery: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("textbox", { name: "Explain your diagram" })).toBeEnabled());
    await userEvent.type(canvas.getByRole("textbox", { name: "Explain your diagram" }), "Start with a replicated link store. Measure the read workload before adding a cache.");
    await userEvent.click(canvas.getByRole("button", { name: "Submit diagram" }));
    expect(canvas.getByRole("alert")).toHaveTextContent("not acknowledged");
    expect(canvas.queryByText("Submission recorded for review.")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Retry submission" }));
    const events = JSON.parse(canvas.getByTestId("system-design-evidence").textContent!);
    expect(events).toHaveLength(2); expect(events[1]).toEqual(events[0]);
    expect(JSON.parse(events[0].intent.submission).checks.some((check: { passed: boolean }) => !check.passed)).toBe(true);
    await userEvent.type(canvas.getByRole("textbox", { name: "Explain your diagram" }), " Add rate limiting at the API.");
    await userEvent.click(canvas.getByRole("button", { name: "Submit diagram" }));
    const edited = JSON.parse(canvas.getByTestId("system-design-evidence").textContent!);
    expect(edited).toHaveLength(3); expect(edited[2].intent.submission).not.toBe(edited[0].intent.submission);
  },
};

function IntegratedDocument() {
  const [document, setDocument] = useState<UiDocument>(() => ({
    schemaVersion: 1, id: `integrated-system-design-${crypto.randomUUID()}`, revision: 0,
    lifecycle: "ready", supportedSurfaces: ["web"], nodes: [interview],
    createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z",
  }));
  const [receipts, setReceipts] = useState<UiActionReceipt[]>([]);
  const [events, setEvents] = useState<SharedUiActionEvent[]>([]);
  const storage = useMemo(() => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  }, []);
  return <div style={{ width: "min(800px, calc(100vw - 40px))", padding: "16px" }}>
    <SharedUiDocumentRenderer document={document} receipts={receipts} onAction={event => {
      const result = dispatchSharedUiAction(storage, document, event.intent, new Date().toISOString());
      setDocument(result.document); setReceipts(result.journal.receipts); setEvents(current => [...current, event]);
      return true;
    }} />
    <details><summary>Shared action and receipt evidence</summary><pre data-testid="integrated-system-design-evidence" style={{ overflow: "auto", maxWidth: "100%", fontSize: "12px" }}>{JSON.stringify({ events, receipts, revision: document.revision }, null, 2)}</pre></details>
  </div>;
}

export const SharedDocumentHandoff: Story = {
  render: () => <IntegratedDocument />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("textbox", { name: "Explain your diagram" })).toBeEnabled());
    await userEvent.type(canvas.getByRole("textbox", { name: "Explain your diagram" }), "Start with a replicated store and add a cache when the read workload justifies it.");
    await userEvent.click(canvas.getByRole("button", { name: "Submit diagram" }));
    await waitFor(() => expect(canvas.getByText("Submission recorded for review.")).toBeVisible());
    const evidence = JSON.parse(canvas.getByTestId("integrated-system-design-evidence").textContent!);
    expect(evidence.events).toHaveLength(1); expect(evidence.receipts).toHaveLength(1);
    expect(evidence.receipts[0].state).toBe("completed"); expect(evidence.revision).toBe(1);
    expect(JSON.parse(evidence.receipts[0].action.submission).kind).toBe("diagram");
    expect(canvas.getByRole("textbox", { name: "Explain your diagram" })).toBeDisabled();
    expect(canvas.getByRole("textbox", { name: "Explain your diagram" })).toHaveValue("Start with a replicated store and add a cache when the read workload justifies it.");
  },
};

function DurableDraftExample() {
  const documentId = useMemo(() => `durable-system-design-${crypto.randomUUID()}`, []);
  const [mount, setMount] = useState(0);
  const [revision, setRevision] = useState(0);
  return <div style={{ width: "min(800px, calc(100vw - 40px))", padding: "16px" }}>
    <SystemDesignWorkbench key={mount} documentId={documentId} documentRevision={revision} node={interview} disabled={false} onAction={() => false} />
    <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
      <button type="button" onClick={() => setMount(current => current + 1)}>Reopen saved draft</button>
      <button type="button" onClick={() => setRevision(current => current + 1)}>Open new question revision</button>
    </div>
  </div>;
}

export const DurableDraft: Story = {
  render: () => <DurableDraftExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("textbox", { name: "Explain your diagram" })).toBeEnabled());
    const explanation = "Save this request path locally and restore it on reopening.";
    await userEvent.click(canvas.getByRole("button", { name: "Remove Redirect API" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Explain your diagram" }), explanation);
    await waitFor(() => expect(canvas.getByText("Draft saved on this device.")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Reopen saved draft" }));
    await waitFor(() => expect(canvas.getByRole("textbox", { name: "Explain your diagram" })).toBeEnabled());
    expect(canvas.getByRole("textbox", { name: "Explain your diagram" })).toHaveValue(explanation);
    expect(canvas.queryByRole("button", { name: "Remove Redirect API" })).toBeNull();
    expect(canvas.queryByRole("button", { name: /Remove connection/ })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Open new question revision" }));
    await waitFor(() => expect(canvas.getByRole("textbox", { name: "Explain your diagram" })).toBeEnabled());
    expect(canvas.getByRole("textbox", { name: "Explain your diagram" })).toHaveValue("");
    expect(canvas.getByRole("button", { name: "Remove Redirect API" })).toBeEnabled();
    expect(canvas.getAllByRole("button", { name: /Remove connection/ })).toHaveLength(2);
  },
};

export const GenericWorkflowHandoff: Story = {
  args: { node: processFlow },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("button", { name: "Add component" })).toBeEnabled());
    await userEvent.click(canvas.getByRole("button", { name: "Add component" }));
    expect(canvas.getAllByRole("combobox", { name: "Type" })[4]).toHaveValue("concept");
    const label = canvas.getByRole("textbox", { name: "Component 5" });
    await userEvent.clear(label); await userEvent.type(label, "Author revises");
    await userEvent.selectOptions(canvas.getAllByRole("combobox", { name: "Type" })[4]!, "step");
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "From" }), "approved");
    const options = (canvas.getByRole("combobox", { name: "To" }) as HTMLSelectElement).options;
    const revisionId = Array.from(options).find(option => option.textContent === "Author revises")!.value;
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "To" }), revisionId);
    await userEvent.type(canvas.getByRole("textbox", { name: "Connection label (optional)" }), "Changes requested");
    await userEvent.click(canvas.getByRole("button", { name: "Connect" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Explain your diagram" }), "An accepted draft is published. If changes are requested, the author revises it and sends it back for peer review.");
    await userEvent.click(canvas.getByRole("button", { name: "Submit diagram" }));
    expect(canvas.getByText("Submission recorded for review.")).toBeVisible();
    const events = JSON.parse(canvas.getByTestId("system-design-evidence").textContent!);
    expect(events).toHaveLength(1); expect(events[0].humanFriendlyMessage).toBe("Diagram submitted: Map an editorial workflow");
    const submission = JSON.parse(events[0].intent.submission);
    expect(submission.kind).toBe("diagram");
    expect(submission.graph.components.find((component: { label: string }) => component.label === "Author revises").kind).toBe("step");
    expect(submission.graph.connections.find((connection: { label?: string }) => connection.label === "Changes requested").from).toBe("approved");
  },
};
