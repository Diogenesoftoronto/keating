import { EmptyState, IconButton, Loading } from "../design-system/kit";
import { KeatingGlyph } from "../design-system/glyphs";
import { LessonFrame } from "./lesson/LessonFrame";
import "./specialist-lessons.css";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  const explanationId = useId();
  const [controlsHost, setControlsHost] = useState<HTMLSpanElement | null>(null);
  // Diagram controls join the frame head only when it has room; on narrow frames they float on the stage.
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [roomyHead, setRoomyHead] = useState(false);
  useEffect(() => {
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setRoomyHead((entry?.contentRect.width ?? 0) >= 440));
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);
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

  const labelOf = (componentId: string) => graph.components.find(item => item.id === componentId)?.label;
  const canSubmit = editable && validGraph && graph.components.length > 0 && Boolean(explanation.trim());
  const passedChecks = node.diagram.checks.filter(check => checks.find(item => item.id === check.id)?.passed).length;
  return <LessonFrame glyph="shapes" kind="Diagram" title={node.title} aria-label={node.title} data-task={node.id} className="system-design-workbench"
    tools={<span className="sd-tools">
      {mermaid && roomyHead ? <span ref={setControlsHost} className="sd-diagram-tools" data-glyph-host /> : null}
      {node.estimatedMinutes ? <span className="lesson-meta sd-duration"><KeatingGlyph name="clock" size={13} />~{node.estimatedMinutes} min</span> : null}
    </span>}
    footer={received || recorded ? <p role="status" className="lesson-status" data-tone="ok">Submission recorded for review.</p> : <>
      <button type="button" className="lesson-quiet" disabled={!editable || !validGraph} onClick={() => void saveDraft()}><KeatingGlyph name="save" size={13} />Save draft</button>
      {!restored ? <Loading size="inline" label="Restoring local draft…" /> : <span className="lesson-foot-meta sd-save-status">{!validGraph ? "Name every component before saving or submitting." : !graph.components.length || !explanation.trim() ? "Add a component and an explanation to submit." : saveStatus}</span>}
      <button type="button" className="lesson-primary k-lift sd-submit" data-glyph-surface="inverse" disabled={!canSubmit} onClick={submit}><KeatingGlyph name={deliveryError ? "refresh" : "send"} size={13} />{deliveryError ? "Retry submission" : "Submit diagram"}</button>
    </>}>
    <div className="sd-brief"><MarkdownBlock content={node.brief} /></div>

    <div ref={setStage} className="sd-diagram" role="group" aria-label="Your diagram">
      {mermaid ? <MermaidRenderer content={mermaid} htmlLabels={false} decodeEntityLabels chrome="none" controlsHost={roomyHead ? controlsHost : null} className="lesson-stage k-grid lesson-bleed sd-stage" />
        : <div className="lesson-stage k-grid lesson-bleed sd-stage"><EmptyState glyph="shapes" heading="Add a component to begin your diagram." /></div>}
    </div>

    <fieldset disabled={!editable} className="sd-editor">
      <legend className="lesson-sr">Build your diagram</legend>
      <section className="lesson-section">
        <h4 className="lesson-section-title" data-glyph-host><KeatingGlyph name="chip" size={13} />Components<span className="lesson-meta">{graph.components.length}/{MAX_COMPONENTS}</span></h4>
        {!graph.components.length ? <p className="lesson-hint">Add the parts you want to show, then connect them.</p> : null}
        <ol className="lesson-rows sd-components">
          {graph.components.map((component, index) => <li className="sd-component" key={component.id}>
            <span className="lesson-meta sd-index" aria-hidden="true">{index + 1}</span>
            <label className="sd-name"><span className="lesson-sr">Component {index + 1}</span><input maxLength={MAX_LABEL} value={component.label} onChange={event => edit(renameDiagramComponent(graph, component.id, event.currentTarget.value))} /></label>
            <label className="sd-select" data-glyph-host><span className="lesson-sr">Category</span><select value={component.kind} onChange={event => edit(setDiagramComponentKind(graph, component.id, event.currentTarget.value))}>{kinds.map(kind => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}</select><KeatingGlyph name="chev" size={13} /></label>
            <IconButton size="sm" glyph="x" className="sd-remove" label={`Remove ${component.label || `component ${index + 1}`}`} onClick={() => edit(removeDiagramComponent(graph, component.id))} />
          </li>)}
        </ol>
        <button type="button" className="lesson-quiet sd-add" disabled={graph.components.length >= MAX_COMPONENTS} onClick={() => edit(addDiagramComponent(graph, { label: `Component ${graph.components.length + 1}`, kind: kinds[0] }, newId))}><KeatingGlyph name="plus" size={13} />Add component</button>
      </section>

      <section className="lesson-section">
        <h4 className="lesson-section-title" data-glyph-host><KeatingGlyph name="link" size={13} />Connections<span className="lesson-meta">{graph.connections.length}/{MAX_CONNECTIONS}</span></h4>
        {graph.connections.length ? <ul className="lesson-rows sd-connections">{graph.connections.map(connection => <li key={connection.id} data-glyph-host>
          <KeatingGlyph name="link" size={13} />
          <span className="sd-route">{labelOf(connection.from)} <span aria-label="to" className="sd-arrow">→</span> {labelOf(connection.to)}</span>
          {connection.label ? <small className="lesson-meta sd-connection-label">{connection.label}</small> : null}
          <IconButton size="sm" glyph="x" className="sd-remove" label={`Remove connection ${labelOf(connection.from)} to ${labelOf(connection.to)}`} onClick={() => edit(disconnectDiagramConnection(graph, connection.id))} />
        </li>)}</ul> : null}
        <div className="sd-connection-form" data-glyph-host>
          <label className="sd-select" data-glyph-host><span className="lesson-sr">From</span><select value={graph.components.some(item => item.id === from) ? from : ""} onChange={event => setFrom(event.currentTarget.value)}><option value="">From</option>{graph.components.map(component => <option key={component.id} value={component.id}>{component.label}</option>)}</select><KeatingGlyph name="chev" size={13} /></label>
          <KeatingGlyph name="right" size={13} className="sd-arrow-glyph" />
          <label className="sd-select" data-glyph-host><span className="lesson-sr">To</span><select value={graph.components.some(item => item.id === to) ? to : ""} onChange={event => setTo(event.currentTarget.value)}><option value="">To</option>{graph.components.map(component => <option key={component.id} value={component.id}>{component.label}</option>)}</select><KeatingGlyph name="chev" size={13} /></label>
          <label className="sd-label-field"><input aria-label="Connection label (optional)" maxLength={MAX_LABEL} value={connectionLabel} placeholder="Label (optional)" onChange={event => setConnectionLabel(event.currentTarget.value)} /></label>
          <button type="button" className="lesson-quiet sd-connect" disabled={graph.connections.length >= MAX_CONNECTIONS || !graph.components.some(item => item.id === from) || !graph.components.some(item => item.id === to)} onClick={() => {
            edit(connectDiagramComponents(graph, { from, to, label: connectionLabel }, newId)); setConnectionLabel("");
          }}><KeatingGlyph name="link" size={13} />Connect</button>
        </div>
      </section>
    </fieldset>

    {node.diagram.checks.length ? <section className="lesson-section sd-review" aria-label="Structural checks">
      <h4 className="lesson-section-title" data-glyph-host><KeatingGlyph name="verified" size={13} />Structural checks<span className="lesson-meta">{passedChecks}/{node.diagram.checks.length}</span></h4>
      <p className="lesson-hint">These check the diagram's structure. They do not judge your design or block submission.</p>
      <ul className="sd-checks">{node.diagram.checks.map(check => {
        const result = checks.find(item => item.id === check.id);
        return <li key={check.id} className="lesson-status" data-tone={result?.passed ? "ok" : "warn"}><span className="lesson-sr">{result?.passed ? "Present" : "Missing"}: </span><span className="sd-check-copy"><b>{check.label}</b> <span className="sd-check-detail">· {result?.detail ?? "Name each component to update this check."}</span></span></li>;
      })}</ul>
    </section> : null}
    {node.criteria?.length ? <section className="lesson-section sd-review" aria-label="Review criteria">
      <h4 className="lesson-section-title" data-glyph-host><KeatingGlyph name="target" size={13} />Review criteria</h4>
      <ul className="lesson-criteria">{node.criteria.map(criterion => <li key={criterion}><KeatingGlyph name="target" size={13} />{criterion}</li>)}</ul>
    </section> : null}
    <section className="lesson-section">
      <label className="lesson-section-title" data-glyph-host htmlFor={explanationId}><KeatingGlyph name="pen" size={13} />Explain your diagram</label>
      <textarea id={explanationId} disabled={!editable} maxLength={MAX_EXPLANATION} rows={5} value={explanation} placeholder="Explain what the components and connections mean, and any assumptions or decisions behind them." onChange={event => { setExplanation(event.currentTarget.value); setPending(undefined); setDeliveryError(""); setSaveStatus(""); }} />
    </section>
    {storageError ? <p role="alert" className="lesson-status" data-tone="bad">{storageError}</p> : null}
    {deliveryError ? <p role="alert" className="lesson-status" data-tone="bad">{deliveryError}</p> : null}
    {acknowledged && !received ? <p role="alert" className="lesson-status" data-tone="bad">The recorded diagram could not be verified. Its stored checks were not accepted.</p> : null}
  </LessonFrame>;
}
