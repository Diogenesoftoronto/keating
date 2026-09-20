/** Learner observation/action boundary. Original keys and grading metadata stay executor-only. */
import { createHash } from 'node:crypto';
import { inspectTuiOpenUi } from './benchmark_tui_openui.js';
import { validateUiAction, validateUiActionAgainstDocument, validateUiDocument, type UiDocument } from '../../src/tui/learner-contracts.js';
import { uiDocumentPresentation } from '../../src/tui/ui/render.js';
import type { HarnessV3Result, HarnessV3Step } from './benchmark_harness_v3.js';
import { nativeSurfaceInstruction, type NativeSurface } from './native_surface.js';
import { deliveredNativeSource } from './native_source_document.js';

export function nativeHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export interface AvailableLearnerAction {
  actionId: string; documentId: string; documentRevision: number; nodeId: string;
  type: 'submit-answer' | 'choose-option' | 'update-notes';
  choices?: Array<{ id: string; label: string }>;
}
export interface LearnerObservation {
  schema_version: 1; observationHash: string; step: number;
  visibleText: string;
  documents: Array<{ id: string; revision: number; heading: string; body: string[] }>;
  availableActions: AvailableLearnerAction[];
}
export type LearnerIntent = { kind: 'message'; text: string } | { kind: 'reopen' } | { kind: 'new_session' }
  | { kind: 'stop' } | { kind: 'ui_action'; actionId: string; payload: unknown };
export interface LearnerContext {
  /** The public task and source conversation, identical to the actor's opening. */
  initial_material: string;
  profile_evidence: unknown[]; assumptions: unknown[];
  history: Array<{ observation: LearnerObservation; intent: LearnerIntent }>;
  repair?: string;
}
export interface AdaptiveLearner {
  provenance: { kind: 'authored_policy' | 'model'; model: string; revision: string;
    prompt_sha256?: string; request_contract_sha256?: string };
  next(observation: LearnerObservation, context: LearnerContext, signal: AbortSignal): Promise<unknown>;
}

/** Unsupported machine wrappers are unavailable, including nested/truncated output. */
export function maskUnrenderedActivityMarkup(content: string): string {
  const unavailable = '[An activity could not be presented on this surface.]';
  const input = content.replace(/```(?:keating-ui|openui(?:-json)?)[^\n]*\n[\s\S]*?(?:```|$)/gi, unavailable);
  const parts: string[] = [], stack: string[] = [];
  let cursor = 0;
  for (const match of input.matchAll(/<(\/?)(keating-ui|openui(?:-json)?)\b[^>]*(?:>|$)/gi)) {
    const name = match[2]!.toLowerCase();
    const end = match.index! + match[0].length;
    if (match[1] !== '/') {
      if (!stack.length) { parts.push(input.slice(cursor, match.index), unavailable); }
      if (!match[0].endsWith('/>')) stack.push(name);
      else if (!stack.length) cursor = end;
    } else if (stack.at(-1) === name) {
      stack.pop();
      if (!stack.length) cursor = end;
    }
  }
  if (!stack.length) parts.push(input.slice(cursor));
  return parts.join('');
}

/** Only settled assistant text, rendered document content, and current control IDs cross this boundary. */
export function learnerView(receipt: HarnessV3Result['steps'][number], surface: NativeSurface = 'interactive') {
  nativeSurfaceInstruction(surface);
  const documents = new Map<string, UiDocument>();
  const visibleDocuments: LearnerObservation['documents'] = [];
  const availableActions: AvailableLearnerAction[] = [];
  const text: string[] = [];
  // Reopen has no new message; expose the restored session's last assistant output.
  const messages = receipt.kind === 'reopen' ? receipt.messages.slice().reverse().filter((m: any) => m?.role === 'assistant').slice(0, 1).reverse()
    : receipt.messages.slice(receipt.message_start_index);
  for (const message of messages as any[]) {
    const source = deliveredNativeSource(message);
    if (source) {
      if (source.details.surface !== surface) continue;
      text.push(source.content);
      if (surface === 'interactive') documents.set(source.details.document.id, source.details.document);
      continue;
    }
    if (message?.role !== 'assistant') continue;
    const plain = typeof message.content === 'string' ? message.content :
      (Array.isArray(message.content) ? message.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n') : '');
    const rendered = inspectTuiOpenUi(plain);
    // Invalid/incomplete machine documents must not fall back to raw metadata in a learner view.
    text.push(maskUnrenderedActivityMarkup(rendered.content));
    for (const item of rendered.documents) {
      if (surface === 'chat') { text.push('An activity is unavailable in this chat surface.'); continue; }
      if (item.status !== 'rendered') { text.push('An activity could not be presented on this surface.'); continue; }
      const doc = item.document;
      documents.set(doc.id, doc);
    }
  }
  const resultingDocument = (receipt.action_result as any)?.resultingDocument;
  if (surface === 'interactive' && validateUiDocument(resultingDocument)) documents.set(resultingDocument.id, resultingDocument);
  for (const doc of documents.values()) {
      const presentation = uiDocumentPresentation(doc);
      visibleDocuments.push({ id: doc.id, revision: doc.revision, heading: presentation.heading, body: presentation.body });
      if (doc.lifecycle !== 'ready') continue;
      for (const node of doc.nodes) {
        const type = node.type === 'notes' ? 'update-notes' : node.type === 'question' ?
          (node.kind === 'choice' || node.kind === 'multiple_choice' || node.kind === 'multi_select' ? 'choose-option' : 'submit-answer') : null;
        if (!type) continue;
        availableActions.push({ actionId: `${doc.id}:${doc.revision}:${node.id}:${type}`,
          documentId: doc.id, documentRevision: doc.revision, nodeId: node.id, type,
          ...(node.type === 'question' && node.choices ? { choices: node.choices.map(c => ({ id: c.id, label: c.label })) } : {}) });
      }
  }
  const value = { schema_version: 1 as const, step: receipt.index, visibleText: text.join('\n'), documents: visibleDocuments, availableActions };
  return { observation: { ...value, observationHash: nativeHash(value) }, documents };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).length === expected.length && expected.every(k => k in value);
}
export function resolveLearnerIntent(value: unknown, observation: LearnerObservation, documents: Map<string, UiDocument>, eventId: string):
  { intent: LearnerIntent; step: HarnessV3Step | null } {
  if (!object(value)) throw new Error('Learner intent must be an object');
  if (['stop', 'reopen', 'new_session'].includes(String(value.kind)) && keys(value, ['kind'])) {
    const intent = value as LearnerIntent;
    return { intent, step: value.kind === 'stop' ? null : value as HarnessV3Step };
  }
  if (value.kind === 'message' && keys(value, ['kind', 'text']) && typeof value.text === 'string'
    && value.text.trim() && value.text.length <= 65_536 && !/^\s*[!/]/.test(value.text)) {
    return { intent: value as LearnerIntent, step: value as HarnessV3Step };
  }
  if (value.kind !== 'ui_action' || !keys(value, ['kind', 'actionId', 'payload']) || !object(value.payload)) throw new Error('Unsupported learner intent');
  const control = observation.availableActions.find(a => a.actionId === value.actionId);
  if (!control) throw new Error('Action was not available in the observed document');
  const document = documents.get(control.documentId);
  if (!document || document.revision !== control.documentRevision) throw new Error('Stale document action');
  const field = control.type === 'submit-answer' ? 'answer' : control.type === 'choose-option' ? 'optionIds' : 'value';
  if (!keys(value.payload, [field])) throw new Error('Learner may provide an answer, not a score or execution receipt');
  const action = { schemaVersion: 1, type: control.type, documentId: control.documentId,
    documentRevision: control.documentRevision, nodeId: control.nodeId, idempotencyKey: eventId, ...value.payload };
  if (!validateUiAction(action)) throw new Error('Invalid canonical action payload');
  if (!validateUiActionAgainstDocument(action, document)) throw new Error('Action does not match the delivered document');
  return { intent: value as LearnerIntent, step: { kind: 'ui_action', action, sourceDocument: document } };
}
