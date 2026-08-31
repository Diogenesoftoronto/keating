import type {
	PedagogyArtifactKind,
	PedagogyArtifactRef,
	PedagogyCompatibility,
	PedagogyRevisionRef,
} from "@keating/learner-contracts";

export const KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID = "keating-account" as const;
export const PEDAGOGY_REVISION_MANIFEST_MEDIA_TYPE =
	"application/vnd.notorganic.pedagogy-revision+json" as const;

export const BROWSER_DECLARATIVE_ARTIFACT_KINDS = [
	"prompt-set",
	"teacher-policy",
	"fitness-definition",
	"optimizer-strategy",
] as const satisfies readonly PedagogyArtifactKind[];

export type BrowserDeclarativeArtifactKind =
	(typeof BROWSER_DECLARATIVE_ARTIFACT_KINDS)[number];

export interface EvolutionManifestRef {
	digest: string;
	kind: "pedagogy_revision_manifest";
	media_type: typeof PEDAGOGY_REVISION_MANIFEST_MEDIA_TYPE;
	size_bytes: number;
	schema_version: number;
}

export interface EvolutionActiveRevisionPointer {
	project_id: typeof KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID;
	revision: number;
	manifest: EvolutionManifestRef;
	updated_at: number;
}

export interface BrowserEvolutionCompatibility {
	agentApi: string;
	learnerContract: number;
	capabilities: readonly string[];
}

export type SafeJsonPrimitive = string | number | boolean | null;
export type SafeJsonValue =
	| SafeJsonPrimitive
	| readonly SafeJsonValue[]
	| { readonly [key: string]: SafeJsonValue };

interface VerifiedArtifactBase {
	ref: Readonly<PedagogyArtifactRef>;
}

export interface VerifiedPromptSetArtifact extends VerifiedArtifactBase {
	kind: "prompt-set";
	format: "markdown" | "text" | "json";
	value: string | SafeJsonValue;
}

export interface VerifiedTeacherPolicyArtifact extends VerifiedArtifactBase {
	kind: "teacher-policy";
	format: "json";
	value: SafeJsonValue;
}

export interface VerifiedFitnessDefinitionArtifact extends VerifiedArtifactBase {
	kind: "fitness-definition";
	format: "json";
	value: SafeJsonValue;
}

export interface VerifiedOptimizerStrategyArtifact extends VerifiedArtifactBase {
	kind: "optimizer-strategy";
	format: "json";
	value: SafeJsonValue;
}

export type VerifiedBrowserDeclarativeArtifact =
	| VerifiedPromptSetArtifact
	| VerifiedTeacherPolicyArtifact
	| VerifiedFitnessDefinitionArtifact
	| VerifiedOptimizerStrategyArtifact;

export interface VerifiedBrowserActiveRevision {
	projectId: typeof KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID;
	revisionId: string;
	parentRevisionId?: string;
	manifestDigest: string;
	generation: number;
	createdAt: string;
	compatibility: Readonly<PedagogyCompatibility>;
	artifacts: readonly VerifiedBrowserDeclarativeArtifact[];
	omittedArtifactKinds: readonly PedagogyArtifactKind[];
	sourceRevision: Readonly<PedagogyRevisionRef>;
}

export type {
	PedagogyArtifactKind,
	PedagogyArtifactRef,
	PedagogyCompatibility,
	PedagogyRevisionRef,
};
