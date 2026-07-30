import type {
	OpenUIDocumentMetadata,
	OpenUIInteractionLifecycle,
	OpenUIMessageSegment,
} from "./types";

const OPENUI_FENCE = /```openui(?:-lang)?(?:[ \t]+([^\n]*))?\n/g;
const DOCUMENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function hashProgram(program: string): string {
	let hash = 2166136261;
	for (let index = 0; index < program.length; index += 1) {
		hash ^= program.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function parseLifecycle(value: string | undefined): OpenUIInteractionLifecycle {
	if (value === "resumable" || value === "workspace") return value;
	return "ephemeral";
}

function parseRevision(value: string | undefined): number {
	if (value === undefined) return 0;
	if (!/^\d+$/.test(value)) return 0;
	const revision = Number(value);
	return Number.isSafeInteger(revision) ? revision : 0;
}

function parseMetadata(
	header: string | undefined,
	program: string,
	sourceIndex = 0,
	documentScope = "",
): OpenUIDocumentMetadata {
	const entries = new Map<string, string>();
	for (const token of header?.trim().split(/\s+/) ?? []) {
		const separator = token.indexOf("=");
		if (separator <= 0) continue;
		entries.set(token.slice(0, separator), token.slice(separator + 1));
	}
	const candidateId = entries.get("id");
	return {
		id: candidateId && DOCUMENT_ID.test(candidateId)
			? candidateId
			: `openui-${hashProgram(documentScope
				? `${documentScope}:${header ?? ""}:${sourceIndex}`
				: `${header ?? ""}:${sourceIndex}:${program}`)}`,
		lifecycle: parseLifecycle(entries.get("lifecycle")),
		revision: parseRevision(entries.get("revision")),
	};
}

function skipString(text: string, start: number): number {
	if (text[start] !== '"') return start;
	let index = start + 1;
	while (index < text.length) {
		if (text[index] === "\\") index += 2;
		else if (text[index] === '"') return index + 1;
		else index += 1;
	}
	return index;
}

function findClosingFence(text: string, bodyStart: number): { index: number; end: number } | null {
	let index = bodyStart;
	while (index < text.length) {
		const afterString = skipString(text, index);
		if (afterString > index) {
			index = afterString;
			continue;
		}

		const atLineStart = index === bodyStart || text[index - 1] === "\n";
		if (atLineStart && text.startsWith("```", index)) {
			const afterFence = index + 3;
			if (afterFence === text.length || text[afterFence] === "\n") {
				return {
					index: index === bodyStart ? index : index - 1,
					end: afterFence < text.length ? afterFence + 1 : afterFence,
				};
			}
		}
		index += 1;
	}
	return null;
}

/**
 * Return only top-level statements terminated by a newline. The OpenUI parser
 * intentionally auto-closes unfinished input, so passing it a partial
 * Question can mount a control before its choices or answer field exist.
 */
export function committedOpenUIProgram(program: string, fenceComplete = false): string {
	if (fenceComplete) return program.trimEnd();

	const stack: string[] = [];
	let inString = false;
	let escaped = false;
	let lastCommit = 0;

	for (let index = 0; index < program.length; index += 1) {
		const character = program[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') inString = false;
			continue;
		}

		if (character === '"') {
			inString = true;
			continue;
		}
		if (character === "(" || character === "[" || character === "{") {
			stack.push(character);
			continue;
		}
		if (character === ")" || character === "]" || character === "}") {
			const expected = character === ")" ? "(" : character === "]" ? "[" : "{";
			if (stack.at(-1) !== expected) return program.slice(0, lastCommit).trimEnd();
			stack.pop();
			continue;
		}
		if (character === "\n" && stack.length === 0) lastCommit = index + 1;
	}

	return program.slice(0, lastCommit).trimEnd();
}

/**
 * Split assistant text into Markdown and OpenUI programs.
 *
 * An opening fence produces a segment immediately, but only whole top-level
 * statements are committed to the renderer. Existing Markdown and legacy
 * `<keating-*>` tags remain untouched in text segments.
 */
export function parseOpenUIMessageSegments(text: string, documentScope = ""): OpenUIMessageSegment[] {
	const segments: OpenUIMessageSegment[] = [];
	let cursor = 0;
	OPENUI_FENCE.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = OPENUI_FENCE.exec(text)) !== null) {
		if (match.index > cursor) {
			segments.push({ type: "text", content: text.slice(cursor, match.index) });
		}

		const bodyStart = OPENUI_FENCE.lastIndex;
		const closing = findClosingFence(text, bodyStart);
		const bodyEnd = closing?.index ?? text.length;
		const rawProgram = text.slice(bodyStart, bodyEnd);
		segments.push({
			type: "openui",
			program: committedOpenUIProgram(rawProgram, closing !== null),
			rawProgram,
			complete: closing !== null,
			metadata: parseMetadata(match[1], rawProgram, match.index, documentScope),
		});

		if (!closing) {
			cursor = text.length;
			break;
		}
		cursor = closing.end;
		OPENUI_FENCE.lastIndex = cursor;
	}

	if (cursor < text.length) segments.push({ type: "text", content: text.slice(cursor) });
	if (segments.length === 0) segments.push({ type: "text", content: text });
	return segments;
}

/** Remove OpenUI source from text copied from an assistant message. */
export function stripOpenUIPrograms(text: string): string {
	return parseOpenUIMessageSegments(text)
		.filter((segment): segment is Extract<OpenUIMessageSegment, { type: "text" }> => segment.type === "text")
		.map((segment) => segment.content)
		.join("")
		.trim();
}

export const __test_parseOpenUIMetadata = parseMetadata;
