import {
  codePointCompare,
  hasOnlyKeys,
  isBoundedArray,
  isBoundedString,
  isContractId,
  isContractTimestamp,
  isRecord,
} from "./validation.js";

export const MOBILE_WORKSPACE_SCHEMA_VERSION = 1 as const;
export const MAX_MOBILE_WORKSPACE_FILES = 64;
export const MAX_MOBILE_WORKSPACE_SOURCE_CHARS = 64 * 1024;
export const MAX_MOBILE_WORKSPACE_CHANGES = 32;
export const MAX_MOBILE_WORKSPACE_TOTAL_CHARS = 512 * 1024;

export type MobileWorkspaceLanguage = "typescript" | "json" | "markdown";
export type MobileWorkspaceCapability =
  | "ui.render"
  | "learner.read"
  | "review.start"
  | "artifact.read"
  | "navigation.open";

export interface MobileWorkspaceFile {
  path: string;
  language: MobileWorkspaceLanguage;
  source: string;
  sha256: string;
}

export interface MobileWorkspaceBase {
  schemaVersion: typeof MOBILE_WORKSPACE_SCHEMA_VERSION;
  kind: "keating-mobile-workspace-base";
  id: string;
  runtimeVersion: string;
  sdkVersion: string;
  createdAt: string;
  treeSha256: string;
  files: MobileWorkspaceFile[];
}

export interface MobileWorkspaceFileChange {
  path: string;
  operation: "add" | "modify" | "delete";
  beforeSha256: string;
  afterSha256: string;
  /** Complete, user-visible source. Null is permitted only for deletion. */
  source: string | null;
}

export interface MobileWorkspaceOverlayCommit {
  schemaVersion: typeof MOBILE_WORKSPACE_SCHEMA_VERSION;
  kind: "keating-mobile-workspace-overlay";
  id: string;
  parentId?: string;
  baseId: string;
  baseTreeSha256: string;
  parentTreeSha256: string;
  resultingTreeSha256: string;
  createdAt: string;
  intent: string;
  requiredCapabilities: MobileWorkspaceCapability[];
  changes: MobileWorkspaceFileChange[];
}

export type MobileWorkspaceActivationStatus = "active" | "rejected" | "rolled-back";

export interface MobileWorkspaceActivationReceipt {
  schemaVersion: typeof MOBILE_WORKSPACE_SCHEMA_VERSION;
  kind: "keating-mobile-workspace-activation";
  id: string;
  baseId: string;
  overlayId?: string;
  previousOverlayId?: string;
  resultingTreeSha256: string;
  createdAt: string;
  status: MobileWorkspaceActivationStatus;
  checks: Array<{
    id: string;
    status: "passed" | "failed";
    message: string;
  }>;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const FILE_KEYS = new Set(["path", "language", "source", "sha256"]);
const BASE_KEYS = new Set(["schemaVersion", "kind", "id", "runtimeVersion", "sdkVersion", "createdAt", "treeSha256", "files"]);
const CHANGE_KEYS = new Set(["path", "operation", "beforeSha256", "afterSha256", "source"]);
const OVERLAY_KEYS = new Set([
  "schemaVersion", "kind", "id", "parentId", "baseId", "baseTreeSha256", "parentTreeSha256",
  "resultingTreeSha256", "createdAt", "intent", "requiredCapabilities", "changes",
]);
const RECEIPT_KEYS = new Set([
  "schemaVersion", "kind", "id", "baseId", "overlayId", "previousOverlayId", "resultingTreeSha256",
  "createdAt", "status", "checks",
]);
const CHECK_KEYS = new Set(["id", "status", "message"]);
const LANGUAGES = new Set<MobileWorkspaceLanguage>(["typescript", "json", "markdown"]);
const CAPABILITIES = new Set<MobileWorkspaceCapability>([
  "ui.render", "learner.read", "review.start", "artifact.read", "navigation.open",
]);
const OPERATIONS = new Set<MobileWorkspaceFileChange["operation"]>(["add", "modify", "delete"]);
const ACTIVATION_STATUSES = new Set<MobileWorkspaceActivationStatus>(["active", "rejected", "rolled-back"]);

export function isSafeMobileWorkspacePath(value: unknown): value is string {
  return typeof value === "string"
    && SAFE_PATH_PATTERN.test(value)
    && !value.startsWith("/")
    && !value.includes("//")
    && !value.split("/").some((part) => part === "." || part === "..");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function validateMobileWorkspaceFile(value: unknown): value is MobileWorkspaceFile {
  return isRecord(value)
    && hasOnlyKeys(value, FILE_KEYS)
    && isSafeMobileWorkspacePath(value.path)
    && LANGUAGES.has(value.language as MobileWorkspaceLanguage)
    && isBoundedString(value.source, MAX_MOBILE_WORKSPACE_SOURCE_CHARS)
    && isSha256(value.sha256);
}

export function validateMobileWorkspaceBase(value: unknown): value is MobileWorkspaceBase {
  if (!isRecord(value) || !hasOnlyKeys(value, BASE_KEYS)
    || value.schemaVersion !== MOBILE_WORKSPACE_SCHEMA_VERSION
    || value.kind !== "keating-mobile-workspace-base"
    || !isContractId(value.id)
    || !isBoundedString(value.runtimeVersion, 128, false)
    || !isBoundedString(value.sdkVersion, 128, false)
    || !isContractTimestamp(value.createdAt)
    || !isSha256(value.treeSha256)
    || !isBoundedArray(value.files, MAX_MOBILE_WORKSPACE_FILES)
    || value.files.length === 0
    || !value.files.every(validateMobileWorkspaceFile)) return false;

  const paths = value.files.map((file) => file.path);
  return new Set(paths).size === paths.length
    && paths.every((path, index) => index === 0 || codePointCompare(paths[index - 1]!, path) < 0)
    && value.files.reduce((total, file) => total + file.source.length, 0) <= MAX_MOBILE_WORKSPACE_TOTAL_CHARS;
}

function validateChange(value: unknown): value is MobileWorkspaceFileChange {
  if (!isRecord(value) || !hasOnlyKeys(value, CHANGE_KEYS)
    || !isSafeMobileWorkspacePath(value.path)
    || !OPERATIONS.has(value.operation as MobileWorkspaceFileChange["operation"])
    || !isSha256(value.beforeSha256)
    || !isSha256(value.afterSha256)) return false;
  if (value.operation === "delete") return value.source === null;
  return isBoundedString(value.source, MAX_MOBILE_WORKSPACE_SOURCE_CHARS);
}

export function validateMobileWorkspaceOverlay(value: unknown): value is MobileWorkspaceOverlayCommit {
  if (!isRecord(value) || !hasOnlyKeys(value, OVERLAY_KEYS)
    || value.schemaVersion !== MOBILE_WORKSPACE_SCHEMA_VERSION
    || value.kind !== "keating-mobile-workspace-overlay"
    || !isContractId(value.id)
    || (value.parentId !== undefined && !isContractId(value.parentId))
    || !isContractId(value.baseId)
    || !isSha256(value.baseTreeSha256)
    || !isSha256(value.parentTreeSha256)
    || !isSha256(value.resultingTreeSha256)
    || !isContractTimestamp(value.createdAt)
    || !isBoundedString(value.intent, 4096, false)
    || !isBoundedArray(value.requiredCapabilities, CAPABILITIES.size)
    || !value.requiredCapabilities.every((capability) => CAPABILITIES.has(capability as MobileWorkspaceCapability))
    || new Set(value.requiredCapabilities).size !== value.requiredCapabilities.length
    || !isBoundedArray(value.changes, MAX_MOBILE_WORKSPACE_CHANGES)
    || value.changes.length === 0
    || !value.changes.every(validateChange)) return false;

  const paths = value.changes.map((change) => change.path);
  return new Set(paths).size === paths.length
    && paths.every((path, index) => index === 0 || codePointCompare(paths[index - 1]!, path) < 0)
    && value.changes.reduce((total, change) => total + (change.source?.length ?? 0), 0) <= MAX_MOBILE_WORKSPACE_TOTAL_CHARS;
}

export function validateMobileWorkspaceActivationReceipt(value: unknown): value is MobileWorkspaceActivationReceipt {
  if (!isRecord(value) || !hasOnlyKeys(value, RECEIPT_KEYS)
    || value.schemaVersion !== MOBILE_WORKSPACE_SCHEMA_VERSION
    || value.kind !== "keating-mobile-workspace-activation"
    || !isContractId(value.id)
    || !isContractId(value.baseId)
    || (value.overlayId !== undefined && !isContractId(value.overlayId))
    || (value.previousOverlayId !== undefined && !isContractId(value.previousOverlayId))
    || !isSha256(value.resultingTreeSha256)
    || !isContractTimestamp(value.createdAt)
    || !ACTIVATION_STATUSES.has(value.status as MobileWorkspaceActivationStatus)
    || !isBoundedArray(value.checks, 32)
    || value.checks.length === 0) return false;

  const ids = new Set<string>();
  const validChecks = value.checks.every((check) => {
    if (!isRecord(check) || !hasOnlyKeys(check, CHECK_KEYS) || !isContractId(check.id)
      || ids.has(check.id as string) || (check.status !== "passed" && check.status !== "failed")
      || !isBoundedString(check.message, 1024, false)) return false;
    ids.add(check.id as string);
    return true;
  });
  const checks = value.checks as Array<{ status: "passed" | "failed" }>;
  const hasFailure = checks.some((check) => check.status === "failed");
  return validChecks && (value.status === "rejected" ? hasFailure : !hasFailure);
}
