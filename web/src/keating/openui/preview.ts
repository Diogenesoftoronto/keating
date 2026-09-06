import type { UiDocument, UiDocumentNode, UiStudyPlanItem } from "@keating/learner-contracts";
import { tryCompileOpenUISourceToSharedDocument } from "@keating/learner-contracts";
import { parseOpenUIMessageSegments } from "./segments";
import type { OpenUIDocumentScope, OpenUIMessageSegment } from "./types";

/**
 * An inert reading of an assistant turn, for surfaces that judge a response
 * rather than let the learner use it — the response-comparison dialog and the
 * trajectory review canvas.
 *
 * Mounting the live document on those surfaces would create interactive
 * controls for a turn that may be discarded, write per-document state into
 * storage, and dispatch actions with no host handler attached. So prose is kept
 * in full — it is the thing under judgement — and every interactive or visual
 * artifact collapses to a chip.
 */
export type OpenUIPreviewBlock =
	| {
		type: "prose";
		id: string;
		markdown: string;
		/**
		 * Offset of `markdown` within the original message text, present only
		 * when the prose is verbatim source. Review annotations anchor to these
		 * offsets; prose lifted out of a compiled document has no stable anchor
		 * and omits the field.
		 */
		sourceStart?: number;
	  }
	| { type: "artifact"; id: string; kind: OpenUIPreviewArtifactKind; label: string; detail?: string };

export type OpenUIPreviewArtifactKind =
	| "study-plan"
	| "concept-map"
	| "question"
	| "quiz"
	| "deck"
	| "goal"
	| "notes"
	| "image"
	| "media"
	| "artifact"
	| "handoff"
	| "task"
	| "simulation"
	| "unavailable";

function countPlanItems(items: readonly UiStudyPlanItem[] | undefined): number {
	if (!items) return 0;
	return items.reduce((total, item) => total + 1 + countPlanItems(item.children), 0);
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function truncate(value: string, limit = 80): string {
	const collapsed = value.replace(/\s+/g, " ").trim();
	return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

/** Collapse one contract node into either readable prose or a single chip. */
function blockForNode(node: UiDocumentNode, prefix: string): OpenUIPreviewBlock | null {
	const id = `${prefix}:${node.id}`;
	switch (node.type) {
		case "markdown":
			return node.markdown.trim() ? { type: "prose", id, markdown: node.markdown.trim() } : null;
		case "callout":
			return { type: "prose", id, markdown: node.title ? `**${node.title}** — ${node.markdown}` : node.markdown };
		case "study-plan": {
			const count = countPlanItems(node.items);
			return { type: "artifact", id, kind: "study-plan", label: node.title ?? "Study plan", ...(count ? { detail: plural(count, "item") } : {}) };
		}
		case "concept-map":
			return { type: "artifact", id, kind: "concept-map", label: node.title ?? "Concept map" };
		case "question":
			return { type: "artifact", id, kind: "question", label: "Question", detail: truncate(node.prompt) };
		case "question-group":
			return { type: "artifact", id, kind: "question", label: node.title ?? "Questions", detail: plural(node.questions.length, "question") };
		case "quiz":
			return { type: "artifact", id, kind: "quiz", label: node.title, detail: plural(node.questions.length, "question") };
		case "deck":
			return { type: "artifact", id, kind: "deck", label: node.title, detail: plural(node.cards.length, "card") };
		case "goal":
			return { type: "artifact", id, kind: "goal", label: node.title, detail: plural(node.steps.length, "step") };
		case "notes":
			return { type: "artifact", id, kind: "notes", label: node.title, detail: "shared notes" };
		case "image":
			return { type: "artifact", id, kind: "image", label: "Image", detail: truncate(node.alt) };
		case "media":
			return { type: "artifact", id, kind: "media", label: node.kind === "animation" ? "Animation" : node.kind === "audio" ? "Audio" : "Video" };
		case "artifact":
			return { type: "artifact", id, kind: "artifact", label: "Attached artifact" };
		case "handoff":
			return { type: "artifact", id, kind: "handoff", label: "Handoff", detail: node.target };
		case "simulation":
			return { type: "artifact", id, kind: "simulation", label: node.title, detail: `${plural(node.parameters.length, "parameter")} · ${plural(node.readouts.length, "readout")}` };
		case "task": {
			const badge = node.kind === "practice" ? "Practice" : node.kind === "draft" ? "Draft" : node.kind === "fieldwork" ? "Fieldwork" : "Assignment";
			const parts = [
				badge,
				...(node.items?.length ? [plural(node.items.length, node.kind === "practice" ? "exercise" : node.kind === "fieldwork" ? "step" : "step")] : []),
				...(node.estimatedMinutes !== undefined ? [`~${node.estimatedMinutes} min`] : []),
			];
			return { type: "artifact", id, kind: "task", label: node.title, detail: parts.join(" · ") };
		}
		default:
			return null;
	}
}

function documentForSegment(segment: Extract<OpenUIMessageSegment, { type: "openui" }>): UiDocument | undefined {
	if (segment.format === "document") return segment.document;
	const source = segment.program || segment.rawProgram;
	if (!segment.complete || !source.trim()) return undefined;
	const compiled = tryCompileOpenUISourceToSharedDocument(source, {
		documentId: segment.metadata.id,
		revision: segment.metadata.revision,
	});
	return compiled.ok ? compiled.document : undefined;
}

/**
 * Split an assistant turn into readable prose and inert artifact chips,
 * preserving document order so the preview reads the way the thread did.
 */
export function buildOpenUIPreview(text: string, scope: string | OpenUIDocumentScope = ""): OpenUIPreviewBlock[] {
	const blocks: OpenUIPreviewBlock[] = [];
	let cursor = 0;
	parseOpenUIMessageSegments(text, scope).forEach((segment, index) => {
		if (segment.type === "text") {
			// Text segments are verbatim slices of `text` in order, so searching
			// forward from the cursor lands on this segment and not an earlier
			// lookalike. Trimming for display shifts the offset by the leading run.
			const found = text.indexOf(segment.content, cursor);
			const start = found < 0 ? cursor : found;
			cursor = start + segment.content.length;
			const leading = segment.content.length - segment.content.trimStart().length;
			const markdown = segment.content.trim();
			if (markdown) blocks.push({ type: "prose", id: `text:${index}`, markdown, sourceStart: start + leading });
			return;
		}
		// Advance past the fence body; the closing fence is skipped by the next
		// text segment's own forward search.
		const body = text.indexOf(segment.rawProgram, cursor);
		cursor = body < 0 ? cursor : body + segment.rawProgram.length;
		const document = documentForSegment(segment);
		if (!document) {
			blocks.push({ type: "artifact", id: `openui:${index}`, kind: "unavailable", label: "Interactive artifact", detail: "preview unavailable" });
			return;
		}
		for (const node of document.nodes) {
			const block = blockForNode(node, `openui:${index}`);
			if (block) blocks.push(block);
		}
	});
	return blocks;
}
