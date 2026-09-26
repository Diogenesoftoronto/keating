import {
	projectActiveWork,
	tryCompileOpenUISourceToSharedDocument,
	type ActiveWork,
	type ActiveWorkAttempt,
	type ActiveWorkPresentation,
	type UiDocument,
} from "@keating/learner-contracts";
import type { StorageLike } from "../event-store";
import { loadSharedUiActionState } from "../openui/shared-actions";
import { parseOpenUIMessageSegments } from "../openui/segments";
import type { OpenUIDocumentScope } from "../openui/types";
import type { OpenUiPresentationRecord, QuestionCheckRecord } from "../storage";

/** Prose and layout nodes; every other component is recorded so policy can see what was used. */
const NON_INTERACTIVE = new Set(["markdown", "text", "callout", "rows"]);

export interface ActiveWorkSource {
	getOpenUiPresentations(sessionId?: string): Promise<OpenUiPresentationRecord[]>;
	getQuestionChecks(): Promise<QuestionCheckRecord[]>;
}

function documentsIn(text: string, scope: OpenUIDocumentScope): UiDocument[] {
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

/**
 * Presentation records for one released assistant turn, linked to the plan
 * item that was the focus when it appeared. Document ids use the same scope
 * as the chat renderer so learner actions join back to these records.
 */
export function presentationsFromAssistantText(
	text: string,
	scope: OpenUIDocumentScope,
	planRef: OpenUiPresentationRecord["planRef"],
	now = Date.now(),
): OpenUiPresentationRecord[] {
	return documentsIn(text, scope).flatMap((document) => document.nodes
		.filter((node) => !NON_INTERACTIVE.has(node.type))
		.map((node) => ({
			id: `${document.id}:${node.id}`,
			documentId: document.id,
			revision: document.revision,
			nodeId: node.id,
			component: node.type,
			sessionId: scope.sessionId,
			createdAt: now,
			// A plan's own nodes are never evidence for one of its items.
			planRef: node.type === "study-plan" ? null : planRef,
			...(node.type === "study-plan" ? { document } : {}),
		})));
}

function attemptsFrom(checks: readonly QuestionCheckRecord[]): ActiveWorkAttempt[] {
	return checks.flatMap((check) => check.source ? [{
		documentId: check.source.documentId,
		nodeId: check.source.nodeId,
		createdAt: check.createdAt,
		grading: check.grading,
		...(typeof check.score === "number" && check.grading !== "pending" ? { score: check.score } : {}),
	}] : []);
}

/** The newest study plan shown in this session, advanced to its latest learner-updated revision. */
function activePlan(records: readonly OpenUiPresentationRecord[], storage: Pick<StorageLike, "getItem"> | null): UiDocument | null {
	const latest = records
		.filter((record) => record.component === "study-plan" && record.document)
		.sort((a, b) => b.createdAt - a.createdAt)[0];
	if (!latest?.document) return null;
	return loadSharedUiActionState(storage, latest.document).document;
}

function browserStorage(): Pick<StorageLike, "getItem"> | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export async function loadActiveWork(
	source: ActiveWorkSource,
	sessionId: string | null | undefined,
	storage: Pick<StorageLike, "getItem"> | null = browserStorage(),
): Promise<ActiveWork> {
	if (!sessionId) return projectActiveWork({ plan: null, presentations: [], attempts: [] });
	const [records, checks] = await Promise.all([source.getOpenUiPresentations(sessionId), source.getQuestionChecks()]);
	const presentations: ActiveWorkPresentation[] = records.map((record) => ({
		documentId: record.documentId,
		nodeId: record.nodeId,
		component: record.component,
		presentedAt: record.createdAt,
		planDocumentId: record.planRef?.documentId ?? null,
		planItemId: record.planRef?.itemId ?? null,
	}));
	return projectActiveWork({
		plan: activePlan(records, storage),
		presentations,
		attempts: attemptsFrom(checks.filter((check) => check.sessionId === sessionId)),
	});
}

/**
 * Record a released assistant turn. The focus is read before writing, so a
 * turn that both presents a new plan and asks a question links the question
 * to the previous focus, never to a plan the learner has not seen yet.
 */
export async function recordAssistantPresentations(
	source: ActiveWorkSource & { recordOpenUiPresentations(records: readonly OpenUiPresentationRecord[]): Promise<number> },
	text: string,
	scope: OpenUIDocumentScope,
): Promise<number> {
	if (!text.includes("openui")) return 0;
	const work = await loadActiveWork(source, scope.sessionId);
	const planRef = work.plan && work.focus ? { documentId: work.plan.documentId, itemId: work.focus.itemId } : null;
	return source.recordOpenUiPresentations(presentationsFromAssistantText(text, scope, planRef));
}
