/** How long an OpenUI learning document should remain available. */
export type OpenUIInteractionLifecycle = "ephemeral" | "resumable" | "workspace";

/** Metadata carried by an `openui` fenced block. */
export interface OpenUIDocumentMetadata {
	id: string;
	lifecycle: OpenUIInteractionLifecycle;
	revision: number;
}

export type OpenUIMessageSegment =
	| { type: "text"; content: string }
	| {
		type: "openui";
			/** Longest prefix containing only complete top-level statements. */
			program: string;
			/** Full source received so far, including an unfinished tail. */
			rawProgram: string;
			complete: boolean;
			metadata: OpenUIDocumentMetadata;
	  };

/** A host-level action emitted by an OpenUI learning component. */
export interface KeatingOpenUIAction {
	type: string;
	humanFriendlyMessage: string;
	params: Record<string, unknown>;
	formState?: Record<string, unknown>;
	formName?: string;
	document: OpenUIDocumentMetadata;
}
