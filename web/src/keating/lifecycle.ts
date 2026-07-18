export interface LearningEvidenceEvent {
	kind: "question" | "quiz" | "flashcard" | "feedback" | "goal";
	topic?: string;
	score?: number;
	payload?: unknown;
}

export interface LearningArtifactEvent {
	kind: string;
	id?: string;
	payload?: unknown;
}

export type KeatingLifecycleEvent =
	| { type: "session_start"; sessionId: string }
	| { type: "before_turn"; sessionId: string; topic?: string }
	| { type: "interaction_committed"; sessionId: string; evidence: LearningEvidenceEvent }
	| { type: "artifact_finalized"; sessionId: string; artifact: LearningArtifactEvent }
	| { type: "session_idle"; sessionId: string }
	| { type: "session_end"; sessionId: string }
	| { type: "topic_shift"; sessionId: string; fromCategory: string; toCategory: string; sampleText?: string };

type EventOfType<T extends KeatingLifecycleEvent["type"]> = Extract<KeatingLifecycleEvent, { type: T }>;
export type KeatingLifecycleHandler<T extends KeatingLifecycleEvent["type"]> = (
	event: EventOfType<T>,
) => void | Promise<void>;

/**
 * Framework-neutral lifecycle bus shared by React, OpenTUI, and future hosts.
 * Handlers run in registration order and one failed observer cannot prevent
 * evidence persistence or another host integration from running.
 */
export class KeatingLifecycle {
	private readonly handlers = new Map<KeatingLifecycleEvent["type"], Set<(event: KeatingLifecycleEvent) => void | Promise<void>>>();

	on<T extends KeatingLifecycleEvent["type"]>(
		type: T,
		handler: KeatingLifecycleHandler<T>,
	): () => void {
		const handlers = this.handlers.get(type) ?? new Set();
		handlers.add(handler as (event: KeatingLifecycleEvent) => void | Promise<void>);
		this.handlers.set(type, handlers);
		return () => {
			handlers.delete(handler as (event: KeatingLifecycleEvent) => void | Promise<void>);
			if (handlers.size === 0) this.handlers.delete(type);
		};
	}

	async emit(event: KeatingLifecycleEvent): Promise<Error[]> {
		const errors: Error[] = [];
		for (const handler of this.handlers.get(event.type) ?? []) {
			try {
				await handler(event);
			} catch (error) {
				const normalized = error instanceof Error ? error : new Error(String(error));
				errors.push(normalized);
				console.warn(`Keating lifecycle handler failed for ${event.type}:`, normalized);
			}
		}
		return errors;
	}
}

export const keatingLifecycle = new KeatingLifecycle();
