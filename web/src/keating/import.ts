import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { DEFAULT_MODEL } from "../hooks/keating-stream";
import { sessionModelMetadata } from "../hooks/session-metadata";
import type { SessionData, SessionMetadata } from "../types/session";
import { DEFAULT_UI_SETTINGS } from "./ui-settings";
import {
	addUniqueExamples,
	inferFormat,
	parseAlpaca,
	parseChatMl,
	parseJsonl,
	type FineTuneImportFormat,
	type ImportedExample,
} from "../../../shared/finetune-parse";

export type WebFineTuneImportFormat = FineTuneImportFormat;

export interface WebFineTuneImportFile {
	name: string;
	text: string;
	format?: WebFineTuneImportFormat;
}

export interface WebFineTuneImportResult {
	filesRead: number;
	examplesImported: number;
	skipped: number;
	sessionsImported: number;
	warnings: string[];
	sessions: SessionData[];
}

/** Builds valid AgentMessages from one imported example. Prefers the original
 *  full-fidelity messages (lossless resume) when the export carried them. */
function messagesFromExample(example: ImportedExample): AgentMessage[] {
	if (example.meta?.rawMessages && example.meta.rawMessages.length > 0) {
		return example.meta.rawMessages as AgentMessage[];
	}
	return example.messages.map(
		(message) => ({ role: message.role, content: [{ type: "text", text: message.content }] }) as AgentMessage,
	);
}

export function buildFineTuneImportSessionsFromFiles(
	files: WebFineTuneImportFile[],
	options: { title?: string; now?: number; model?: Model<Api>; thinkingLevel?: ThinkingLevel } = {},
): WebFineTuneImportResult {
	const importedExamples: ImportedExample[] = [];
	const seenExamples = new Set<string>();
	const warnings: string[] = [];
	let examplesImported = 0;
	let skipped = 0;

	for (const file of files) {
		if (!file.name.toLowerCase().endsWith(".jsonl")) {
			warnings.push(`Skipped non-JSONL file: ${file.name}.`);
			skipped += 1;
			continue;
		}
		const jsonl = parseJsonl(file.text, file.name);
		skipped += jsonl.skipped;
		warnings.push(...jsonl.warnings);
		const parsed = inferFormat(file.name, file.format) === "alpaca" ? parseAlpaca(jsonl.values) : parseChatMl(jsonl.values);
		examplesImported += addUniqueExamples(importedExamples, seenExamples, parsed.imported);
		skipped += parsed.skipped;
		warnings.push(...parsed.warnings);
	}

	if (examplesImported === 0 || importedExamples.length === 0) {
		return { filesRead: files.length, examplesImported: 0, skipped, sessionsImported: 0, warnings, sessions: [] };
	}

	const baseStamp = new Date(options.now ?? Date.now()).toISOString();
	const baseTitle = options.title?.trim();
	// One resumable session per imported example — never flatten independent
	// examples into a single fake conversation.
	const sessions: SessionData[] = importedExamples.map((example, index) => {
		const createdAt = new Date((options.now ?? Date.now()) + index).toISOString();
		const meta = example.meta;
		const fallbackTitle =
			baseTitle && importedExamples.length > 1
				? `${baseTitle} (${index + 1}/${importedExamples.length})`
				: baseTitle || `Imported fine-tune session ${index + 1}`;
		return {
			id: meta?.sessionId ? `${meta.sessionId}-import-${index}` : `imported-finetune-${baseStamp.replace(/[:.]/g, "-")}-${index}`,
			title: meta?.title?.trim() || fallbackTitle,
			model: (meta?.model as Model<Api> | undefined) ?? options.model ?? DEFAULT_MODEL,
			thinkingLevel: (meta?.thinkingLevel as ThinkingLevel | undefined) ?? options.thinkingLevel ?? DEFAULT_UI_SETTINGS.reasoningLevel,
			createdAt,
			lastModified: createdAt,
			messages: messagesFromExample(example),
		};
	});

	return {
		filesRead: files.length,
		examplesImported,
		skipped,
		sessionsImported: sessions.length,
		warnings,
		sessions,
	};
}

export async function importFineTuneFiles(
	files: WebFineTuneImportFile[],
	options: { title?: string; model?: Model<Api>; thinkingLevel?: ThinkingLevel } = {},
): Promise<WebFineTuneImportResult> {
	const [{ sessionPreview, sessionUsage }, { getInitPromise, sessions }, { resolveAvailableChatModel }, { loadKeatingUiSettings }] =
		await Promise.all([
			import("../hooks/session-metadata"),
			import("../hooks/keating-storage"),
			import("../lib/provider-models"),
			import("./ui-settings"),
		]);
	await getInitPromise();
	const model = await resolveAvailableChatModel(options.model ?? DEFAULT_MODEL);
	const thinkingLevel = options.thinkingLevel ?? loadKeatingUiSettings().reasoningLevel;
	const result = buildFineTuneImportSessionsFromFiles(files, { ...options, model, thinkingLevel });
	for (const session of result.sessions) {
		const metadata: SessionMetadata = {
			id: session.id,
			title: session.title,
			createdAt: session.createdAt,
			lastModified: session.lastModified,
			messageCount: session.messages.length,
			usage: sessionUsage(session.messages),
			thinkingLevel: session.thinkingLevel,
			...sessionModelMetadata(session.model),
			preview: sessionPreview(session.messages),
		};
		await sessions.save(session, metadata);
	}
	if (result.sessions.length > 0 && typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
	}
	return result;
}
