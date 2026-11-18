import { classifyOpenUiCue } from "../../../../packages/learner-contracts/src/openui-diagnostic-turn";
import { parseInteractiveSegments } from "../../components/interactive-segments";
import { tryCompileOpenUISourceToSharedDocument } from "./shared-bridge";
import type { OpenUIMessageSegment } from "./types";

/**
 * Presentation order for a finished reply whose learner asked to work a model
 * themselves: the working control first, the prose written ahead of it kept
 * whole and in order behind a native disclosure. Nothing is removed or reworded.
 */
export interface HandsOnFirstLayout {
	/** Index of the single simulation segment. */
	control: number;
	/** Indexes of the text segments that were written ahead of the control. */
	lead: number[];
}

/**
 * The learner also asked to be told something. Those replies keep the authored
 * order, so the explanation they asked for stays in front of the control.
 */
const EXPLANATION_REQUEST = /\b(?:explain(?:s|ed|ing)?|explanations?|why|understand|walk me through|talk me through|teach me|describe|derive|derivation|step[- ]by[- ]step|tell me (?:how|why|what|about)|show me (?:how|why)|how (?:does|do|did|is|are|can|could|would|come)|what (?:is|are|does|do|makes?))\b/i;

/**
 * Wording that marks lead prose as something the learner may need before
 * acting. The check is deliberately broad: a hit keeps the authored order.
 */
const REQUIRED_READING = /\b(?:warning|caution|careful|danger(?:ous)?|hazard|safety|unsafe|important|note|required|requirement|must|do not|don['’]t|never|before you|first,|make sure|deadline|due)\b/i;

const CODE_FENCE = /^[ \t]*(?:```|~~~)/m;
const paragraphs = (text: string) => text.split(/\n[ \t]*\n/u).filter((block) => block.trim()).length;

/** The learner asked to change something themselves, and did not also ask for an explanation. */
export function isHandsOnRequest(learnerRequest: string | null | undefined): boolean {
	if (!learnerRequest?.trim() || learnerRequest.includes("<!--")) return false;
	const cue = classifyOpenUiCue(learnerRequest);
	if (cue.kind !== "implicit-action" && cue.kind !== "explicit-interface") return false;
	return cue.targets.includes("simulation") && !EXPLANATION_REQUEST.test(learnerRequest);
}

function isLoneSimulation(segment: Extract<OpenUIMessageSegment, { type: "openui" }>): boolean {
	if (!segment.complete) return false;
	let document = segment.format === "document" && !segment.error ? segment.document : undefined;
	if (segment.format === "source") {
		const compiled = tryCompileOpenUISourceToSharedDocument(segment.rawProgram, {
			documentId: segment.metadata.id, revision: segment.metadata.revision, retention: segment.metadata.lifecycle,
		});
		if (compiled.ok) document = compiled.document;
	}
	return document?.nodes.length === 1 && document.nodes[0]?.type === "simulation";
}

/** Plain prose only: no code and no legacy cards, which keep their authored position. */
function isPlainProse(text: string): boolean {
	return !CODE_FENCE.test(text) && parseInteractiveSegments(text).every((part) => part.type === "text");
}

/**
 * Returns the control-first order, or null to keep the reply exactly as
 * authored. Any doubt resolves to null. Callers pass segments of a finished
 * reply only; a streaming reply is never reordered.
 */
export function handsOnFirstLayout(
	segments: readonly OpenUIMessageSegment[],
	learnerRequest: string | null | undefined,
): HandsOnFirstLayout | null {
	if (!isHandsOnRequest(learnerRequest)) return null;
	const controls = segments.flatMap((segment, index) => segment.type === "openui" ? [index] : []);
	const control = controls[0];
	if (controls.length !== 1 || control === undefined) return null;
	const segment = segments[control];
	if (segment?.type !== "openui" || !isLoneSimulation(segment)) return null;
	const lead: number[] = [];
	let leadText = "";
	for (const [index, part] of segments.entries()) {
		if (part.type !== "text") continue;
		if (!isPlainProse(part.content)) return null;
		if (index < control && part.content.trim()) { lead.push(index); leadText += part.content; }
	}
	// A single lead-in paragraph is context for the control and stays where it was written.
	if (paragraphs(leadText) < 2 || REQUIRED_READING.test(leadText)) return null;
	return { control, lead };
}
