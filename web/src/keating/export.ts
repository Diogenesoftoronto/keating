import { sessions, keatingStorage } from "../hooks/keating-storage";
import type { SessionData } from "../types/session";
import type {
	Animation,
	BenchmarkResult,
	EvolutionResult,
	LessonMap,
	LessonPlan,
	Verification,
} from "./storage";

export type WebExportSource = "all" | "artifacts" | "sessions";
export type WebFineTuneFormat = "chatml" | "alpaca" | "both";

export interface WebFineTuneExportOptions {
	source: WebExportSource;
	format: WebFineTuneFormat;
	redact: boolean;
	minAssistantChars: number;
}

export interface WebFineTuneExportResult {
	chatmlJsonl?: string;
	alpacaJsonl?: string;
	manifestJson: string;
	exampleCount: number;
	skippedCount: number;
	redactionCount: number;
}

export interface WebExportSources {
	plans?: LessonPlan[];
	maps?: LessonMap[];
	animations?: Animation[];
	verifications?: Verification[];
	benchmarks?: BenchmarkResult[];
	evolutions?: EvolutionResult[];
	sessions?: SessionData[];
}

interface FineTuneExample {
	instruction: string;
	input?: string;
	output: string;
	messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

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
	counters: { redactions: number; skipped: number },
) {
	const trimmed = content.trim();
	if (!trimmed) {
		counters.skipped += 1;
		return;
	}
	const redacted = redactText(trimmed, options.redact);
	counters.redactions += redacted.count;
	const instruction = artifactInstruction(kind, topic);
	examples.push({
		instruction,
		output: redacted.text,
		messages: [
			{ role: "user", content: instruction },
			{ role: "assistant", content: redacted.text },
		],
	});
}

function addSessionExamples(
	examples: FineTuneExample[],
	session: SessionData,
	options: WebFineTuneExportOptions,
	counters: { redactions: number; skipped: number },
) {
	const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
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
		if (role === "assistant" && isBadAssistantText(text, message)) {
			counters.skipped += 1;
			continue;
		}
		if (role === "assistant" && text.length < options.minAssistantChars) {
			counters.skipped += 1;
			continue;
		}
		const redacted = redactText(text, options.redact);
		counters.redactions += redacted.count;
		messages.push({ role, content: redacted.text });
	}

	for (let index = 0; index < messages.length - 1; index += 1) {
		const user = messages[index];
		const assistant = messages[index + 1];
		if (user?.role === "user" && assistant?.role === "assistant") {
			examples.push({
				instruction: user.content,
				output: assistant.content,
				messages: [user, assistant],
			});
		}
	}
}

function toChatMlJsonl(examples: FineTuneExample[]): string {
	return examples.map((example) => JSON.stringify({
		messages: example.messages ?? [
			{ role: "user", content: example.instruction },
			{ role: "assistant", content: example.output },
		],
	})).join("\n") + (examples.length ? "\n" : "");
}

function toAlpacaJsonl(examples: FineTuneExample[]): string {
	return examples.map((example) => JSON.stringify({
		instruction: example.instruction,
		input: example.input ?? "",
		output: example.output,
	})).join("\n") + (examples.length ? "\n" : "");
}

export function buildWebFineTuneExportFromSources(
	sources: WebExportSources,
	options: WebFineTuneExportOptions,
): WebFineTuneExportResult {
	const examples: FineTuneExample[] = [];
	const counters = { redactions: 0, skipped: 0 };
	const includeArtifacts = options.source === "all" || options.source === "artifacts";
	const includeSessions = options.source === "all" || options.source === "sessions";
	let artifactsRead = 0;
	let sessionsRead = 0;

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
		for (const session of sources.sessions ?? []) {
			sessionsRead += 1;
			addSessionExamples(examples, session, options, counters);
		}
	}

	const result: WebFineTuneExportResult = {
		exampleCount: examples.length,
		skippedCount: counters.skipped,
		redactionCount: counters.redactions,
		manifestJson: "",
	};
	if (options.format === "chatml" || options.format === "both") {
		result.chatmlJsonl = toChatMlJsonl(examples);
	}
	if (options.format === "alpaca" || options.format === "both") {
		result.alpacaJsonl = toAlpacaJsonl(examples);
	}
	result.manifestJson = `${JSON.stringify({
		schemaVersion: 1,
		mode: "finetune",
		generatedAt: new Date().toISOString(),
		source: options.source,
		format: options.format,
		counts: {
			artifactsRead,
			sessionsRead,
			examplesWritten: examples.length,
			skipped: counters.skipped,
			redactions: counters.redactions,
		},
		warnings: examples.length === 0 ? ["No fine-tuning examples were generated."] : [],
	}, null, 2)}\n`;
	return result;
}

export async function buildWebFineTuneExport(options: WebFineTuneExportOptions): Promise<WebFineTuneExportResult> {
	const metadata = await sessions.getAllMetadata();
	const sessionData = await Promise.all(metadata.map(async (entry) => sessions.loadSession(entry.id) as Promise<SessionData | null>));
	const [
		plans,
		maps,
		animations,
		verifications,
		benchmarks,
		evolutions,
	] = await Promise.all([
		keatingStorage.getLessonPlans(),
		keatingStorage.getLessonMaps(),
		keatingStorage.getAnimations(),
		keatingStorage.getVerifications(),
		keatingStorage.getBenchmarks(),
		keatingStorage.getEvolutions(),
	]);
	return buildWebFineTuneExportFromSources({
		plans,
		maps,
		animations,
		verifications,
		benchmarks,
		evolutions,
		sessions: sessionData.filter(Boolean) as SessionData[],
	}, options);
}
