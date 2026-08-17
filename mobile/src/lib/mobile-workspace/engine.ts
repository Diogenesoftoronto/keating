import {
  MOBILE_WORKSPACE_SCHEMA_VERSION,
  validateMobileWorkspaceOverlay,
  type MobileWorkspaceActivationReceipt,
  type MobileWorkspaceBase,
  type MobileWorkspaceCapability,
  type MobileWorkspaceFile,
  type MobileWorkspaceFileChange,
  type MobileWorkspaceOverlayCommit,
} from "@keating/learner-contracts";
import { DEFAULT_MOBILE_PROGRAM, MOBILE_PROGRAM_ENTRYPOINT, parseMobileWorkspaceProgram } from "./program";
import type { MobileWorkspaceRepository, MobileWorkspaceState } from "./repository";

export type Sha256 = (value: string) => Promise<string>;
export type Clock = () => string;
export type IdFactory = (prefix: string) => string;

export interface MobileWorkspaceEngineOptions {
  sha256: Sha256;
  now?: Clock;
  createId?: IdFactory;
  runtimeVersion?: string;
  sdkVersion?: string;
}

export interface MobileWorkspaceProposal {
  intent: string;
  requiredCapabilities: MobileWorkspaceCapability[];
  changes: Array<{ path: string; source: string | null }>;
}

const DELETE_DIGEST_SOURCE = "";

function languageForPath(path: string): MobileWorkspaceFile["language"] {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  return "typescript";
}

function sortedFiles(files: Iterable<MobileWorkspaceFile>): MobileWorkspaceFile[] {
  return [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

async function treeDigest(files: readonly MobileWorkspaceFile[], sha256: Sha256): Promise<string> {
  return sha256(JSON.stringify(files.map(({ path, language, sha256: digest }) => [path, language, digest])));
}

async function makeFiles(sources: Readonly<Record<string, string>>, sha256: Sha256): Promise<MobileWorkspaceFile[]> {
  const files = await Promise.all(Object.entries(sources).map(async ([path, source]) => ({
    path, language: languageForPath(path), source, sha256: await sha256(source),
  })));
  return sortedFiles(files);
}

function defaultId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class MobileWorkspaceEngine {
  private readonly now: Clock;
  private readonly createId: IdFactory;
  private readonly runtimeVersion: string;
  private readonly sdkVersion: string;

  constructor(private readonly repository: MobileWorkspaceRepository, private readonly options: MobileWorkspaceEngineOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? defaultId;
    this.runtimeVersion = options.runtimeVersion ?? "mobile-v1";
    this.sdkVersion = options.sdkVersion ?? "keating-mobile-sdk-v1";
  }

  async initialize(): Promise<MobileWorkspaceState> {
    const existing = await this.repository.read();
    if (existing) {
      await this.verifyStoredState(existing);
      return existing;
    }
    const source = `${JSON.stringify(DEFAULT_MOBILE_PROGRAM, null, 2)}\n`;
    const files = await makeFiles({ [MOBILE_PROGRAM_ENTRYPOINT]: source }, this.options.sha256);
    const base: MobileWorkspaceBase = {
      schemaVersion: MOBILE_WORKSPACE_SCHEMA_VERSION,
      kind: "keating-mobile-workspace-base",
      id: this.createId("base"),
      runtimeVersion: this.runtimeVersion,
      sdkVersion: this.sdkVersion,
      createdAt: this.now(),
      treeSha256: await treeDigest(files, this.options.sha256),
      files,
    };
    const state: MobileWorkspaceState = { base, files, overlays: [], receipts: [] };
    await this.repository.replace(state);
    return state;
  }

  read(): Promise<MobileWorkspaceState | null> { return this.repository.read(); }

  async propose(proposal: MobileWorkspaceProposal, overlayId = this.createId("overlay")): Promise<MobileWorkspaceOverlayCommit> {
    const state = await this.initialize();
    if (!proposal.intent.trim() || proposal.changes.length < 1) throw new Error("A workspace proposal needs an intent and at least one change.");
    const existing = state.overlays.find((overlay) => overlay.id === overlayId);
    if (existing) {
      const sameProposal = existing.intent === proposal.intent.trim()
        && JSON.stringify(existing.requiredCapabilities) === JSON.stringify([...proposal.requiredCapabilities].sort())
        && JSON.stringify(existing.changes.map(({ path, source }) => ({ path, source })))
          === JSON.stringify([...proposal.changes].sort((a, b) => a.path < b.path ? -1 : 1));
      if (!sameProposal) throw new Error(`Workspace proposal id ${overlayId} already belongs to different content.`);
      return existing;
    }
    const current = new Map(state.files.map((file) => [file.path, file]));
    const changes: MobileWorkspaceFileChange[] = [];
    for (const proposed of [...proposal.changes].sort((a, b) => a.path < b.path ? -1 : 1)) {
      const before = current.get(proposed.path);
      if (proposed.source === null) {
        if (!before) throw new Error(`Cannot delete missing workspace file ${proposed.path}.`);
        changes.push({ path: proposed.path, operation: "delete", beforeSha256: before.sha256, afterSha256: await this.options.sha256(DELETE_DIGEST_SOURCE), source: null });
        current.delete(proposed.path);
      } else {
        const afterSha256 = await this.options.sha256(proposed.source);
        changes.push({ path: proposed.path, operation: before ? "modify" : "add", beforeSha256: before?.sha256 ?? await this.options.sha256(DELETE_DIGEST_SOURCE), afterSha256, source: proposed.source });
        current.set(proposed.path, { path: proposed.path, language: languageForPath(proposed.path), source: proposed.source, sha256: afterSha256 });
      }
    }
    const overlay: MobileWorkspaceOverlayCommit = {
      schemaVersion: MOBILE_WORKSPACE_SCHEMA_VERSION,
      kind: "keating-mobile-workspace-overlay",
      id: overlayId,
      ...(state.activeOverlayId ? { parentId: state.activeOverlayId } : {}),
      baseId: state.base.id,
      baseTreeSha256: state.base.treeSha256,
      parentTreeSha256: await treeDigest(state.files, this.options.sha256),
      resultingTreeSha256: await treeDigest(sortedFiles(current.values()), this.options.sha256),
      createdAt: this.now(),
      intent: proposal.intent.trim(),
      requiredCapabilities: [...proposal.requiredCapabilities].sort(),
      changes,
    };
    if (!validateMobileWorkspaceOverlay(overlay)) throw new Error("Workspace proposal failed the shared overlay contract.");
    await this.repository.replace({ ...state, overlays: [...state.overlays, overlay] });
    return overlay;
  }

  async activate(overlayId: string): Promise<MobileWorkspaceActivationReceipt> {
    const state = await this.initialize();
    const overlay = state.overlays.find((entry) => entry.id === overlayId);
    if (!overlay) throw new Error(`Unknown workspace overlay ${overlayId}.`);
    const checks: MobileWorkspaceActivationReceipt["checks"] = [];
    const fail = (id: string, message: string) => checks.push({ id, status: "failed" as const, message });
    const pass = (id: string, message: string) => checks.push({ id, status: "passed" as const, message });
    if (overlay.baseId !== state.base.id || overlay.baseTreeSha256 !== state.base.treeSha256) fail("base-match", "Overlay targets a different base workspace.");
    else pass("base-match", "Overlay matches the installed base workspace.");
    const currentTree = await treeDigest(state.files, this.options.sha256);
    if (overlay.parentId !== state.activeOverlayId || overlay.parentTreeSha256 !== currentTree) fail("parent-match", "Overlay parent does not match the active workspace head.");
    else pass("parent-match", "Overlay parent matches the active workspace head.");

    const next = new Map(state.files.map((file) => [file.path, file]));
    for (const change of overlay.changes) {
      const before = next.get(change.path);
      const expectedBefore = before?.sha256 ?? await this.options.sha256(DELETE_DIGEST_SOURCE);
      if (expectedBefore !== change.beforeSha256) { fail("content-hashes", `Before hash mismatch for ${change.path}.`); break; }
      if (change.source === null) next.delete(change.path);
      else {
        const actualAfter = await this.options.sha256(change.source);
        if (actualAfter !== change.afterSha256) { fail("content-hashes", `After hash mismatch for ${change.path}.`); break; }
        next.set(change.path, { path: change.path, language: languageForPath(change.path), source: change.source, sha256: actualAfter });
      }
    }
    if (!checks.some((check) => check.id === "content-hashes" && check.status === "failed")) pass("content-hashes", "All changed file hashes match their visible source.");
    const nextFiles = sortedFiles(next.values());
    const resultingTree = await treeDigest(nextFiles, this.options.sha256);
    if (resultingTree !== overlay.resultingTreeSha256) fail("tree-hash", "Resulting workspace tree hash does not match the proposal.");
    else pass("tree-hash", "Resulting workspace tree hash matches the proposal.");
    try {
      const entry = next.get(MOBILE_PROGRAM_ENTRYPOINT);
      if (!entry) throw new Error(`${MOBILE_PROGRAM_ENTRYPOINT} cannot be deleted.`);
      parseMobileWorkspaceProgram(entry.source);
      pass("program-schema", "Entrypoint uses the bounded mobile component schema.");
    } catch (error) { fail("program-schema", error instanceof Error ? error.message : "Invalid mobile workspace program."); }

    const rejected = checks.some((check) => check.status === "failed");
    const receipt: MobileWorkspaceActivationReceipt = {
      schemaVersion: MOBILE_WORKSPACE_SCHEMA_VERSION,
      kind: "keating-mobile-workspace-activation",
      id: this.createId("activation"), baseId: state.base.id, overlayId,
      ...(state.activeOverlayId ? { previousOverlayId: state.activeOverlayId } : {}),
      resultingTreeSha256: rejected ? currentTree : resultingTree,
      createdAt: this.now(), status: rejected ? "rejected" : "active", checks,
    };
    await this.repository.replace(rejected
      ? { ...state, receipts: [...state.receipts, receipt] }
      : { ...state, activeOverlayId: overlay.id, files: nextFiles, receipts: [...state.receipts, receipt] });
    return receipt;
  }

  async rollback(): Promise<MobileWorkspaceActivationReceipt> {
    const state = await this.initialize();
    if (!state.activeOverlayId) throw new Error("The mobile workspace is already on its base version.");
    const active = state.overlays.find((overlay) => overlay.id === state.activeOverlayId)!;
    const targetOverlayId = active.parentId;
    const files = targetOverlayId
      ? await this.materializeThrough(state, targetOverlayId)
      : state.base.files.map((file) => ({ ...file }));
    const receipt: MobileWorkspaceActivationReceipt = {
      schemaVersion: MOBILE_WORKSPACE_SCHEMA_VERSION, kind: "keating-mobile-workspace-activation",
      id: this.createId("rollback"), baseId: state.base.id, overlayId: state.activeOverlayId,
      ...(targetOverlayId ? { previousOverlayId: targetOverlayId } : {}),
      resultingTreeSha256: await treeDigest(files, this.options.sha256), createdAt: this.now(),
      status: "rolled-back", checks: [{ id: "rollback-tree", status: "passed", message: "Restored the previous validated workspace tree." }],
    };
    await this.repository.replace({ ...state, ...(targetOverlayId ? { activeOverlayId: targetOverlayId } : { activeOverlayId: undefined }), files, receipts: [...state.receipts, receipt] });
    return receipt;
  }

  private async materializeThrough(state: MobileWorkspaceState, overlayId: string): Promise<MobileWorkspaceFile[]> {
    const chain: MobileWorkspaceOverlayCommit[] = [];
    let cursor: string | undefined = overlayId;
    while (cursor) {
      const overlay = state.overlays.find((candidate) => candidate.id === cursor);
      if (!overlay) throw new Error(`Workspace history is missing overlay ${cursor}.`);
      chain.unshift(overlay); cursor = overlay.parentId;
    }
    const files = new Map(state.base.files.map((file) => [file.path, { ...file }]));
    for (const overlay of chain) for (const change of overlay.changes) {
      if (change.source === null) files.delete(change.path);
      else files.set(change.path, { path: change.path, language: languageForPath(change.path), source: change.source, sha256: change.afterSha256 });
    }
    return sortedFiles(files.values());
  }

  private async verifyStoredState(state: MobileWorkspaceState): Promise<void> {
    for (const file of state.base.files) {
      if (await this.options.sha256(file.source) !== file.sha256) throw new Error(`Stored base source hash mismatch for ${file.path}.`);
    }
    if (await treeDigest(state.base.files, this.options.sha256) !== state.base.treeSha256) {
      throw new Error("Stored base workspace tree hash mismatch.");
    }
    for (const file of state.files) {
      if (await this.options.sha256(file.source) !== file.sha256) throw new Error(`Stored active source hash mismatch for ${file.path}.`);
    }
    const activeTree = await treeDigest(state.files, this.options.sha256);
    const expectedTree = state.activeOverlayId
      ? state.overlays.find((overlay) => overlay.id === state.activeOverlayId)?.resultingTreeSha256
      : state.base.treeSha256;
    if (!expectedTree || activeTree !== expectedTree) throw new Error("Stored active workspace tree does not match its recorded head.");
    const entrypoint = state.files.find((file) => file.path === MOBILE_PROGRAM_ENTRYPOINT);
    if (!entrypoint) throw new Error(`Stored workspace is missing ${MOBILE_PROGRAM_ENTRYPOINT}.`);
    parseMobileWorkspaceProgram(entrypoint.source);
  }
}
