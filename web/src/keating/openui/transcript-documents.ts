import { tryCompileOpenUISourceToSharedDocument, type UiDocument } from "@keating/learner-contracts";
import { parseOpenUIMessageSegments } from "./segments";
import type { OpenUIDocumentScope } from "./types";

/**
 * Rebuilds presented OpenUI documents from a saved session transcript, with
 * the same document scope the chat renderer uses, so ids match presentation
 * records and the action journal. Used when a presentation record carries no
 * snapshot (homework, the session materials panel).
 */

interface SessionMessage { role?: unknown; content?: unknown; timestamp?: unknown }

export interface TranscriptDocument {
	document: UiDocument;
	/** Timestamp of the assistant message that presented it, when known. */
	messageTimestamp?: number;
}

/** Plain text of a stored message's content (string or text parts). */
export function transcriptMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").filter(Boolean).join("\n");
}

/** Complete, valid documents in one message's text, compiled under `scope`. */
export function documentsInScope(text: string, scope: OpenUIDocumentScope): UiDocument[] {
	return parseOpenUIMessageSegments(text, scope).flatMap((segment) => {
		if (segment.type !== "openui" || !segment.complete) return [];
		if (segment.format === "document") return segment.error || !segment.document ? [] : [segment.document];
		const compiled = tryCompileOpenUISourceToSharedDocument(segment.program || segment.rawProgram, {
			documentId: segment.metadata.id,
			revision: segment.metadata.revision,
			retention: segment.metadata.lifecycle,
		});
		return compiled.ok ? [compiled.document] : [];
	});
}

/** Complete, valid documents in one message, under the chat renderer's scope. */
export function transcriptDocumentsIn(text: string, sessionId: string, messageId: string): UiDocument[] {
	return documentsInScope(text, { sessionId, messageId });
}

const OFFSETS = [0, ...Array.from({ length: 40 }, (_, step) => (step % 2 ? -1 : 1) * (Math.floor(step / 2) + 1))];

/**
 * Chat message ids are `assistant-${index}-${timestamp}`; the index is the
 * array position, which is tried first, with a scan of nearby positions for
 * native session trees. `relevant` skips messages that present nothing the
 * caller wants (scope changes ids, not content), and `onAssistantMessage`
 * sees every assistant message's text in order.
 */
export function indexTranscriptDocuments(
	sessionId: string,
	messages: readonly unknown[],
	wanted: ReadonlySet<string>,
	relevant: (document: UiDocument) => boolean,
	onAssistantMessage?: (text: string, timestamp: number | undefined) => void,
): Map<string, TranscriptDocument> {
	const documents = new Map<string, TranscriptDocument>();
	messages.forEach((raw, index) => {
		const message = raw as SessionMessage;
		if (message?.role !== "assistant") return;
		const text = transcriptMessageText(message.content);
		const timestamp = typeof message.timestamp === "number" ? message.timestamp : undefined;
		onAssistantMessage?.(text, timestamp);
		if (!text.includes("openui") || documents.size >= wanted.size) return;
		const atIndex = transcriptDocumentsIn(text, sessionId, `assistant-${index}-${timestamp ?? ""}`);
		if (!atIndex.some(relevant)) return;
		for (const offset of OFFSETS) {
			const candidate = index + offset;
			if (candidate < 0) continue;
			const found = transcriptDocumentsIn(text, sessionId, `assistant-${candidate}-${timestamp ?? ""}`).filter((document) => wanted.has(document.id));
			if (!found.length) continue;
			for (const document of found) documents.set(document.id, { document, ...(timestamp !== undefined ? { messageTimestamp: timestamp } : {}) });
			break;
		}
	});
	return documents;
}
