import type { UiAction, UiActionReceipt, UiDocument } from "@keating/learner-contracts";

/** How long an OpenUI learning document should remain available. */
export type OpenUIInteractionLifecycle = "ephemeral" | "resumable" | "workspace";

/** Metadata carried by an `openui` fenced block. */
export interface OpenUIDocumentMetadata {
	id: string;
	lifecycle: OpenUIInteractionLifecycle;
	revision: number;
	/** Owning session/fork for durable learner-turn delivery. */
	sessionId?: string;
	/** Previous deterministic ids accepted only for state migration. */
	legacyIds?: readonly string[];
}

/** Stable persisted identity used to isolate identical fences across forks. */
export interface OpenUIDocumentScope {
	sessionId: string;
	messageId: string;
}

export type OpenUIMessageSegment =
	| { type: "text"; content: string }
	| {
		type: "openui";
		format: "source";
			/** Longest prefix containing only complete top-level statements. */
			program: string;
			/** Full source received so far, including an unfinished tail. */
			rawProgram: string;
			complete: boolean;
			metadata: OpenUIDocumentMetadata;
	  }
	| {
		type: "openui";
		format: "document";
		/** Empty for canonical JSON; retained so legacy source consumers fail closed. */
		program: string;
		rawProgram: string;
		complete: boolean;
		document?: UiDocument;
		error?: string;
		metadata: OpenUIDocumentMetadata;
	  };

/** A legacy source-renderer action retained until grouped semantics migrate. */
export interface LegacyKeatingOpenUIAction {
	kind?: "legacy";
	type: string;
	humanFriendlyMessage: string;
	params: Record<string, unknown>;
	formState?: Record<string, unknown>;
	formName?: string;
	document: OpenUIDocumentMetadata;
}

/** A validated shared-contract action emitted only after its receipt commits. */
export interface CanonicalKeatingOpenUIAction {
	kind: "canonical";
	type: UiAction["type"];
	humanFriendlyMessage: string;
	params: Record<string, unknown>;
	formState?: Record<string, unknown>;
	formName?: string;
	document: OpenUIDocumentMetadata;
	action: UiAction;
	sourceDocument: UiDocument;
	receipt: UiActionReceipt;
}

export type KeatingOpenUIAction = LegacyKeatingOpenUIAction | CanonicalKeatingOpenUIAction;
