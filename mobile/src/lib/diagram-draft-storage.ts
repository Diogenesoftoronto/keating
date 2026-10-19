import AsyncStorage from "@react-native-async-storage/async-storage";
import { createEpochDraftStore, type DraftStorage, type DraftWriter } from "./draft-store";
import {
  diagramDraftKey,
  parseDiagramDraftContent,
  type DiagramDraftContent,
  type SystemDesignSpec,
} from "@keating/learner-contracts";

const DIAGRAM_DRAFT_PREFIX = "keating.mobile.diagram-draft.v1";

/** The subset of AsyncStorage used here, so tests can supply an in-memory store. */
export type DiagramDraftStorage = DraftStorage;

/** Same document/revision/node scope as the web draft, under the mobile storage namespace. */
export function mobileDiagramDraftKey(documentId: string, revision: number, nodeId: string): string {
  return `${DIAGRAM_DRAFT_PREFIX}.${diagramDraftKey(documentId, revision, nodeId)}`;
}

export function serializeDiagramDraft(content: DiagramDraftContent): string {
  return JSON.stringify({ version: 1, graph: content.graph, explanation: content.explanation });
}

/** Undefined for anything that is not a draft this exact spec accepts. */
export function parseStoredDiagramDraft(raw: string, spec: SystemDesignSpec): DiagramDraftContent | undefined {
  try { return parseDiagramDraftContent(JSON.parse(raw), spec); } catch { return undefined; }
}

/** Resolves undefined when nothing was saved; rejects when a saved value cannot be trusted. */
export async function loadDiagramDraft(key: string, spec: SystemDesignSpec, storage: DiagramDraftStorage = AsyncStorage): Promise<DiagramDraftContent | undefined> {
  const raw = await storage.getItem(key);
  if (raw === null) return undefined;
  const draft = parseStoredDiagramDraft(raw, spec);
  if (!draft) throw new Error("Saved diagram draft is invalid.");
  return draft;
}

const diagramDrafts = createEpochDraftStore<DiagramDraftContent>(DIAGRAM_DRAFT_PREFIX, serializeDiagramDraft);

export function currentDiagramDraftEpoch(): number {
  return diagramDrafts.currentEpoch();
}

/** Resolves true when written, false when dropped because the writer's epoch is stale or a clear is running. */
export function saveDiagramDraft(key: string, content: DiagramDraftContent, storage: DiagramDraftStorage = AsyncStorage, epoch?: number): Promise<boolean> {
  return diagramDrafts.save(key, content, storage, epoch);
}

export async function clearDiagramDraft(key: string, storage: DiagramDraftStorage = AsyncStorage): Promise<void> {
  await storage.removeItem(key);
}

/** Invalidates every live writer, lets writes already started land, then deletes all diagram drafts. */
export function clearAllDiagramDrafts(storage: DiagramDraftStorage = AsyncStorage): Promise<void> {
  return diagramDrafts.clearAll(storage);
}

export type DiagramDraftWriter = DraftWriter<DiagramDraftContent>;

/** One writer per mounted editor; it is bound to the deletion epoch it was created under. */
export function createDiagramDraftWriter(key: string, storage: DiagramDraftStorage = AsyncStorage): DiagramDraftWriter {
  return diagramDrafts.createWriter(key, storage);
}
