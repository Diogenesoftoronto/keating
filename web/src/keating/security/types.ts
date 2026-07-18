export type ToolRiskClass =
	| "informational"
	| "sensitive-read"
	| "state-change"
	| "external-side-effect"
	| "code-execution"
	| "destructive";

export type InvocationSurface = "text" | "voice" | "automation";

export type ContentTrust = "trusted" | "untrusted-web" | "mixed" | "unknown";

export interface ToolProvenance {
	trust: ContentTrust;
	sourceIds?: readonly string[];
	/** True only when the user independently requested the action, outside fetched content. */
	userAuthorized?: boolean;
}

export interface ToolSecurityDescriptor {
	name: string;
	risk: ToolRiskClass;
	/** False means the tool was not present in the audited catalog. */
	known?: boolean;
	/** Tool arguments may contain credentials, private learner data, or equivalent secrets. */
	sensitiveArguments?: boolean;
	/** Voice is disabled by default for code execution and destructive tools. */
	allowVoice?: boolean;
}

export interface ToolPermissionRequest {
	tool: ToolSecurityDescriptor;
	surface: InvocationSurface;
	provenance: ToolProvenance;
	arguments?: unknown;
}

export interface ToolExecutionContext {
	sessionId: string;
	surface: InvocationSurface;
	provenance: ToolProvenance;
	documentRevision?: number;
	confirmationToken?: string;
}

export type PermissionOutcome = "allow" | "confirm" | "deny";

export interface ToolPermissionDecision {
	outcome: PermissionOutcome;
	reasons: readonly string[];
	risk: ToolRiskClass;
	requiresTrustedUserConfirmation: boolean;
}
