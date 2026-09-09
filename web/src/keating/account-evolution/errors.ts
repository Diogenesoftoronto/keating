export type AccountEvolutionErrorCode =
	| "missing-scope"
	| "invalid-request"
	| "http-error"
	| "invalid-response"
	| "provider-contract-mismatch"
	| "artifact-bytes-unavailable"
	| "artifact-size-mismatch"
	| "artifact-digest-mismatch"
	| "incompatible-artifact"
	| "unsafe-artifact-payload";

export const PROVIDER_ACTIVE_REVISION_CONTRACT_BLOCKER = [
	"Not Organic currently returns one independently versioned evolution slot",
	"({project_id, slot, revision, artifact}) instead of one immutable Keating",
	"revision manifest. Its artifact kinds also do not map losslessly to",
	"PedagogyRevisionRef (notably skill), so the browser cannot safely treat",
	"that pointer as an active declarative revision.",
].join(" ");

export class AccountEvolutionClientError extends Error {
	readonly name = "AccountEvolutionClientError";

	constructor(
		readonly code: AccountEvolutionErrorCode,
		message: string,
		readonly status?: number,
	) {
		super(message);
	}
}
