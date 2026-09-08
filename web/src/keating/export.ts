import type { SessionData } from "../types/session";
import type {
	Animation,
	BenchmarkResult,
	EvolutionResult,
	LessonMap,
	LessonPlan,
	Verification,
} from "./storage";
import type { KeatingSandboxPortableBundle } from "./sandbox-export";
import { keatingStorage, sessions } from "../hooks/keating-storage";
import { buildSandboxPortableBundle } from "./sandbox-export";
import { loadPersona } from "./persona";
import {
	CanonicalTrainingRecordSchema,
	type CanonicalTrainingRecord,
	type TrainingQualityStatus,
} from "./training-schema";
import {
	applyJudgeScores,
	buildDpoChatExamples,
	buildDpoTextExamples,
	buildExplicitResponsePreference,
	buildGrpoPrompts,
	buildKtoExamples,
	buildPreferencePairs,
	computeRewardStats,
	computeSessionRewardedTurns,
	KTO_GOOD_THRESHOLD,
	type ExportJudge,
	type NormalizedRewardMessage,
	type RewardedTurn,
	type RewardStats,
} from "./reward";

export type WebExportSource = "all" | "artifacts" | "sessions" | "sandbox";
export type WebFineTuneFormat = "chatml" | "alpaca" | "both";

export interface WebFineTuneExportOptions {
	source: WebExportSource;
	format: WebFineTuneFormat;
	redact: boolean;
	minAssistantChars: number;
	maxAssistantChars?: number;
	maxRecords?: number;
	validationPercent?: number;
	deduplicate?: boolean;
	keepAllResponses?: boolean;
	judge?: ExportJudge;
	judgeModel?: { provider: string; id: string };
	judgeThinkingLevel?: string;
	now?: number;
}

export interface WebFineTuneExportResult {
	readmeSummary?: { text: string; included: boolean; createdAt: string; model?: { provider: string; id: string; thinkingLevel: string } };
	reviewNotesJsonl?: string;
	reviewSummariesJsonl?: string;
	chatmlJsonl?: string;
	alpacaJsonl?: string;
	canonicalJsonl?: string;
	sourceDataJson?: string;
	rewardedJsonl?: string;
	ktoJsonl?: string;
	preferenceJsonl?: string;
	dpoTextJsonl?: string;
	grpoPromptsJsonl?: string;
	manifestJson: string;
	exampleCount: number;
	recordCount: number;
	skippedCount: number;
	redactionCount: number;
	rewardStats?: RewardStats;
}

export interface WebExportSources {
	plans?: LessonPlan[];
	maps?: LessonMap[];
	animations?: Animation[];
	verifications?: Verification[];
	benchmarks?: BenchmarkResult[];
	evolutions?: EvolutionResult[];
	sessions?: SessionData[];
	sandbox?: KeatingSandboxPortableBundle;
	feedback?: import("./storage").FeedbackEntry[];
	quizResults?: import("./storage").QuizResultRecord[];
	persona?: string;
}

interface FineTuneExample {
	id: string;
	source: "artifact" | "session" | "sandbox";
	kind: string;
	topic?: string;
	sessionId?: string;
	sessionTitle?: string;
	messageTimestamp?: number;
	model?: unknown;
	thinkingLevel?: string;
	path?: string;
	commitId?: string;
	instruction: string;
	input?: string;
	output: string;
	messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

/** One ChatML line = one conversation. Sessions carry a `keating` envelope so
 *  the importer can reconstruct a resumable session; lossless exports (no
 *  redaction) embed the original full messages. */
interface WebConversation {
	source: "artifact" | "session" | "sandbox";
	messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
	envelope?: {
		title?: string;
		sessionId?: string;
		source?: string;
		model?: unknown;
		thinkingLevel?: string;
		messages?: unknown[];
		training?: {
			id: string;
			kind: string;
			topic?: string;
			quality?: CanonicalTrainingRecord["quality"];
		};
	};
}

interface NormalizedSessionResult {
	messages: NormalizedRewardMessage[];
	pairMessages: NormalizedRewardMessage[];
}

interface ExportCounters {
	redactions: number;
	skipped: number;
}

type TrainingSplit = "train" | "validation";
const SECRET_PATTERNS: RegExp[] = [
	/\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
	/\bsk-[A-Za-z0-9_-]{12,}\b/g,
	/\bAIza[A-Za-z0-9_-]{16,}\b/g,
	/\bghp_[A-Za-z0-9_]{12,}\b/g,
	/\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi,
	/^[A-Z][A-Z0-9_]*_API_KEY\s*=\s*.+$/gm,
	/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

function redactText(input: string, enabled: boolean): { text: string; count: number } {
	if (!enabled) return { text: input, count: 0 };
	let text = input;
	let count = 0;
	for (const pattern of SECRET_PATTERNS) {
		text = text.replace(pattern, () => {
			count += 1;
			return "[REDACTED]";
		});
	}
	return { text, count };
}

function parseMessageText(message: any): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => {
		if (typeof part === "string") return part;
		if (part?.type === "text" && typeof part.text === "string") return part.text;
		if (typeof part?.text === "string") return part.text;
		if (part?.type === "file" && typeof part.filename === "string") return `[Attachment: ${part.filename}]`;
		return "";
	}).filter(Boolean).join("\n");
}

function isBadAssistantText(text: string, message: any): boolean {
	if (message?.stopReason === "error") return true;
	return /__KEATING_ERROR__|authentication failed|no api key|stack trace|^\s*error:/i.test(text);
}

function artifactInstruction(kind: string, topic: string): string {
	switch (kind) {
		case "plan":
			return `Create a Keating-style Socratic lesson plan for ${topic}.`;
		case "quiz":
			return `Create retrieval practice and an answer key for ${topic}.`;
		case "map":
			return `Create a Mermaid concept map for ${topic}.`;
		case "animation":
			return `Create a teaching animation storyboard for ${topic}.`;
		case "verification":
			return `Create a verification checklist before teaching ${topic}.`;
		default:
			return `Create a Keating teaching artifact for ${topic}.`;
	}
}

function addArtifactExample(
	examples: FineTuneExample[],
	kind: string,
	topic: string,
	content: string,
	options: WebFineTuneExportOptions,
	counters: ExportCounters,
	conversations?: WebConversation[],
) {
	const trimmed = content.trim();
	if (!trimmed) {
		counters.skipped += 1;
		return;
	}
	const redacted = redactText(trimmed, options.redact);
	counters.redactions += redacted.count;
	const instruction = artifactInstruction(kind, topic);
	const messages = [
		{ role: "user" as const, content: instruction },
		{ role: "assistant" as const, content: redacted.text },
	];
	examples.push({
		id: `artifact-${kind}-${planSafeId(topic)}`,
		source: "artifact",
		kind,
		topic,
		instruction,
		output: redacted.text,
		messages,
	});
	conversations?.push({ source: "artifact", messages });
}

/** Builds one full, resumable conversation from a normalized session. */
function conversationFromSession(
	session: SessionData,
	normalized: NormalizedSessionResult,
	options: WebFineTuneExportOptions,
	persona: string,
	turnsByKey: Map<string, RewardedTurn>,
): WebConversation | null {
	const messages: WebConversation["messages"] = persona.trim()
		? [{ role: "system", content: persona.trim() }]
		: [];
	let pendingUsers: WebConversation["messages"] = [];
	for (const message of normalized.messages) {
		if (message.role === "user") {
			pendingUsers.push({ role: "user", content: message.content });
			continue;
		}
		const key = rewardTurnKey(session.id, message.timestamp);
		const turn = key ? turnsByKey.get(key) : undefined;
		const rejectedForSft = !options.keepAllResponses && Boolean(turn?.scored && turn.reward < KTO_GOOD_THRESHOLD);
		if (message.shortAssistant || rejectedForSft) {
			pendingUsers = [];
			continue;
		}
		messages.push(...pendingUsers, { role: "assistant", content: message.content });
		pendingUsers = [];
	}
	const hasUser = messages.some((message) => message.role === "user");
	const hasAssistant = messages.some((message) => message.role === "assistant");
	if (!hasUser || !hasAssistant) return null;
	return {
		source: "session",
		messages,
		envelope: {
			title: session.title,
			sessionId: session.id,
			source: "keating-session-export",
			model: session.model,
			thinkingLevel: session.thinkingLevel,
			// Lossless resume: embed originals only when not redacting.
			messages: options.redact ? undefined : (session.messages as unknown[]),
			training: {
				id: `session-${planSafeId(session.id)}`,
				kind: "conversation",
				topic: session.title,
			},
		},
	};
}

function normalizeSessionMessages(
	session: SessionData,
	options: WebFineTuneExportOptions,
	counters: ExportCounters,
): NormalizedSessionResult {
	const messages: NormalizedRewardMessage[] = [];
	const pairMessages: NormalizedRewardMessage[] = [];
	for (const message of session.messages as any[]) {
		const rawRole = message?.role;
		const role = rawRole === "user" || rawRole === "user-with-attachments"
			? "user"
			: rawRole === "assistant"
				? "assistant"
				: null;
		if (!role) {
			counters.skipped += 1;
			continue;
		}
		const text = parseMessageText(message).trim();
		if (!text) {
			counters.skipped += 1;
			continue;
		}
		if (role === "assistant" && !options.keepAllResponses && isBadAssistantText(text, message)) {
			counters.skipped += 1;
			continue;
		}
		const shortAssistant = role === "assistant" && text.length < options.minAssistantChars;
		if (role === "assistant" && text.length < options.minAssistantChars) {
			counters.skipped += 1;
		}
		const redacted = redactText(text, options.redact);
		counters.redactions += redacted.count;
		messages.push({
			role,
			content: redacted.text,
			timestamp: typeof message?.timestamp === "number" ? message.timestamp : undefined,
			shortAssistant,
		});
		if (!shortAssistant) {
			pairMessages.push(messages[messages.length - 1]);
		}
	}
	return { messages, pairMessages };
}

function addSessionExamples(
	examples: FineTuneExample[],
	normalized: NormalizedSessionResult,
	session: SessionData,
) {
	for (let index = 0; index < normalized.pairMessages.length - 1; index += 1) {
		const user = normalized.pairMessages[index];
		const assistant = normalized.pairMessages[index + 1];
		if (user?.role === "user" && assistant?.role === "assistant") {
			examples.push({
				id: `session-${planSafeId(session.id)}-${assistant.timestamp ?? index}`,
				source: "session",
				kind: "conversation",
				topic: session.title,
				sessionId: session.id,
				sessionTitle: session.title,
				messageTimestamp: assistant.timestamp,
				model: session.model,
				thinkingLevel: session.thinkingLevel,
				instruction: user.content,
				output: assistant.content,
				messages: [user, assistant],
			});
		}
	}
}

function addSandboxExamples(
	examples: FineTuneExample[],
	sandbox: KeatingSandboxPortableBundle | undefined,
	options: WebFineTuneExportOptions,
	counters: ExportCounters,
	conversations?: WebConversation[],
): { filesRead: number; commitsRead: number } {
	if (!sandbox) return { filesRead: 0, commitsRead: 0 };
	let filesRead = 0;
	const commitsRead = sandbox.vc.commits.length;
	for (const file of sandbox.nodepod.files) {
		filesRead += 1;
		if (!/\/workspace\/(src\/core\/|pi\/prompts\/|web\/src\/keating\/)/.test(file.path)) continue;
		const content = file.content.trim();
		if (!content) {
			counters.skipped += 1;
			continue;
		}
		const redacted = redactText(content, options.redact);
		counters.redactions += redacted.count;
		const instruction = `Maintain or improve this Keating sandbox source file: ${file.path}.`;
		const messages = [
			{ role: "user" as const, content: instruction },
			{ role: "assistant" as const, content: redacted.text },
		];
		examples.push({
			id: `sandbox-file-${planSafeId(file.path)}`,
			source: "sandbox",
			kind: "source-file",
			path: file.path,
			instruction,
			output: redacted.text,
			messages,
		});
		conversations?.push({ source: "sandbox", messages });
	}
	for (const commit of sandbox.vc.commits) {
		const files = commit.files
			.map((file) => `${file.path} ${file.hash}`)
			.join("\n");
		const summary = `Commit: ${commit.message}\nBranch: ${commit.branchId}\nFiles:\n${files}`.trim();
		if (!files) {
			counters.skipped += 1;
			continue;
		}
		const redacted = redactText(summary, options.redact);
		counters.redactions += redacted.count;
		const instruction = `Describe the purpose and exact file impact of the Keating sandbox checkpoint: ${commit.message}`;
		const messages = [
			{ role: "user" as const, content: instruction },
			{ role: "assistant" as const, content: redacted.text },
		];
		examples.push({
			id: `sandbox-commit-${planSafeId(commit.id)}`,
			source: "sandbox",
			kind: "checkpoint",
			commitId: commit.id,
			instruction,
			output: redacted.text,
			messages,
		});
		conversations?.push({ source: "sandbox", messages });
	}
	return { filesRead, commitsRead };
}

function toChatMlJsonl(conversations: WebConversation[]): string {
	return conversations.map((conversation) => JSON.stringify(
		conversation.envelope
			? { messages: conversation.messages, keating: conversation.envelope }
			: { messages: conversation.messages },
	)).join("\n") + (conversations.length ? "\n" : "");
}

function toAlpacaJsonl(examples: FineTuneExample[]): string {
	return examples.map((example) => JSON.stringify({
		instruction: example.instruction,
		input: example.input ?? "",
		output: example.output,
	})).join("\n") + (examples.length ? "\n" : "");
}

function toJsonl(values: unknown[]): string {
	return values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "");
}

function planSafeId(value: string): string {
	const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	return normalized.slice(0, 80) || "item";
}

function stableHash(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function splitFor(sourceKey: string, validationPercent: number): TrainingSplit {
	// Keep the original default 10% partition stable as the allocation changes.
	const hash = stableHash(sourceKey);
	const bucket = (hash % 10) * 10 + Math.floor(hash / 10) % 10;
	return bucket < validationPercent ? "validation" : "train";
}

function rewardTurnKey(sessionId?: string, messageTimestamp?: number): string | null {
	return sessionId && typeof messageTimestamp === "number" ? `${sessionId}:${messageTimestamp}` : null;
}

function qualityForTurn(turn?: RewardedTurn): CanonicalTrainingRecord["quality"] {
	if (!turn) return { status: "unscored", recommendedForSft: false, scored: false };
	if (!turn.scored) return { status: "unscored", recommendedForSft: false, scored: false, signals: turn.signals };
	const status: TrainingQualityStatus = turn.reward >= KTO_GOOD_THRESHOLD
		? "accepted"
		: turn.reward <= 0.35
			? "rejected"
			: "review";
	return {
		status,
		recommendedForSft: status === "accepted",
		scored: true,
		reward: turn.reward,
		signals: turn.signals,
	};
}

function buildCanonicalRecords(
	examples: FineTuneExample[],
	rewardedTurns: RewardedTurn[],
	persona: string,
	validationPercent: number,
): { records: CanonicalTrainingRecord[]; duplicateCount: number } {
	const turnsByKey = new Map<string, RewardedTurn>();
	for (const turn of rewardedTurns) {
		const key = rewardTurnKey(turn.sessionId, turn.messageTimestamp);
		if (key) turnsByKey.set(key, turn);
	}
	const records: CanonicalTrainingRecord[] = [];
	const duplicateCount = 0;
	for (const example of examples) {
		const turnKey = rewardTurnKey(example.sessionId, example.messageTimestamp);
		const turn = turnKey ? turnsByKey.get(turnKey) : undefined;
		const rawMessages = turn
			? [...turn.context, { role: "assistant" as const, content: turn.completion }]
			: (example.messages ?? [
				{ role: "user" as const, content: example.instruction },
				{ role: "assistant" as const, content: example.output },
			]);
		const baseMessages = rawMessages.map((message) => ({ role: message.role, content: message.content }));
		const messages = !turn && example.source === "session" && persona.trim()
			? [{ role: "system" as const, content: persona.trim() }, ...baseMessages]
			: baseMessages;
		const completion = messages.at(-1)?.content ?? example.output;
		const prompt = messages.slice(0, -1);
		const fingerprint = JSON.stringify([...prompt.map((message) => [message.role, message.content.trim()]), ["assistant", completion.trim()]]);
		const quality = example.source === "sandbox"
			? { status: "reference" as const, recommendedForSft: false, scored: false }
			: example.source === "artifact"
				? { status: "unscored" as const, recommendedForSft: false, scored: false }
				: qualityForTurn(turn);
		records.push({
			schemaVersion: 2,
			id: `${example.id}-${stableHash(fingerprint).toString(36)}`,
			split: splitFor(example.sessionId ?? example.path ?? example.commitId ?? example.id, validationPercent),
			task: quality.status === "rejected" ? "preference-learning" : quality.status === "reference" ? "reference" : "supervised-finetuning",
			source: {
				type: example.source,
				kind: example.kind,
				topic: example.topic,
				sessionId: example.sessionId,
				sessionTitle: example.sessionTitle,
				messageTimestamp: example.messageTimestamp,
				model: example.model,
				thinkingLevel: example.thinkingLevel,
				path: example.path,
				commitId: example.commitId,
			},
			messages,
			prompt,
			completion,
			quality,
			metrics: {
				promptCharacters: prompt.reduce((sum, message) => sum + message.content.length, 0),
				completionCharacters: completion.length,
				messageCount: messages.length,
			},
		});
	}
	return { records, duplicateCount };
}

function dedupeExamples(examples: FineTuneExample[]): { examples: FineTuneExample[]; duplicateCount: number } {
	const seen = new Set<string>();
	const unique: FineTuneExample[] = [];
	let duplicateCount = 0;
	for (const example of examples) {
		const fingerprint = JSON.stringify([
			example.instruction.trim(),
			(example.input ?? "").trim(),
			example.output.trim(),
		]);
		if (seen.has(fingerprint)) {
			duplicateCount += 1;
			continue;
		}
		seen.add(fingerprint);
		unique.push(example);
	}
	return { examples: unique, duplicateCount };
}

function qualityCounts(records: CanonicalTrainingRecord[]): Record<TrainingQualityStatus, number> {
	const counts: Record<TrainingQualityStatus, number> = {
		accepted: 0,
		unscored: 0,
		review: 0,
		rejected: 0,
		reference: 0,
	};
	for (const record of records) counts[record.quality.status] += 1;
	return counts;
}

function lineCount(jsonl?: string): number {
	return jsonl ? jsonl.trim().split("\n").filter(Boolean).length : 0;
}

export async function buildWebFineTuneExportFromSources(
	sources: WebExportSources,
	options: WebFineTuneExportOptions,
): Promise<WebFineTuneExportResult> {
	if (options.keepAllResponses) {
		options = { ...options, minAssistantChars: 1, maxAssistantChars: undefined, maxRecords: undefined, deduplicate: false };
	}
	const positiveInteger = (value: number | undefined, name: string) => {
		if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new Error(`${name} must be a positive integer.`);
	};
	positiveInteger(options.maxAssistantChars, "Maximum assistant characters");
	positiveInteger(options.maxRecords, "Maximum records");
	if (options.maxAssistantChars !== undefined && options.maxAssistantChars < options.minAssistantChars) throw new Error("Maximum assistant characters must be at least the minimum.");
	const validationPercent = options.validationPercent ?? 10;
	if (!Number.isFinite(validationPercent) || validationPercent < 0 || validationPercent > 50) throw new Error("Validation percentage must be between 0 and 50.");
	const examples: FineTuneExample[] = [];
	const rewardedTurns: RewardedTurn[] = [];
	const normalizedSessions = new Map<string, NormalizedSessionResult>();
	const counters = { redactions: 0, skipped: 0 };
	const includeArtifacts = options.source === "all" || options.source === "artifacts";
	const includeSessions = options.source === "all" || options.source === "sessions";
	const includeSandbox = options.source === "all" || options.source === "sandbox";
	let normalizedPersona = "";
	let artifactsRead = 0;
	let sessionsRead = 0;
	let sandboxFilesRead = 0;
	let sandboxCommitsRead = 0;

	if (includeArtifacts) {
		for (const plan of sources.plans ?? []) {
			artifactsRead += 1;
			addArtifactExample(examples, plan.metadata?.type === "quiz" ? "quiz" : "plan", plan.topic, plan.content, options, counters);
		}
		for (const map of sources.maps ?? []) {
			artifactsRead += 1;
			addArtifactExample(examples, "map", map.topic, map.mmdContent, options, counters);
		}
		for (const animation of sources.animations ?? []) {
			artifactsRead += 1;
			addArtifactExample(examples, "animation", animation.topic, animation.storyboard, options, counters);
		}
		for (const verification of sources.verifications ?? []) {
			artifactsRead += 1;
			addArtifactExample(examples, "verification", verification.topic, verification.checklist, options, counters);
		}
	}

	if (includeSessions) {
		const persona = sources.persona
			? redactText(sources.persona, options.redact)
			: { text: "", count: 0 };
		normalizedPersona = persona.text;
		counters.redactions += persona.count;
		for (const session of sources.sessions ?? []) {
			sessionsRead += 1;
			const normalized = normalizeSessionMessages(session, options, counters);
			normalizedSessions.set(session.id, normalized);
			addSessionExamples(examples, normalized, session);

		}
	}

	if (includeSandbox) {
		const sandboxCounts = addSandboxExamples(examples, sources.sandbox, options, counters);
		sandboxFilesRead = sandboxCounts.filesRead;
		sandboxCommitsRead = sandboxCounts.commitsRead;
	}

	// Select once, then rebuild session contexts so excluded completions cannot leak
	// into reward, preference, or conversation payloads as historical messages.
	const withinBounds = examples.filter((example) => example.output.length >= options.minAssistantChars && (options.maxAssistantChars === undefined || example.output.length <= options.maxAssistantChars));
	const lengthExcluded = examples.length - withinBounds.length;
	const deduplicated = options.deduplicate ? dedupeExamples(withinBounds) : { examples: withinBounds, duplicateCount: 0 };
	const limitExcluded = Math.max(0, deduplicated.examples.length - (options.maxRecords ?? deduplicated.examples.length));
	deduplicated.examples = deduplicated.examples.slice(0, options.maxRecords);
	counters.skipped += lengthExcluded + deduplicated.duplicateCount + limitExcluded;
	const selectedAssistantCounts = new Map<string, number>();
	for (const example of deduplicated.examples) {
		if (example.source !== "session") continue;
		const key = JSON.stringify([example.sessionId, example.messageTimestamp, example.output]);
		selectedAssistantCounts.set(key, (selectedAssistantCounts.get(key) ?? 0) + 1);
	}
	const selectedAssistantKeys = new Set(selectedAssistantCounts.keys());
	const filteredSessionIds = new Set<string>();
	rewardedTurns.length = 0;
	const selectedFeedbackIds = new Set<string>();
	for (const session of sources.sessions ?? []) {
		const normalized = normalizedSessions.get(session.id);
		if (!normalized) continue;
		const selected: NormalizedRewardMessage[] = [];
		let pendingUsers: NormalizedRewardMessage[] = [];
		for (const message of normalized.messages) {
			if (message.role === "user") {
				pendingUsers.push(message);
				continue;
			}
			const key = JSON.stringify([session.id, message.timestamp, message.content]);
			const remaining = selectedAssistantCounts.get(key) ?? 0;
			if (remaining > 0) {
				selectedAssistantCounts.set(key, remaining - 1);
				selected.push(...pendingUsers, message);
			}
			// The prompt for an excluded response must not become the prompt of
			// a later response when the removed turn joins adjacent user messages.
			pendingUsers = [];
		}
		if (selected.length > 0) selected.push(...pendingUsers);
		if (selected.length !== normalized.messages.length) filteredSessionIds.add(session.id);
		normalized.messages = selected;
		normalized.pairMessages = selected;
		rewardedTurns.push(...computeSessionRewardedTurns({ sessionId: session.id, title: session.title, persona: normalizedPersona, messages: selected, feedback: sources.feedback ?? [], quizResults: sources.quizResults ?? [], usedFeedbackIds: selectedFeedbackIds }));
	}
	// One batch keeps the judge's budget global across the export, not per session.
	if (options.judge && rewardedTurns.length > 0) {
		applyJudgeScores(rewardedTurns, await options.judge(rewardedTurns));
	}
	const judgeScored = rewardedTurns.filter((turn) => turn.signals.judge).length;
	const turnsByKey = new Map<string, RewardedTurn>();
	for (const turn of rewardedTurns) {
		const key = rewardTurnKey(turn.sessionId, turn.messageTimestamp);
		if (key) turnsByKey.set(key, turn);
	}
	const sftExamples = deduplicated.examples.filter((example) => {
		const key = rewardTurnKey(example.sessionId, example.messageTimestamp);
		const turn = key ? turnsByKey.get(key) : undefined;
		return options.keepAllResponses || !(turn?.scored && turn.reward < KTO_GOOD_THRESHOLD);
	});
	const canonical = buildCanonicalRecords(deduplicated.examples, rewardedTurns, normalizedPersona, validationPercent);
	const conversations: WebConversation[] = sftExamples
		.filter((example) => example.source !== "session")
		.map((example) => {
			const messages = (example.messages ?? [
				{ role: "user" as const, content: example.instruction },
				{ role: "assistant" as const, content: example.output },
			]);
			return {
				source: example.source,
				messages,
				envelope: {
					source: "keating-training-export",
					training: {
						id: example.id,
						kind: example.kind,
						topic: example.topic,
						quality: example.source === "artifact"
							? { status: "unscored", recommendedForSft: false, scored: false }
							: { status: "reference", recommendedForSft: false, scored: false },
					},
				},
			};
		});
	for (const session of sources.sessions ?? []) {
		const normalized = normalizedSessions.get(session.id);
		if (!normalized) continue;
		const conversation = conversationFromSession(session, normalized, options, normalizedPersona, turnsByKey);
		if (conversation) {
			if (filteredSessionIds.has(session.id) && conversation.envelope) conversation.envelope.messages = undefined;
			conversations.push(conversation);
		}
	}

	const sourceDataJson = options.keepAllResponses ? `${JSON.stringify({
		schemaVersion: 1,
		kind: "keating-training-source-snapshot",
		source: options.source,
		...(includeArtifacts ? {
			plans: sources.plans ?? [], maps: sources.maps ?? [], animations: sources.animations ?? [],
			verifications: sources.verifications ?? [], benchmarks: sources.benchmarks ?? [], evolutions: sources.evolutions ?? [],
		} : {}),
		...(includeSessions ? {
			sessions: sources.sessions ?? [], feedback: sources.feedback ?? [], quizResults: sources.quizResults ?? [], persona: sources.persona ?? "",
		} : {}),
		...(includeSandbox ? { sandbox: sources.sandbox ?? null } : {}),
	}, (_key, value: unknown) => {
		if (typeof value !== "string") return value;
		const redacted = redactText(value, options.redact);
		counters.redactions += redacted.count;
		return redacted.text;
	}, 2)}\n` : undefined;
	const result: WebFineTuneExportResult = {
		sourceDataJson,
		exampleCount: sftExamples.length,
		recordCount: canonical.records.length,
		skippedCount: counters.skipped,
		redactionCount: counters.redactions,
		manifestJson: "",
	};
	if (options.format === "chatml" || options.format === "both") {
		result.chatmlJsonl = toChatMlJsonl(conversations);
	}
	if (options.format === "alpaca" || options.format === "both") {
		result.alpacaJsonl = toAlpacaJsonl(sftExamples);
	}
	result.canonicalJsonl = toJsonl(canonical.records.map((record) => CanonicalTrainingRecordSchema.parse(record)));
	if (rewardedTurns.length > 0) {
		const kto = buildKtoExamples(rewardedTurns);
		const explicitPreferences = (sources.sessions ?? []).flatMap((alternative) => {
			if (!alternative.generatedAlternative || !alternative.parentSessionId) return [];
			if (alternative.responsePreference !== "original" && alternative.responsePreference !== "alternative") return [];
			if (typeof alternative.alternativeForMessageTimestamp !== "number") return [];
			const original = normalizedSessions.get(alternative.parentSessionId);
			const alternate = normalizedSessions.get(alternative.id);
			if (!original || !alternate) return [];
			const finalAssistant = [...alternative.messages].reverse().find((message) => message.role === "assistant");
			if (!finalAssistant || !selectedAssistantKeys.has(JSON.stringify([alternative.id, (finalAssistant as any).timestamp, redactText(parseMessageText(finalAssistant).trim(), options.redact).text]))) return [];
			const pair = buildExplicitResponsePreference({
				originalMessages: original.messages,
				alternativeMessages: alternate.messages,
				originalMessageTimestamp: alternative.alternativeForMessageTimestamp,
				preference: alternative.responsePreference,
				persona: normalizedPersona,
			});
			return pair ? [pair] : [];
		});
		const preferences = [...buildPreferencePairs(rewardedTurns), ...explicitPreferences];
		const grpoPrompts = buildGrpoPrompts(rewardedTurns);
		result.rewardStats = computeRewardStats(rewardedTurns);
		result.rewardedJsonl = toJsonl(rewardedTurns.map((turn) => ({
			id: `session-${planSafeId(turn.sessionId)}-${turn.messageTimestamp ?? "untimed"}`,
			sessionId: turn.sessionId,
			topic: turn.topic,
			messageTimestamp: turn.messageTimestamp,
			messages: [...turn.context, { role: "assistant", content: turn.completion }],
			reward: turn.reward,
			signals: turn.signals,
			scored: turn.scored,
		})));
		result.ktoJsonl = toJsonl(kto);
		result.preferenceJsonl = toJsonl(buildDpoChatExamples(preferences));
		result.dpoTextJsonl = toJsonl(buildDpoTextExamples(preferences));
		result.grpoPromptsJsonl = toJsonl(grpoPrompts);
	}
	const quality = qualityCounts(canonical.records);
	const trainRecords = canonical.records.filter((record) => record.split === "train").length;
	const validationRecords = canonical.records.length - trainRecords;
	const sftExcluded = deduplicated.examples.length - sftExamples.length;
	const warnings = [
		...(options.keepAllResponses ? ["Keep everything is enabled: short, error-like, and low-scoring text responses are retained in compatibility exports. Quality labels remain descriptive, not an endorsement. The source snapshot preserves original message structures, including non-text and empty messages; text training files cannot represent every source item."] : []),
		"Compatibility files combine partitions. Use the canonical record split field to construct training and validation datasets; train.* filenames do not enforce a held-out partition.",
		...(options.judge && judgeScored < rewardedTurns.length ? [`Judge scored ${judgeScored} of ${rewardedTurns.length} eligible responses. Missing scores may reflect failed requests, invalid responses, or the scoring limit; they are not quality judgments.`] : []),
		...(sftExamples.length === 0 ? ["No supervised fine-tuning examples were generated."] : []),
		...(quality.unscored > 0 ? [`${quality.unscored} captured responses have no quality signal; review them before high-stakes training.`] : []),
		...(quality.reference > 0 ? [`${quality.reference} sandbox records are reference material, not recommended SFT examples.`] : []),
		...(validationPercent > 0 && validationRecords === 0 && canonical.records.length >= 2 ? ["The deterministic source-group split produced no validation records for this small dataset."] : []),
	];
	result.manifestJson = `${JSON.stringify({
		schemaVersion: 2,
		mode: "finetune",
		generatedAt: new Date(options.now ?? Date.now()).toISOString(),
		source: options.source,
		format: options.format,
		redactionEnabled: options.redact,
		keepAllResponses: options.keepAllResponses ?? false,
		sourceSnapshotIncluded: Boolean(sourceDataJson),
		minimumAssistantCharacters: options.minAssistantChars,
		maximumAssistantCharacters: options.maxAssistantChars ?? null,
		maximumRecords: options.maxRecords ?? null,
		validationPercent,
		deduplicationEnabled: options.deduplicate ?? false,
		recordSelection: "Source order, after character bounds and optional exact prompt/completion deduplication; limits count canonical records before SFT quality exclusions.",
		judgeScoringEnabled: Boolean(options.judge),
		judgeScoring: options.judge ? {
			model: options.judgeModel ?? null,
			...(options.judgeThinkingLevel ? { thinkingLevel: options.judgeThinkingLevel } : {}),
			eligible: rewardedTurns.length,
			scored: judgeScored,
			unscored: rewardedTurns.length - judgeScored,
		} : null,
		recommendedDataset: "data/keating.training.jsonl",
		splitStrategy: `Stable source-group hash (${100 - validationPercent}% train / ${validationPercent}% validation)`,
		counts: {
			artifactsRead,
			sessionsRead,
			sandboxFilesRead,
			sandboxCommitsRead,
			examplesWritten: sftExamples.length,
			canonicalRecords: canonical.records.length,
			trainRecords,
			validationRecords,
			sftExcluded,
			lengthExcluded,
			limitExcluded,
			duplicatesRemoved: deduplicated.duplicateCount + canonical.duplicateCount,
			skipped: counters.skipped,
			redactions: counters.redactions,
			rewardedLines: lineCount(result.rewardedJsonl),
			ktoLines: lineCount(result.ktoJsonl),
			preferenceLines: lineCount(result.preferenceJsonl),
			dpoTextLines: lineCount(result.dpoTextJsonl),
			grpoPromptLines: lineCount(result.grpoPromptsJsonl),
		},
		quality,
		rewardStats: result.rewardStats,
		warnings,
	}, null, 2)}\n`;
	return result;
}

export async function loadWebExportSources(): Promise<WebExportSources> {
	const metadata = await sessions.getAllMetadata();
	const sessionData = await Promise.all(metadata.map(async (entry) => sessions.loadSession(entry.id) as Promise<SessionData | null>));
	const [
		plans,
		maps,
		animations,
		verifications,
		benchmarks,
		evolutions,
		sandbox,
		feedback,
		quizResults,
		persona,
	] = await Promise.all([
		keatingStorage.getLessonPlans(),
		keatingStorage.getLessonMaps(),
		keatingStorage.getAnimations(),
		keatingStorage.getVerifications(),
		keatingStorage.getBenchmarks(),
		keatingStorage.getEvolutions(),
		buildSandboxPortableBundle().catch(() => undefined),
		keatingStorage.getFeedback(),
		keatingStorage.getQuizResults(),
		Promise.resolve(loadPersona()),
	]);
	return {
		plans,
		maps,
		animations,
		verifications,
		benchmarks,
		evolutions,
		sessions: sessionData.filter(Boolean) as SessionData[],
		sandbox,
		feedback,
		quizResults,
		persona,
	};
}

export async function buildWebFineTuneExport(options: WebFineTuneExportOptions): Promise<WebFineTuneExportResult> {
	return buildWebFineTuneExportFromSources(await loadWebExportSources(), options);
}
