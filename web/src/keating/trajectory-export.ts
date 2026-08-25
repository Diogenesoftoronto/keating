import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { strToU8, zipSync, type Zippable } from "fflate";
import { REDACTED, redactSecrets, redactString } from "./security/redaction";
import { reviewArtifactDisplayText } from "./trajectory-artifacts";
import {
	messageReviewAnchor,
	reviewMessageText,
	type ReviewGenerationCandidate,
	type ReviewGenerationProvenance,
	type ReviewGenerationPoolSnapshot,
	type ReviewModelPool,
	type StoredModelReference,
} from "./trajectory-review";
import type { TrajectoryReviewSnapshot } from "./trajectory-store";

export const TRAJECTORY_REVIEW_ARCHIVE_SCHEMA_VERSION = 1 as const;

export interface TrajectoryReviewExportSession {
	id: string;
	title?: string;
	messages: readonly AgentMessage[];
	/** The system prompt used for the session when it is not stored as a message. */
	systemPrompt?: string;
}

export interface TrajectoryReviewArchiveInput {
	snapshot: TrajectoryReviewSnapshot;
	session?: TrajectoryReviewExportSession;
}

export interface TrajectoryReviewArchiveOptions {
	now?: number;
}

export interface TrajectoryReviewArchiveFile {
	path: string;
	purpose: string;
	records?: number;
}

export interface TrajectoryReviewArchiveManifest {
	schemaVersion: typeof TRAJECTORY_REVIEW_ARCHIVE_SCHEMA_VERSION;
	kind: "keating-trajectory-review-archive";
	generatedAt: string;
	redactionEnabled: true;
	recommendedDataset: string;
	review: {
		status: "draft" | "final";
		verdict: string;
	};
	counts: {
		annotations: number;
		finalAnnotations: number;
		capturedArtifacts: number;
		responseCandidates: number;
		artifactCandidates: number;
		approvedCorrections: number;
		approvedArtifactRevisions: number;
		chatmlLines: number;
		alpacaLines: number;
		dpoChatLines: number;
		dpoTextLines: number;
		ktoLines: number;
		redactions: number;
		skippedApprovedCandidates: number;
	};
	warnings: string[];
	files: TrajectoryReviewArchiveFile[];
}

export interface TrajectoryReviewArchive {
	bytes: Uint8Array;
	filename: string;
	manifest: TrajectoryReviewArchiveManifest;
	files: TrajectoryReviewArchiveFile[];
}

interface ArchiveFile extends TrajectoryReviewArchiveFile {
	content: string;
}

type ExportMessageRole = "system" | "user" | "assistant" | "tool";

interface ExportMessage {
	role: ExportMessageRole;
	content: string;
}

interface RedactionCounter {
	count: number;
}

interface ApprovedCandidate {
	candidate: ReviewGenerationCandidate;
	pool?: ReviewModelPool;
}

interface CandidateProvenance {
	candidateId: string;
	reviewId: string;
	sessionId: string;
	targetKey: string;
	annotationIds: string[];
	pool: {
		id: string;
		name?: string;
		snapshot?: ReviewGenerationPoolSnapshot;
	};
	model: StoredModelReference;
	pricingUsdPerMillionTokens: StoredModelReference["cost"];
	usage?: ReviewGenerationCandidate["usage"];
	costUsd?: number;
	cost: ReviewGenerationProvenance["cost"];
	generation?: ReviewGenerationProvenance;
}

const DATA_PATHS = {
	raw: "data/reviews/trajectory-reviews.jsonl",
	chatml: "data/sft/review-corrections.chatml.jsonl",
	alpaca: "data/sft/review-corrections.alpaca.jsonl",
	dpoChat: "data/preferences/review.dpo.chat.jsonl",
	dpoText: "data/preferences/review.dpo.text.jsonl",
	kto: "data/preferences/review.kto.jsonl",
	artifactRevisions: "data/artifacts/review-revisions.jsonl",
} as const;

function redactValue<T>(value: T, counter: RedactionCounter): T {
	if (typeof value === "string") {
		const redacted = redactString(value);
		if (redacted !== value) counter.count += 1;
		return redacted as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactValue(item, counter)) as T;
	}
	if (value && typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			output[key] = redactValue(item, counter);
		}
		return output as T;
	}
	return value;
}

function sortJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJsonValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, sortJsonValue(item)]),
	);
}

function jsonLine(value: unknown, counter: RedactionCounter): string {
	return `${JSON.stringify(sortJsonValue(redactValue(value, counter)))}\n`;
}

function jsonLines(values: readonly unknown[], counter: RedactionCounter): string {
	return values.map((value) => jsonLine(value, counter)).join("");
}

function lineCount(content: string): number {
	return content.trim() ? content.trim().split("\n").length : 0;
}

function countStructuralRedactions(original: unknown, redacted: unknown): number {
	if (redacted === REDACTED && original !== REDACTED) return 1;
	if (Array.isArray(original) && Array.isArray(redacted)) {
		return original.reduce((count, item, index) => count + countStructuralRedactions(item, redacted[index]), 0);
	}
	if (original && redacted && typeof original === "object" && typeof redacted === "object") {
		return Object.entries(original as Record<string, unknown>).reduce(
			(count, [key, item]) => count + countStructuralRedactions(item, (redacted as Record<string, unknown>)[key]),
			0,
		);
	}
	return 0;
}

function redactOpaqueValue<T>(value: T, counter: RedactionCounter): T {
	const redacted = redactSecrets(value) as T;
	counter.count += countStructuralRedactions(value, redacted);
	return redacted;
}

function compareRecords(left: { createdAt?: number; id: string }, right: { createdAt?: number; id: string }): number {
	return (left.createdAt ?? 0) - (right.createdAt ?? 0) || left.id.localeCompare(right.id);
}

function normalizedRawSnapshot(snapshot: TrajectoryReviewSnapshot, counter: RedactionCounter): TrajectoryReviewSnapshot {
	return {
		...snapshot,
		annotations: [...snapshot.annotations].sort(compareRecords),
		candidates: [...snapshot.candidates].sort(compareRecords),
		modelPools: [...snapshot.modelPools].sort((left, right) => left.id.localeCompare(right.id)),
		artifacts: [...snapshot.artifacts]
			.sort(compareRecords)
			.map((artifact) => artifact.metadata
				? { ...artifact, metadata: redactOpaqueValue(artifact.metadata, counter) }
				: artifact),
	};
}

function candidateCostUsd(candidate: ReviewGenerationCandidate): number | undefined {
	if (candidate.generation) {
		return candidate.generation.cost.known ? candidate.generation.cost.usd : undefined;
	}
	if (typeof candidate.usage?.costUsd === "number") return candidate.usage.costUsd;
	const inputTokens = candidate.usage?.inputTokens;
	const outputTokens = candidate.usage?.outputTokens;
	if (typeof inputTokens !== "number" && typeof outputTokens !== "number") return undefined;
	return (
		((inputTokens ?? 0) * candidate.model.cost.input)
		+ ((outputTokens ?? 0) * candidate.model.cost.output)
	) / 1_000_000;
}

function candidateProvenance(
	approved: ApprovedCandidate,
	finalAnnotationIds: ReadonlySet<string>,
): CandidateProvenance {
	const { candidate, pool } = approved;
	const runPool = candidate.generation?.run.pool;
	const model = candidate.generation?.run.requestedModel ?? candidate.model;
	const costUsd = candidateCostUsd(candidate);
	return {
		candidateId: candidate.id,
		reviewId: candidate.reviewId,
		sessionId: candidate.sessionId,
		targetKey: candidate.targetKey,
		annotationIds: candidate.annotationIds.filter((id) => finalAnnotationIds.has(id)).sort(),
		pool: {
			id: runPool?.id ?? candidate.poolId,
			name: runPool?.name ?? pool?.name,
			snapshot: runPool,
		},
		model,
		pricingUsdPerMillionTokens: model.cost,
		usage: candidate.usage,
		costUsd,
		cost: candidate.generation?.cost ?? {
			known: costUsd !== undefined,
			usd: costUsd,
			provenance: typeof candidate.usage?.costUsd === "number" ? "stream-usage" : costUsd !== undefined ? "catalog-rates" : "unknown",
		},
		generation: candidate.generation,
	};
}

function approvedCandidates(snapshot: TrajectoryReviewSnapshot): ApprovedCandidate[] {
	if (snapshot.review.status !== "final") return [];
	const pools = new Map(snapshot.modelPools.map((pool) => [pool.id, pool]));
	const candidates = new Map(snapshot.candidates.map((candidate) => [candidate.id, candidate]));
	const seen = new Set<string>();
	const approved: ApprovedCandidate[] = [];
	for (const [targetKey, candidateId] of Object.entries(snapshot.review.selectedCandidateIds).sort()) {
		const candidate = candidates.get(candidateId);
		if (
			!candidate
			|| seen.has(candidate.id)
			|| candidate.targetKey !== targetKey
			|| candidate.state !== "completed"
			|| !candidate.preferred
			|| !candidate.content?.trim()
		) continue;
		seen.add(candidate.id);
		approved.push({ candidate, pool: pools.get(candidate.poolId) });
	}
	return approved.sort((left, right) => compareRecords(left.candidate, right.candidate));
}

function exportRole(role: unknown): ExportMessageRole {
	if (role === "system" || role === "user" || role === "assistant") return role;
	if (role === "tool" || role === "toolResult") return "tool";
	return "user";
}

function promptForCandidate(
	session: TrajectoryReviewExportSession | undefined,
	candidate: ReviewGenerationCandidate,
): ExportMessage[] | null {
	if (candidate.target.kind !== "response" || !session || session.id !== candidate.sessionId) return null;
	const responseTarget = candidate.target;
	const indexed = session.messages.map((message, index) => ({
		message,
		index,
		anchor: messageReviewAnchor(session.id, message, index),
	}));
	let target = indexed.find((entry) => entry.anchor.id === responseTarget.messageId);
	if (!target) {
		const contentMatches = indexed.filter((entry) =>
			entry.anchor.role === "assistant"
			&& (responseTarget.messageTimestamp === undefined || entry.anchor.timestamp === responseTarget.messageTimestamp)
			&& entry.anchor.text === responseTarget.originalContent.trim(),
		);
		if (contentMatches.length === 1) [target] = contentMatches;
	}
	if (!target || target.anchor.role !== "assistant") return null;

	const prompt: ExportMessage[] = [];
	if (session.systemPrompt?.trim() && !indexed.slice(0, target.index).some((entry) => entry.anchor.role === "system")) {
		prompt.push({ role: "system", content: session.systemPrompt.trim() });
	}
	for (const entry of indexed.slice(0, target.index)) {
		const content = reviewArtifactDisplayText(reviewMessageText(entry.message));
		if (!content) continue;
		prompt.push({
			role: exportRole((entry.message as { role?: unknown }).role),
			content,
		});
	}
	return prompt.length > 0 ? prompt : null;
}

function textPrompt(messages: readonly ExportMessage[]): string {
	return messages.map((message) => {
		switch (message.role) {
			case "system": return `System: ${message.content}`;
			case "user": return `User: ${message.content}`;
			case "assistant": return `Assistant: ${message.content}`;
			case "tool": return `Tool: ${message.content}`;
		}
	}).join("\n\n");
}

function alpacaPrompt(messages: readonly ExportMessage[]): { instruction: string; input: string } {
	let lastUserIndex = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "user") {
			lastUserIndex = index;
			break;
		}
	}
	if (lastUserIndex < 0) {
		return {
			instruction: "Continue the reviewed tutoring trajectory.",
			input: textPrompt(messages),
		};
	}
	return {
		instruction: messages[lastUserIndex].content,
		input: textPrompt(messages.filter((_message, index) => index !== lastUserIndex)),
	};
}

function archiveReadme(manifest: TrajectoryReviewArchiveManifest): string {
	const rows = manifest.files
		.map((file) => `| \`${file.path}\` | ${file.records ?? "n/a"} | ${file.purpose} |`)
		.join("\n");
	return `# Keating trajectory review export

This archive preserves one redacted review snapshot and separates human-approved training derivatives from draft material. Start with \`${DATA_PATHS.raw}\` for audit and provenance.

## Approval boundary

- Raw review data includes draft and final annotations, every candidate, model pools, prompts, and generation outcomes.
- SFT, DPO, KTO, and artifact-revision files include only completed candidates that were both selected and marked preferred when the review was final.
- Response training records are omitted unless Keating can match the reviewed assistant turn and reconstruct its preceding session context.
- KTO contains two records per approved correction: the chosen correction is desirable and the original response is undesirable.

## Counts

- Final review: ${manifest.review.status === "final" ? "yes" : "no"}
- Approved response corrections: ${manifest.counts.approvedCorrections}
- Approved artifact revisions: ${manifest.counts.approvedArtifactRevisions}
- Redacted values across exported data: ${manifest.counts.redactions}
- Skipped selected candidates: ${manifest.counts.skippedApprovedCandidates}

## Files

| Path | Records | Use |
| --- | ---: | --- |
${rows}

## Privacy and provenance

Secret-shaped values are replaced with \`[REDACTED]\` in every data file using Keating's security redaction helper. Pattern-based redaction cannot guarantee removal of every personal or confidential value, so inspect the raw review JSONL before sharing it. Training records retain candidate, annotation, model, pool, token-usage, and cost provenance.
`;
}

function archiveTimestamp(now: number): string {
	return new Date(now).toISOString().replace(/[:.]/g, "-");
}

/**
 * Purely builds a self-describing ZIP. It never reads storage or triggers a browser download.
 * Pass the rich session record to enable exact-context response training derivatives.
 */
export function buildTrajectoryReviewArchive(
	input: TrajectoryReviewArchiveInput,
	options: TrajectoryReviewArchiveOptions = {},
): TrajectoryReviewArchive {
	const now = options.now ?? Date.now();
	const generatedAt = new Date(now).toISOString();
	const { snapshot, session } = input;
	const redactions: RedactionCounter = { count: 0 };
	const finalAnnotationIds = new Set(
		snapshot.annotations.filter((annotation) => annotation.status === "final").map((annotation) => annotation.id),
	);
	const approved = approvedCandidates(snapshot);
	const approvedResponses = approved.filter(({ candidate }) => candidate.target.kind === "response");
	const approvedArtifacts = approved.filter(({ candidate }) => candidate.target.kind === "artifact");
	const warnings: string[] = [];
	if (snapshot.review.status !== "final") {
		warnings.push("This review is still a draft; no training or approved artifact revision records were emitted.");
	}

	const responseRecords: Array<{
		approved: ApprovedCandidate;
		prompt: ExportMessage[];
		chosen: string;
		rejected: string;
		provenance: CandidateProvenance;
	}> = [];
	for (const item of approvedResponses) {
		const prompt = promptForCandidate(session, item.candidate);
		if (!prompt) {
			warnings.push(`Selected response candidate ${item.candidate.id} was skipped because its prompt context could not be reconstructed.`);
			continue;
		}
		responseRecords.push({
			approved: item,
			prompt,
			chosen: item.candidate.content!.trim(),
			rejected: item.candidate.target.kind === "response" ? item.candidate.target.originalContent.trim() : "",
			provenance: candidateProvenance(item, finalAnnotationIds),
		});
	}

	const chatml = responseRecords.map((record) => ({
		messages: [...record.prompt, { role: "assistant" as const, content: record.chosen }],
		keating: {
			source: "trajectory-review",
			quality: { status: "accepted", recommendedForSft: true, humanApproved: true },
			provenance: record.provenance,
		},
	}));
	const alpaca = responseRecords.map((record) => ({
		...alpacaPrompt(record.prompt),
		output: record.chosen,
		keating: {
			source: "trajectory-review",
			quality: { status: "accepted", recommendedForSft: true, humanApproved: true },
			provenance: record.provenance,
		},
	}));
	const dpoChat = responseRecords.map((record) => ({
		prompt: record.prompt,
		chosen: record.chosen,
		rejected: record.rejected,
		keating: { source: "trajectory-review", provenance: record.provenance },
	}));
	const dpoText = responseRecords.map((record) => ({
		prompt: textPrompt(record.prompt),
		chosen: record.chosen,
		rejected: record.rejected,
		keating: { source: "trajectory-review", provenance: record.provenance },
	}));
	const kto = responseRecords.flatMap((record) => [
		{
			prompt: record.prompt,
			completion: record.chosen,
			label: true,
			keating: { source: "trajectory-review", provenance: record.provenance },
		},
		{
			prompt: record.prompt,
			completion: record.rejected,
			label: false,
			keating: { source: "trajectory-review", provenance: record.provenance },
		},
	]);
	const artifactRevisions = approvedArtifacts.map((item) => {
		const candidate = item.candidate;
		if (candidate.target.kind !== "artifact") throw new Error("Expected an artifact review candidate.");
		return {
			artifact: candidate.target.artifact,
			topic: candidate.target.topic,
			originalContent: candidate.target.originalContent,
			revisedContent: candidate.content!.trim(),
			materializedArtifactId: candidate.materializedArtifactId,
			provenance: candidateProvenance(item, finalAnnotationIds),
		};
	});

	const rawContent = jsonLine(normalizedRawSnapshot(snapshot, redactions), redactions);
	const chatmlContent = jsonLines(chatml, redactions);
	const alpacaContent = jsonLines(alpaca, redactions);
	const dpoChatContent = jsonLines(dpoChat, redactions);
	const dpoTextContent = jsonLines(dpoText, redactions);
	const ktoContent = jsonLines(kto, redactions);
	const artifactContent = jsonLines(artifactRevisions, redactions);
	const dataFiles: ArchiveFile[] = [
		{ path: DATA_PATHS.raw, purpose: "Complete redacted review snapshot, including drafts and all generation candidates.", content: rawContent, records: lineCount(rawContent) },
		{ path: DATA_PATHS.chatml, purpose: "Human-approved response corrections for ChatML SFT.", content: chatmlContent, records: lineCount(chatmlContent) },
		{ path: DATA_PATHS.alpaca, purpose: "Human-approved response corrections for Alpaca SFT.", content: alpacaContent, records: lineCount(alpacaContent) },
		{ path: DATA_PATHS.dpoChat, purpose: "Human-approved chosen correction versus rejected original, with chat-array prompts.", content: dpoChatContent, records: lineCount(dpoChatContent) },
		{ path: DATA_PATHS.dpoText, purpose: "Human-approved chosen correction versus rejected original, with rendered text prompts.", content: dpoTextContent, records: lineCount(dpoTextContent) },
		{ path: DATA_PATHS.kto, purpose: "Desirable correction and undesirable original records for KTO.", content: ktoContent, records: lineCount(ktoContent) },
		{ path: DATA_PATHS.artifactRevisions, purpose: "Human-approved artifact revisions with immutable source and generation provenance.", content: artifactContent, records: lineCount(artifactContent) },
	];
	const fileCatalog: TrajectoryReviewArchiveFile[] = [
		{ path: "manifest.json", purpose: "Machine-readable archive contract, counts, warnings, and file catalog." },
		{ path: "README.md", purpose: "Dataset card, approval boundary, privacy notes, and usage guidance." },
		...dataFiles.map(({ content: _content, ...file }) => file),
	];
	const selectedCount = Object.keys(snapshot.review.selectedCandidateIds).length;
	const manifest: TrajectoryReviewArchiveManifest = {
		schemaVersion: TRAJECTORY_REVIEW_ARCHIVE_SCHEMA_VERSION,
		kind: "keating-trajectory-review-archive",
		generatedAt,
		redactionEnabled: true,
		recommendedDataset: DATA_PATHS.raw,
		review: { status: snapshot.review.status, verdict: snapshot.review.verdict },
		counts: {
			annotations: snapshot.annotations.length,
			finalAnnotations: finalAnnotationIds.size,
			capturedArtifacts: snapshot.artifacts.length,
			responseCandidates: snapshot.candidates.filter((candidate) => candidate.target.kind === "response").length,
			artifactCandidates: snapshot.candidates.filter((candidate) => candidate.target.kind === "artifact").length,
			approvedCorrections: responseRecords.length,
			approvedArtifactRevisions: artifactRevisions.length,
			chatmlLines: chatml.length,
			alpacaLines: alpaca.length,
			dpoChatLines: dpoChat.length,
			dpoTextLines: dpoText.length,
			ktoLines: kto.length,
			redactions: redactions.count,
			skippedApprovedCandidates: Math.max(0, selectedCount - responseRecords.length - artifactRevisions.length),
		},
		warnings,
		files: fileCatalog,
	};
	const files: ArchiveFile[] = [
		{ path: "manifest.json", purpose: fileCatalog[0].purpose, content: `${JSON.stringify(sortJsonValue(manifest), null, 2)}\n` },
		{ path: "README.md", purpose: fileCatalog[1].purpose, content: archiveReadme(manifest) },
		...dataFiles,
	];
	const mtime = new Date(now);
	const zippable = Object.fromEntries(
		files.map((file) => [file.path, [strToU8(file.content), { mtime }]]),
	) as Zippable;
	return {
		bytes: zipSync(zippable, { level: 6 }),
		filename: `keating-trajectory-review-${archiveTimestamp(now)}.zip`,
		manifest,
		files: fileCatalog,
	};
}

/** Browser-only convenience wrapper kept separate from the pure archive builder. */
export function downloadTrajectoryReviewArchive(archive: TrajectoryReviewArchive): void {
	if (typeof document === "undefined") throw new Error("Trajectory review downloads require a browser document.");
	const blobBytes = new Uint8Array(archive.bytes.byteLength);
	blobBytes.set(archive.bytes);
	const url = URL.createObjectURL(new Blob([blobBytes.buffer], { type: "application/zip" }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = archive.filename;
	anchor.style.display = "none";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
