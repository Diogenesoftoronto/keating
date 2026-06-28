// Pure, dependency-free fine-tune JSONL parsing shared by the CLI importer
// (src/core/import.ts) and the web importer (web/src/keating/import.ts).
//
// This module must stay import-free so it type-checks under both the CLI's
// NodeNext resolution and the web app's bundler resolution.

export type FineTuneImportFormat = "auto" | "chatml" | "alpaca";

export type ImportedRole = "system" | "user" | "assistant";

export interface ImportedMessage {
	role: ImportedRole;
	content: string;
}

/**
 * Optional per-conversation metadata carried in the `keating` envelope of a
 * conversation-per-line ChatML export. Present only on lossless exports; lets
 * the importer reconstruct a faithful, resumable session.
 */
export interface ImportedSessionMeta {
	title?: string;
	thinkingLevel?: string;
	sessionId?: string;
	source?: string;
	/** Opaque model descriptor; validated by the consumer. */
	model?: unknown;
	/** Full-fidelity original messages (AgentMessage[]) for lossless resume. */
	rawMessages?: unknown[];
}

export interface ImportedExample {
	messages: ImportedMessage[];
	meta?: ImportedSessionMeta;
}

export interface ParsedImport {
	imported: ImportedExample[];
	skipped: number;
	warnings: string[];
}

export function inferFormat(
	name: string,
	format: FineTuneImportFormat = "auto",
): Exclude<FineTuneImportFormat, "auto"> {
	if (format !== "auto") return format;
	return name.toLowerCase().includes("alpaca") ? "alpaca" : "chatml";
}

export function parseJsonl(
	text: string,
	name: string,
): { values: unknown[]; skipped: number; warnings: string[] } {
	const values: unknown[] = [];
	const warnings: string[] = [];
	let skipped = 0;
	const lines = text.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index].trim();
		if (!line) continue;
		try {
			values.push(JSON.parse(line));
		} catch {
			skipped += 1;
			warnings.push(`Skipped invalid JSONL line ${index + 1} in ${name}.`);
		}
	}
	return { values, skipped, warnings };
}

export function normalizeMessage(value: unknown): ImportedMessage | null {
	const raw = value && typeof value === "object" ? (value as { role?: unknown; content?: unknown }) : null;
	if (!raw) return null;
	const role = raw.role === "system" || raw.role === "user" || raw.role === "assistant" ? raw.role : null;
	const content = typeof raw.content === "string" ? raw.content.trim() : "";
	return role && content ? { role, content } : null;
}

function parseSessionMeta(value: unknown): ImportedSessionMeta | undefined {
	const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
	if (!raw) return undefined;
	const meta: ImportedSessionMeta = {};
	if (typeof raw.title === "string") meta.title = raw.title;
	if (typeof raw.thinkingLevel === "string") meta.thinkingLevel = raw.thinkingLevel;
	if (typeof raw.sessionId === "string") meta.sessionId = raw.sessionId;
	if (typeof raw.source === "string") meta.source = raw.source;
	if (raw.model && typeof raw.model === "object") meta.model = raw.model;
	if (Array.isArray(raw.messages)) meta.rawMessages = raw.messages;
	return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Parses ChatML JSONL. Each line is an independent example/conversation:
 * `{ messages: [...turns...], keating?: { ...envelope... } }`. Multi-turn
 * conversations (with `system` turns) and legacy single user/assistant pairs
 * are both supported. The optional `keating` envelope is captured for lossless
 * resume.
 */
export function parseChatMl(values: unknown[]): ParsedImport {
	const imported: ImportedExample[] = [];
	let skipped = 0;
	for (const value of values) {
		const raw = value && typeof value === "object" ? (value as { messages?: unknown; keating?: unknown }) : null;
		const parsed = Array.isArray(raw?.messages)
			? raw.messages.map(normalizeMessage).filter((message): message is ImportedMessage => Boolean(message))
			: [];
		if (parsed.some((message) => message.role === "user") && parsed.some((message) => message.role === "assistant")) {
			const meta = parseSessionMeta(raw?.keating);
			imported.push(meta ? { messages: parsed, meta } : { messages: parsed });
		} else {
			skipped += 1;
		}
	}
	return { imported, skipped, warnings: [] };
}

/** Parses Alpaca JSONL (`{ instruction, input?, output }`). Inherently
 *  single-turn/training-only — each line becomes one user/assistant example. */
export function parseAlpaca(values: unknown[]): ParsedImport {
	const imported: ImportedExample[] = [];
	let skipped = 0;
	for (const value of values) {
		const raw =
			value && typeof value === "object"
				? (value as { instruction?: unknown; input?: unknown; output?: unknown })
				: null;
		const instruction = typeof raw?.instruction === "string" ? raw.instruction.trim() : "";
		const input = typeof raw?.input === "string" ? raw.input.trim() : "";
		const output = typeof raw?.output === "string" ? raw.output.trim() : "";
		if (!instruction || !output) {
			skipped += 1;
			continue;
		}
		imported.push({
			messages: [
				{ role: "user", content: input ? `${instruction}\n\n${input}` : instruction },
				{ role: "assistant", content: output },
			],
		});
	}
	return { imported, skipped, warnings: [] };
}

export function exampleKey(example: ImportedExample): string {
	return JSON.stringify(example.messages.map((message) => [message.role, message.content]));
}

export function addUniqueExamples(
	target: ImportedExample[],
	seen: Set<string>,
	examples: ImportedExample[],
): number {
	let added = 0;
	for (const example of examples) {
		const key = exampleKey(example);
		if (seen.has(key)) continue;
		seen.add(key);
		target.push(example);
		added += 1;
	}
	return added;
}
