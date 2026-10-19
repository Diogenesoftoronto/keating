import { useEffect, useMemo, useRef, useState } from "react";
import {
  DIAGRAM_LIMITS, addDiagramComponent, connectDiagramComponents, copyDiagramGraph, diagramDraftKey, disconnectDiagramConnection,
  getDiagramKinds, evaluateDiagramChecks, parseDiagramDraftContent, parseDiagramSubmission, diagramMermaid, prepareDiagramSubmission,
  removeDiagramComponent, renameDiagramComponent, setDiagramComponentKind, validateDiagramGraph,
  type DiagramGraph, type DiagramSpec,
  type UiActionReceipt, type UiTaskNode,
} from "@keating/learner-contracts";
import type { SharedUiActionEvent } from "../keating/openui/shared-renderer";
import type { SharedUiActionIntent } from "../keating/openui/shared-actions";
import { localRead, localWrite } from "../submissions/local-store";
import { MarkdownBlock } from "./MarkdownBlock";
import { MermaidRenderer } from "./MermaidRenderer";
import "./system-design/system-design.css";

type SubmitIntent = Extract<SharedUiActionIntent, { type: "submit-task" }>;
export interface SystemDesignDraft {
  version: 1;
  graph: DiagramGraph;
  explanation: string;
  pending?: SubmitIntent;
}
export interface SystemDesignWorkbenchProps {
  documentId: string;
  documentRevision: number;
  node: UiTaskNode & { diagram: DiagramSpec };
  receipt?: UiActionReceipt;
  disabled: boolean;
  onAction?: (event: SharedUiActionEvent) => boolean;
}

export function systemDesignDraftKey(documentId: string, revision: number, nodeId: string): string {
  return diagramDraftKey(documentId, revision, nodeId);
}

/** Restore graph data only; derived checks and Mermaid never come from a saved draft. */
export function parseSystemDesignDraft(value: unknown, node: SystemDesignWorkbenchProps["node"]): SystemDesignDraft | undefined {
  const content = parseDiagramDraftContent(value, node.diagram, ["pending"]);
  if (!content) return undefined;
  const { pending } = value as Partial<SystemDesignDraft>;
  if (pending !== undefined) {
    const intent = pending;
    if (!intent || typeof intent !== "object" || intent.type !== "submit-task" || intent.nodeId !== node.id
      || intent.round !== node.round || Object.keys(intent).some(key => !["type", "nodeId", "submission", "round"].includes(key))) return undefined;
    const parsed = parseDiagramSubmission(intent.submission, node.diagram);
    if (!parsed || JSON.stringify(parsed.graph) !== JSON.stringify(content.graph) || parsed.explanation !== content.explanation) return undefined;
  }
  return { version: 1, graph: content.graph, explanation: content.explanation, ...(pending ? { pending } : {}) };
}

export const removeSystemDesignComponent = removeDiagramComponent;

/** Keep the same intent on a rejected or thrown delivery; the editor clears it on edits. */
export function deliverSystemDesignAttempt(event: SharedUiActionEvent, deliver?: SystemDesignWorkbenchProps["onAction"]): boolean {
  try { return deliver?.(event) === true; } catch { return false; }
}

const kindLabel = (kind: string) => kind[0].toUpperCase() + kind.slice(1).replaceAll("-", " ");
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
const { components: MAX_COMPONENTS, connections: MAX_CONNECTIONS, label: MAX_LABEL, explanation: MAX_EXPLANATION } = DIAGRAM_LIMITS;

export function SystemDesignWorkbench(props: SystemDesignWorkbenchProps) {
  return <WorkbenchSession key={systemDesignDraftKey(props.documentId, props.documentRevision, props.node.id)} {...props} />;
}

function WorkbenchSession({ documentId, documentRevision, node, receipt, disabled, onAction }: SystemDesignWorkbenchProps) {
  const acknowledged = receipt?.state === "completed" && receipt.action.type === "submit-task"
    && receipt.action.documentId === documentId && receipt.action.nodeId === node.id
    && receipt.action.documentRevision <= documentRevision
    && receipt.action.round === node.round ? receipt.action : undefined;
  const received = useMemo(() => acknowledged ? parseDiagramSubmission(acknowledged.submission, node.diagram) : undefined,
    [acknowledged, node.diagram]);
  const [graph, setGraph] = useState<DiagramGraph>(() => received?.graph ?? copyDiagramGraph(node.diagram));
  const [explanation, setExplanation] = useState(received?.explanation ?? "");
  const [pending, setPending] = useState<SubmitIntent>();
  const [recorded, setRecorded] = useState(false);
  const [restored, setRestored] = useState(Boolean(received));
  const [canSave, setCanSave] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [storageError, setStorageError] = useState("");
  const [deliveryError, setDeliveryError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [connectionLabel, setConnectionLabel] = useState("");
  const receiptRef = useRef(received);
  receiptRef.current = received;
  const storageKey = systemDesignDraftKey(documentId, documentRevision, node.id);
  const kinds = getDiagramKinds(node.diagram);
  const validGraph = validateDiagramGraph(graph);
  const locked = disabled || Boolean(received) || recorded;
  const editable = !locked && restored;
  const checks = useMemo(() => validGraph ? evaluateDiagramChecks(node.diagram, graph) : [], [graph, node.diagram, validGraph]);
  const mermaid = useMemo(() => validGraph && graph.components.length ? diagramMermaid(graph) : "", [graph, validGraph]);
  const draft: SystemDesignDraft = useMemo(() => ({ version: 1, graph, explanation, ...(pending ? { pending } : {}) }), [graph, explanation, pending]);

  useEffect(() => {
    let active = true;
    if (receiptRef.current) return;
    void localRead<unknown>("tasks", storageKey).then(value => {
      if (!active || receiptRef.current) return;
      if (value !== undefined) {
        const saved = parseSystemDesignDraft(value, node);
        if (!saved) throw new Error("invalid draft");
        setGraph(saved.graph); setExplanation(saved.explanation); setPending(saved.pending);
        setSaveStatus("Draft restored from this device.");
      }
      setCanSave(true); setRestored(true);
    }).catch(() => {
      if (!active || receiptRef.current) return;
      setStorageError("Your local draft could not be restored. You can keep working; use Save draft to replace the local copy.");
      setRestored(true);
    });
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    if (!received) return;
    setGraph(received.graph); setExplanation(received.explanation); setPending(undefined); setRestored(true);
  }, [received]);

  useEffect(() => {
    if (!restored || !canSave || !validGraph || received) return;
    let active = true;
    const timer = setTimeout(() => {
      void localWrite("tasks", storageKey, draft).then(() => {
        if (active) { setSaveStatus("Draft saved on this device."); setStorageError(""); }
      }).catch(() => { if (active) setStorageError("This draft could not be saved on this device. Keep this page open and retry Save draft."); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [draft, storageKey, restored, canSave, validGraph, received]);

  const edit = (next: DiagramGraph) => {
    setGraph(next); setPending(undefined); setDeliveryError(""); setSaveStatus("");
  };
  const saveDraft = async () => {
    try {
      await localWrite("tasks", storageKey, draft);
      setCanSave(true); setStorageError(""); setSaveStatus("Draft saved on this device.");
    } catch { setStorageError("This draft could not be saved on this device. Keep this page open and retry Save draft."); }
  };
  const submit = () => {
    if (!editable || !validGraph || !graph.components.length || !explanation.trim()) return;
    let intent = pending;
    if (!intent) {
      const prepared = prepareDiagramSubmission(node.diagram, graph, explanation);
      if (!prepared.ok) {
        if (prepared.reason === "rejected") setDeliveryError(prepared.message);
        return;
      }
      intent = { type: "submit-task", nodeId: node.id, submission: prepared.source, ...(node.round !== undefined ? { round: node.round } : {}) };
    }
    setPending(intent);
    if (deliverSystemDesignAttempt({ intent, humanFriendlyMessage: `Diagram submitted: ${node.title}` }, onAction)) {
      setRecorded(true); setDeliveryError("");
    } else {
      setDeliveryError("Your submission was not acknowledged. Keep working or retry the same submission.");
    }
  };

  return <section className="system-design-workbench" aria-label={node.title} data-task={node.id}>
    <header className="sd-brief">
      <div className="sd-heading"><span className="sd-kicker">Diagram</span>{node.estimatedMinutes ? <span className="sd-muted">~{node.estimatedMinutes} min</span> : null}</div>
      <h3>{node.title}</h3>
      <MarkdownBlock content={node.brief} />
    </header>

    <div className="sd-diagram" aria-label="Your diagram">
      {mermaid ? <MermaidRenderer content={mermaid} htmlLabels={false} decodeEntityLabels /> : <p className="sd-empty">Add a component to begin your diagram.</p>}
    </div>

    <fieldset disabled={!editable} className="sd-editor">
      <legend>Build your diagram</legend>
      <div className="sd-section-heading"><h4>Components <span className="sd-muted">{graph.components.length}/{MAX_COMPONENTS}</span></h4>
        <button type="button" disabled={graph.components.length >= MAX_COMPONENTS} onClick={() => edit(addDiagramComponent(graph, { label: `Component ${graph.components.length + 1}`, kind: kinds[0] }, newId))}>Add component</button>
      </div>
      {!graph.components.length ? <p className="sd-muted">Add the parts you want to show, then connect them.</p> : null}
      <ol className="sd-components">
        {graph.components.map((component, index) => <li className="sd-component" key={component.id}>
          <label>Component {index + 1}<input maxLength={MAX_LABEL} value={component.label} onChange={event => edit(renameDiagramComponent(graph, component.id, event.currentTarget.value))} /></label>
          <label>Category<select value={component.kind} onChange={event => edit(setDiagramComponentKind(graph, component.id, event.currentTarget.value))}>{kinds.map(kind => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}</select></label>
          <button className="sd-remove" type="button" aria-label={`Remove ${component.label || `component ${index + 1}`}`} onClick={() => edit(removeDiagramComponent(graph, component.id))}>Remove</button>
        </li>)}
      </ol>
      <div className="sd-section-heading"><h4>Connections <span className="sd-muted">{graph.connections.length}/{MAX_CONNECTIONS}</span></h4></div>
      <ul className="sd-connections">{graph.connections.map(connection => <li key={connection.id}>
        <span>{graph.components.find(item => item.id === connection.from)?.label} <span aria-label="to">→</span> {graph.components.find(item => item.id === connection.to)?.label}{connection.label ? <small>{connection.label}</small> : null}</span>
        <button className="sd-remove" type="button" aria-label={`Remove connection ${graph.components.find(item => item.id === connection.from)?.label} to ${graph.components.find(item => item.id === connection.to)?.label}`} onClick={() => edit(disconnectDiagramConnection(graph, connection.id))}>Remove</button>
      </li>)}</ul>
      <div className="sd-connection-form">
        <label>From<select value={graph.components.some(item => item.id === from) ? from : ""} onChange={event => setFrom(event.currentTarget.value)}><option value="">Choose component</option>{graph.components.map(component => <option key={component.id} value={component.id}>{component.label}</option>)}</select></label>
        <label>To<select value={graph.components.some(item => item.id === to) ? to : ""} onChange={event => setTo(event.currentTarget.value)}><option value="">Choose component</option>{graph.components.map(component => <option key={component.id} value={component.id}>{component.label}</option>)}</select></label>
        <label>Connection label <span className="sd-muted">(optional)</span><input maxLength={MAX_LABEL} value={connectionLabel} placeholder="Describe the relationship" onChange={event => setConnectionLabel(event.currentTarget.value)} /></label>
        <button type="button" disabled={graph.connections.length >= MAX_CONNECTIONS || !graph.components.some(item => item.id === from) || !graph.components.some(item => item.id === to)} onClick={() => {
          edit(connectDiagramComponents(graph, { from, to, label: connectionLabel }, newId)); setConnectionLabel("");
        }}>Connect</button>
      </div>
    </fieldset>

    {node.diagram.checks.length ? <section className="sd-review" aria-label="Structural checks">
      <h4>Structural checks</h4><p className="sd-muted">These check the diagram's structure. They do not judge your design or block submission.</p>
      <ul>{node.diagram.checks.map(check => {
        const result = checks.find(item => item.id === check.id);
        return <li key={check.id}><span className={result?.passed ? "sd-check-pass" : "sd-muted"}>{result?.passed ? "Present" : "Missing"}</span><span>{check.label}<small>{result?.detail ?? "Name each component to update this check."}</small></span></li>;
      })}</ul>
    </section> : null}
    {node.criteria?.length ? <section className="sd-review" aria-label="Review criteria"><h4>Review criteria</h4><ul className="sd-criteria">{node.criteria.map(criterion => <li key={criterion}>{criterion}</li>)}</ul></section> : null}
    <label className="sd-explanation">Explain your diagram<textarea disabled={!editable} maxLength={MAX_EXPLANATION} rows={5} value={explanation} placeholder="Explain what the components and connections mean, and any assumptions or decisions behind them." onChange={event => { setExplanation(event.currentTarget.value); setPending(undefined); setDeliveryError(""); setSaveStatus(""); }} /></label>
    <div className="sd-footer">
      {received || recorded ? <p role="status">Submission recorded for review.</p> : <>
        <button type="button" className="sd-submit" disabled={!editable || !validGraph || !graph.components.length || !explanation.trim()} onClick={submit}>{deliveryError ? "Retry submission" : "Submit diagram"}</button>
        <button type="button" disabled={!editable || !validGraph} onClick={() => void saveDraft()}>Save draft</button>
        <p className="sd-muted">{!restored ? "Restoring local draft…" : !validGraph ? "Name every component before saving or submitting." : !graph.components.length || !explanation.trim() ? "Add a component and an explanation to submit." : saveStatus}</p>
      </>}
    </div>
    {storageError ? <p role="alert" className="sd-error">{storageError}</p> : null}
    {deliveryError ? <p role="alert" className="sd-error">{deliveryError}</p> : null}
    {acknowledged && !received ? <p role="alert" className="sd-error">The recorded diagram could not be verified. Its stored checks were not accepted.</p> : null}
  </section>;
}
