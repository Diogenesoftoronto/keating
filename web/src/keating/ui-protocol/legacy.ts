import {
	KEATING_UI_PROTOCOL,
	KEATING_UI_VERSION,
	type JsonObject,
	type UiDocument,
	type UiDocumentKind,
} from "./types";

const TAG_KIND: Record<string, UiDocumentKind> = {
	quiz: "quiz",
	question: "question",
	goal: "goal",
	deck: "deck",
	image: "image",
	animation: "scene",
	scene: "scene",
};

export interface LegacyDocumentOptions {
	id: string;
	revision?: number;
	title?: string;
}

export function decodeLegacyTagPayload(encoded: string): unknown {
	let value: unknown = encoded.trim();
	for (let pass = 0; pass < 2 && typeof value === "string"; pass++) {
		try {
			value = JSON.parse(value);
		} catch {
			break;
		}
	}
	return value;
}

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown): string[] | undefined {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function normalizePayload(kind: UiDocumentKind, raw: unknown): JsonObject {
	const source = object(raw);
	switch (kind) {
		case "quiz":
			return { ...source, topic: String(source.topic ?? "Quiz"), questions: Array.isArray(source.questions) ? source.questions : [] } as JsonObject;
		case "question": {
			const rawFields = Array.isArray(source.questions) ? source.questions : source.fields;
			const fields = Array.isArray(rawFields)
				? rawFields.map((field, index) => {
					const item = object(field);
					return { ...item, id: String(item.id ?? `question-${index + 1}`), prompt: String(item.prompt ?? item.question ?? "Question"), type: String(item.type ?? "text") };
				})
				: [{ id: "question-1", prompt: String(source.question ?? "Question"), type: String(source.type ?? "text"), choices: strings(source.choices) }];
			return { intro: typeof source.intro === "string" ? source.intro : undefined, topic: typeof source.topic === "string" ? source.topic : undefined, fields } as JsonObject;
		}
		case "goal":
			return { ...source, goalId: String(source.goalId ?? source.id ?? "legacy-goal"), title: String(source.title ?? "Goal"), status: String(source.status ?? "active"), steps: Array.isArray(source.steps) ? source.steps : [] } as JsonObject;
		case "deck":
			return { ...source, deckId: String(source.deckId ?? source.id ?? "legacy-deck"), topic: String(source.topic ?? "Flashcards"), title: String(source.title ?? "Flashcards"), cards: Array.isArray(source.cards) ? source.cards : [] } as JsonObject;
		case "image":
			return { ...source, title: String(source.title ?? "Generated image"), alt: String(source.alt ?? source.title ?? "Generated image") } as JsonObject;
		case "scene":
			return { ...source } as JsonObject;
		default:
			return { format: "json", data: raw as never };
	}
}

export function legacyPayloadToUiDocument(tagKind: string, payload: unknown, options: LegacyDocumentOptions): UiDocument {
	const kind = TAG_KIND[tagKind] ?? "generic";
	const normalized = kind === "generic"
		? { format: "json", data: payload as never, originalKind: tagKind }
		: normalizePayload(kind, payload);
	return {
		protocol: KEATING_UI_PROTOCOL,
		version: KEATING_UI_VERSION,
		id: options.id,
		revision: options.revision ?? 0,
		kind,
		...(options.title ? { title: options.title } : {}),
		payload: normalized,
	} as UiDocument;
}

/** Parses one legacy self-closing Keating tag emitted by browser tools. */
export function legacyTagToUiDocument(tag: string, options: LegacyDocumentOptions): UiDocument | undefined {
	const match = tag.match(/^<keating-([\w-]+)\s+(?:json|markdown)=((?:"(?:\\.|[^"\\])*")|(?:'[^']*'))\s*\/>$/s);
	if (!match) return undefined;
	const [, tagKind, encoded] = match;
	if (!tagKind || !encoded) return undefined;
	const decoded = decodeLegacyTagPayload(encoded[0] === "'" ? JSON.stringify(encoded.slice(1, -1)) : encoded);
	return legacyPayloadToUiDocument(tagKind, decoded, options);
}

