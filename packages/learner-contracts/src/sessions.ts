import { compareContractTimestamps, hasOnlyKeys, isBoundedArray, isBoundedString, isContractId, isContractTimestamp } from "./validation.js";
import { validateAgentStream, type AgentStreamEvent } from "./stream.js";

export type LearnerMessageRole = "user" | "assistant" | "tool" | "system";

/**
 * Portable transcript provenance for a locally stored composer attachment.
 * The native URI and any byte payload stay in the owning surface's local store.
 */
export interface LearnerMessageAttachment {
  id: string;
  kind: "image" | "document";
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface LearnerMessage {
  id: string;
  role: LearnerMessageRole;
  content: string;
  createdAt: string;
  /** A provider-neutral correlation id for a streamed turn. */
  turnId?: string;
  /** References a tool call rather than serializing provider-specific metadata. */
  toolCallId?: string;
  /** User-provided attachment provenance; never a URI, path, or byte payload. */
  attachments?: LearnerMessageAttachment[];
  /** Provider-neutral, ordered reasoning/tool/UI trace for this assistant turn. */
  agentEvents?: AgentStreamEvent[];
}

export interface LearnerBranch {
  id: string;
  sessionId: string;
  parentBranchId?: string;
  forkedFromMessageId?: string;
  createdAt: string;
  updatedAt: string;
  title?: string;
}

export interface LearnerSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** A fork keeps a source session, with an optional exact source message, instead of duplicating hidden history. */
  parentSessionId?: string;
  forkedFromMessageId?: string;
  activeBranchId: string;
  branches: LearnerBranch[];
  messages: LearnerMessage[];
  model?: {
    provider: string;
    id: string;
    name?: string;
  };
}

const MESSAGE_ROLES = new Set<LearnerMessageRole>(["user", "assistant", "tool", "system"]);
const MESSAGE_KEYS = new Set(["id", "role", "content", "createdAt", "turnId", "toolCallId", "attachments", "agentEvents"]);
const MESSAGE_ATTACHMENT_KEYS = new Set(["id", "kind", "name", "mimeType", "sizeBytes"]);
const BRANCH_KEYS = new Set(["id", "sessionId", "parentBranchId", "forkedFromMessageId", "createdAt", "updatedAt", "title"]);
const SESSION_KEYS = new Set(["id", "title", "createdAt", "updatedAt", "parentSessionId", "forkedFromMessageId", "activeBranchId", "branches", "messages", "model"]);
const MODEL_KEYS = new Set(["provider", "id", "name"]);
const MAX_BRANCHES = 256;
const MAX_MESSAGES = 10_000;
const MAX_MESSAGE_CONTENT = 65_536;
const MAX_TITLE_LENGTH = 512;
const MAX_MESSAGE_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const ATTACHMENT_KINDS = new Set<LearnerMessageAttachment["kind"]>(["image", "document"]);
const MIME_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,127}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,127}$/;

function isPortableAttachmentName(value: unknown): value is string {
  return isBoundedString(value, MAX_TITLE_LENGTH, false)
    && !/[\\/]/.test(value)
    && !/^(?:file|content|data|blob):/i.test(value);
}

function validateLearnerMessageAttachment(value: unknown): value is LearnerMessageAttachment {
  if (!hasOnlyKeys(value, MESSAGE_ATTACHMENT_KEYS)) return false;
  const attachment = value as Partial<LearnerMessageAttachment>;
  return isContractId(attachment.id)
    && ATTACHMENT_KINDS.has(attachment.kind as LearnerMessageAttachment["kind"])
    && isPortableAttachmentName(attachment.name)
    && isBoundedString(attachment.mimeType, 256, false) && MIME_TYPE_PATTERN.test(attachment.mimeType)
    && typeof attachment.sizeBytes === "number" && Number.isSafeInteger(attachment.sizeBytes)
    && attachment.sizeBytes > 0 && attachment.sizeBytes <= MAX_ATTACHMENT_BYTES;
}

function hasOrderedTimestamps(createdAt: unknown, updatedAt: unknown): boolean {
  return isContractTimestamp(createdAt) && isContractTimestamp(updatedAt)
    && compareContractTimestamps(updatedAt, createdAt) >= 0;
}

export function validateLearnerMessage(value: unknown): value is LearnerMessage {
  if (!hasOnlyKeys(value, MESSAGE_KEYS)) return false;
  const message = value as Partial<LearnerMessage>;
  if (!isContractId(message.id)
    || !isBoundedString(message.content, MAX_MESSAGE_CONTENT)
    || !MESSAGE_ROLES.has(message.role as LearnerMessageRole)
    || !isContractTimestamp(message.createdAt)
    || (message.turnId !== undefined && !isContractId(message.turnId))
    || (message.toolCallId !== undefined && !isContractId(message.toolCallId))) return false;
  if (message.agentEvents !== undefined && (message.role !== "assistant" || !validateAgentStream(message.agentEvents))) return false;
  if (message.attachments === undefined) return true;
  if (message.role !== "user" || !isBoundedArray(message.attachments, MAX_MESSAGE_ATTACHMENTS)) return false;
  const attachmentIds = new Set<string>();
  let totalBytes = 0;
  return message.attachments.every((attachment) => {
    if (!validateLearnerMessageAttachment(attachment) || attachmentIds.has(attachment.id)) return false;
    attachmentIds.add(attachment.id);
    totalBytes += attachment.sizeBytes;
    return totalBytes <= MAX_TOTAL_ATTACHMENT_BYTES;
  });
}

export function validateLearnerBranch(value: unknown, sessionId?: string): value is LearnerBranch {
  if (!hasOnlyKeys(value, BRANCH_KEYS)) return false;
  const branch = value as Partial<LearnerBranch>;
  return isContractId(branch.id)
    && isContractId(branch.sessionId)
    && (!sessionId || branch.sessionId === sessionId)
    && hasOrderedTimestamps(branch.createdAt, branch.updatedAt)
    && (branch.parentBranchId === undefined || isContractId(branch.parentBranchId))
    && (branch.forkedFromMessageId === undefined || isContractId(branch.forkedFromMessageId))
    && (branch.title === undefined || isBoundedString(branch.title, MAX_TITLE_LENGTH, false));
}

export function validateLearnerSession(value: unknown): value is LearnerSession {
  if (!hasOnlyKeys(value, SESSION_KEYS)) return false;
  const session = value as Partial<LearnerSession>;
  if (!isContractId(session.id) || !isBoundedString(session.title, MAX_TITLE_LENGTH, false)
    || !hasOrderedTimestamps(session.createdAt, session.updatedAt)
    || !isContractId(session.activeBranchId)
    || !isBoundedArray(session.branches, MAX_BRANCHES)
    || !isBoundedArray(session.messages, MAX_MESSAGES)) return false;
  if ((session.forkedFromMessageId !== undefined && session.parentSessionId === undefined)
    || (session.parentSessionId !== undefined && !isContractId(session.parentSessionId))
    || (session.forkedFromMessageId !== undefined && !isContractId(session.forkedFromMessageId))) return false;
  if (session.model !== undefined) {
    if (!hasOnlyKeys(session.model, MODEL_KEYS) || !isBoundedString(session.model.provider, 128, false)
      || !isBoundedString(session.model.id, 256, false)
      || (session.model.name !== undefined && !isBoundedString(session.model.name, MAX_TITLE_LENGTH, false))) return false;
  }

  const branchIds = new Set<string>();
  for (const branch of session.branches) {
    if (!validateLearnerBranch(branch, session.id) || branchIds.has(branch.id)) return false;
    branchIds.add(branch.id);
  }
  if (!branchIds.has(session.activeBranchId)) return false;
  if (session.branches.some((branch) => branch.parentBranchId && !branchIds.has(branch.parentBranchId))) return false;
  for (const branch of session.branches) {
    const visited = new Set<string>();
    let cursor: LearnerBranch | undefined = branch;
    while (cursor?.parentBranchId) {
      if (visited.has(cursor.id)) return false;
      visited.add(cursor.id);
      cursor = session.branches.find((candidate) => candidate.id === cursor?.parentBranchId);
    }
  }

  const messageIds = new Set<string>();
  for (const message of session.messages) {
    if (!validateLearnerMessage(message) || messageIds.has(message.id)) return false;
    messageIds.add(message.id);
  }
  return session.branches.every((branch) => !branch.forkedFromMessageId || messageIds.has(branch.forkedFromMessageId));
}
