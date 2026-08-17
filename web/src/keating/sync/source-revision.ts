import {
	LEARNER_SYNC_SCHEMA_VERSION,
	MAX_SOURCE_REVISION_BYTES,
	type LearnerSyncSnapshot,
	type SourceRevision,
} from "./contracts";
import { createEncryptedSyncSnapshot, LearnerSyncError, restoreEncryptedSyncPayload } from "./learner-sync";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isSafeRelativePath(value: string): boolean {
	return Boolean(value)
		&& !value.startsWith("/")
		&& !value.startsWith("\\")
		&& !value.includes("\\")
		&& !value.includes("\0")
		&& !value.split("/").some((part) => part === ".." || !part);
}

export interface SourceTreeFile {
	path: string;
	content: string;
}

function normalizeFileSet(files: SourceTreeFile[]): Map<string, string> {
	const normalized = new Map<string, string>();
	for (const file of files) {
		const path = file.path.replace(/^\/+/, "");
		if (!isSafeRelativePath(path) || normalized.has(path)) {
			throw new LearnerSyncError("Source tree contains a duplicate or unsafe path.");
		}
		normalized.set(path, file.content);
	}
	return normalized;
}

function bytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

async function sha256(value: string): Promise<string> {
	const encoded = bytes(value);
	const buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
	const digest = await crypto.subtle.digest("SHA-256", buffer);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashSourceTree(files: SourceTreeFile[]): Promise<string> {
	const normalized = normalizeFileSet(files);
	const entries = await Promise.all([...normalized.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(async ([path, content]) => ({ path, sha256: await sha256(content) })));
	return sha256(JSON.stringify(entries));
}

export async function buildSourceRevision(input: {
	id: string;
	parentId?: string;
	before: SourceTreeFile[];
	after: SourceTreeFile[];
	createdAt?: string;
}): Promise<SourceRevision> {
	const before = normalizeFileSet(input.before);
	const after = normalizeFileSet(input.after);
	const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
	const files = await Promise.all(paths.flatMap((path) => {
		const hadBefore = before.has(path);
		const hasAfter = after.has(path);
		const oldContent = before.get(path) ?? "";
		const newContent = after.get(path) ?? "";
		if (hadBefore === hasAfter && oldContent === newContent) return [];
		return [Promise.all([sha256(oldContent), sha256(newContent)]).then(([beforeSha256, afterSha256]) => ({
			path,
			operation: !hadBefore ? "add" as const : !hasAfter ? "delete" as const : "modify" as const,
			beforeSha256,
			afterSha256,
			patch: createTwoFilesPatch(path, path, oldContent, newContent, "before", "after", { context: 3 }),
		}))];
	}));
	if (files.length === 0) throw new LearnerSyncError("Source revision does not contain any changes.");
	const revision: SourceRevision = {
		schemaVersion: LEARNER_SYNC_SCHEMA_VERSION,
		kind: "keating-source-revision",
		id: input.id,
		parentId: input.parentId,
		parentTreeSha256: await hashSourceTree(input.before),
		resultingTreeSha256: await hashSourceTree(input.after),
		createdAt: input.createdAt ?? new Date().toISOString(),
		files,
	};
	validateSourceRevision(revision);
	return revision;
}

export async function applySourceRevision(currentFiles: SourceTreeFile[], revision: SourceRevision): Promise<SourceTreeFile[]> {
	validateSourceRevision(revision);
	if (await hashSourceTree(currentFiles) !== revision.parentTreeSha256) {
		throw new LearnerSyncError("Source revision parent tree does not match this workspace.");
	}
	const result = normalizeFileSet(currentFiles);
	for (const file of revision.files) {
		const existing = result.get(file.path);
		if (file.operation === "add" && existing !== undefined) {
			throw new LearnerSyncError(`Source revision cannot add existing file ${file.path}.`);
		}
		if (file.operation !== "add" && existing === undefined) {
			throw new LearnerSyncError(`Source revision cannot update missing file ${file.path}.`);
		}
		const before = existing ?? "";
		if (await sha256(before) !== file.beforeSha256) {
			throw new LearnerSyncError(`Source revision base hash does not match ${file.path}.`);
		}
		const patched = applyPatch(before, file.patch, { fuzzFactor: 0 });
		if (patched === false || await sha256(patched) !== file.afterSha256) {
			throw new LearnerSyncError(`Source revision patch failed for ${file.path}.`);
		}
		if (file.operation === "delete") {
			if (patched !== "") throw new LearnerSyncError(`Source revision did not fully delete ${file.path}.`);
			result.delete(file.path);
		} else {
			result.set(file.path, patched);
		}
	}
	const output = [...result.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, content]) => ({ path, content }));
	if (await hashSourceTree(output) !== revision.resultingTreeSha256) {
		throw new LearnerSyncError("Source revision result tree failed its integrity check.");
	}
	return output;
}

/**
 * Validates a revision before encryption or before offering it to a user.
 * This does not apply the patch. The sandbox Git layer must check the parent
 * tree hash and require an explicit user action before applying it.
 */
export function validateSourceRevision(revision: SourceRevision): void {
	const seenPaths = new Set<string>();
	if (
		revision.schemaVersion !== LEARNER_SYNC_SCHEMA_VERSION
		|| revision.kind !== "keating-source-revision"
		|| !revision.id
		|| !SHA256_PATTERN.test(revision.parentTreeSha256)
		|| !SHA256_PATTERN.test(revision.resultingTreeSha256)
		|| !Number.isFinite(Date.parse(revision.createdAt))
		|| !Array.isArray(revision.files)
		|| revision.files.length === 0
	) {
		throw new LearnerSyncError("Source revision metadata is invalid.");
	}
	for (const file of revision.files) {
		if (
			!isSafeRelativePath(file.path)
			|| seenPaths.has(file.path)
			|| !["add", "modify", "delete"].includes(file.operation)
			|| !SHA256_PATTERN.test(file.beforeSha256)
			|| !SHA256_PATTERN.test(file.afterSha256)
			|| !file.patch
		) {
			throw new LearnerSyncError("Source revision contains an invalid file diff.");
		}
		seenPaths.add(file.path);
	}
	if (new TextEncoder().encode(JSON.stringify(revision)).byteLength > MAX_SOURCE_REVISION_BYTES) {
		throw new LearnerSyncError(`Source revisions must not exceed ${MAX_SOURCE_REVISION_BYTES} bytes.`);
	}
}

export async function createSourceRevisionSyncSnapshot(input: {
	revision: SourceRevision;
	namespace: string;
	snapshotId?: string;
	key: CryptoKey;
	keyId?: string;
	generatedAt?: string;
}): Promise<LearnerSyncSnapshot> {
	validateSourceRevision(input.revision);
	return createEncryptedSyncSnapshot({
		payload: input.revision,
		payloadKind: "keating-source-revision",
		namespace: input.namespace,
		snapshotId: input.snapshotId ?? input.revision.id,
		key: input.key,
		keyId: input.keyId,
		generatedAt: input.generatedAt ?? input.revision.createdAt,
	});
}

export async function restoreSourceRevisionSyncSnapshot(snapshot: LearnerSyncSnapshot, key: CryptoKey): Promise<SourceRevision> {
	const value = await restoreEncryptedSyncPayload(snapshot, key, "keating-source-revision");
	if (!value || typeof value !== "object") {
		throw new LearnerSyncError("Source revision payload is invalid.");
	}
	const revision = value as SourceRevision;
	validateSourceRevision(revision);
	return revision;
}
import { applyPatch, createTwoFilesPatch } from "diff";
