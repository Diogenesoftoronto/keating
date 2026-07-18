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
			program: string;
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
