import {
	validateAccountEvolutionJobRequest,
	type AccountEvolutionJobRequest,
	type PedagogyArtifactRef,
} from "@keating/learner-contracts";

import { AccountEvolutionClientError } from "./errors";
import {
	AuthenticatedAccountEvolutionTransport,
	type AuthenticatedNotOrganicRequester,
} from "./transport";
import {
	BROWSER_DECLARATIVE_ARTIFACT_KINDS,
	KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID,
	type BrowserEvolutionCompatibility,
	type EvolutionManifestRef,
	type VerifiedBrowserActiveRevision,
	type VerifiedBrowserDeclarativeArtifact,
} from "./types";
import {
	materializeDeclarativeArtifact,
	parseActiveRevisionPointer,
	parsePedagogyRevisionManifestBytes,
	verifiedArtifactBytes,
} from "./verify";

const BROWSER_DECLARATIVE_KINDS = new Set<string>(
	BROWSER_DECLARATIVE_ARTIFACT_KINDS,
);

function immutableContentPath(digest: string): string {
	return `/v1/evolution/artifacts/${encodeURIComponent(digest)}/content`;
}

function ensureCompatibility(
	revision: ReturnType<typeof parsePedagogyRevisionManifestBytes>,
	supported: BrowserEvolutionCompatibility,
): void {
	const manifest = revision.compatibility;
	if (!manifest.targets.includes("browser-nodepod")) {
		throw new AccountEvolutionClientError(
			"incompatible-artifact",
			`Revision ${revision.id} does not target browser-nodepod.`,
		);
	}
	if (manifest.agentApi !== supported.agentApi) {
		throw new AccountEvolutionClientError(
			"incompatible-artifact",
			`Revision agent API ${manifest.agentApi} is incompatible with browser agent API ${supported.agentApi}.`,
		);
	}
	if (manifest.learnerContract !== supported.learnerContract) {
		throw new AccountEvolutionClientError(
			"incompatible-artifact",
			`Revision learner contract ${manifest.learnerContract} is incompatible with browser learner contract ${supported.learnerContract}.`,
		);
	}
	const supportedCapabilities = new Set(supported.capabilities);
	const missing = manifest.requiredCapabilities.find(
		(capability) =>
			!BROWSER_DECLARATIVE_KINDS.has(capability)
			|| !supportedCapabilities.has(capability),
	);
	if (missing) {
		throw new AccountEvolutionClientError(
			"incompatible-artifact",
			`Revision requires unsupported browser declarative capability ${missing}.`,
		);
	}
}

export class BrowserAccountEvolutionClient {
	readonly #transport: AuthenticatedAccountEvolutionTransport;
	readonly #compatibility: Readonly<BrowserEvolutionCompatibility>;

	constructor(
		requester: AuthenticatedNotOrganicRequester,
		compatibility: BrowserEvolutionCompatibility,
	) {
		if (
			!compatibility.agentApi
			|| !Number.isSafeInteger(compatibility.learnerContract)
			|| compatibility.learnerContract < 1
			|| new Set(compatibility.capabilities).size
				!== compatibility.capabilities.length
		) {
			throw new AccountEvolutionClientError(
				"invalid-request",
				"Browser evolution compatibility declaration is invalid.",
			);
		}
		this.#transport = new AuthenticatedAccountEvolutionTransport(requester);
		this.#compatibility = Object.freeze({
			...compatibility,
			capabilities: Object.freeze([...compatibility.capabilities]),
		});
	}

	async #fetchVerifiedBytes(
		ref: {
			digest: string;
			mediaType: string;
			sizeBytes: number;
		},
		signal?: AbortSignal,
	): Promise<Uint8Array> {
		const response = await this.#transport.request(
			immutableContentPath(ref.digest),
			{
				method: "GET",
				headers: { accept: ref.mediaType },
				signal,
			},
		);
		if (!response.ok) {
			if ([404, 405, 501].includes(response.status)) {
				throw new AccountEvolutionClientError(
					"artifact-bytes-unavailable",
					`Authenticated artifact bytes are unavailable for ${ref.digest}; metadata alone cannot activate a revision.`,
					response.status,
				);
			}
			throw new AccountEvolutionClientError(
				"http-error",
				`Not Organic artifact download failed (${response.status}).`,
				response.status,
			);
		}
		return verifiedArtifactBytes(response, ref);
	}

	async #fetchManifestBytes(
		ref: EvolutionManifestRef,
		signal?: AbortSignal,
	): Promise<Uint8Array> {
		return this.#fetchVerifiedBytes(
			{
				digest: ref.digest,
				mediaType: ref.media_type,
				sizeBytes: ref.size_bytes,
			},
			signal,
		);
	}

	async fetchVerifiedArtifact(
		ref: PedagogyArtifactRef,
		signal?: AbortSignal,
	): Promise<VerifiedBrowserDeclarativeArtifact> {
		if (!BROWSER_DECLARATIVE_KINDS.has(ref.kind)) {
			throw new AccountEvolutionClientError(
				"incompatible-artifact",
				`Evolution artifact ${ref.kind} is not browser-compatible declarative data and will not be downloaded.`,
			);
		}
		return materializeDeclarativeArtifact(
			ref,
			await this.#fetchVerifiedBytes(ref, signal),
		);
	}

	async submitEvolutionJob(
		request: AccountEvolutionJobRequest,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (!validateAccountEvolutionJobRequest(request)) {
			throw new AccountEvolutionClientError(
				"invalid-request",
				"Evolution job request does not satisfy the shared Keating learner contract.",
			);
		}
		return this.#transport.json("/v1/evolution/jobs", {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				contract: "keating-account-evolution-job-v1",
				request,
			}),
			signal,
		});
	}

	/**
	 * Resolves all-or-nothing. It authenticates the account pointer and every
	 * byte read, verifies the exact manifest bytes before parsing the shared
	 * camelCase contract, then downloads only supported declarative artifacts.
	 */
	async resolveActiveRevision(
		signal?: AbortSignal,
	): Promise<VerifiedBrowserActiveRevision | null> {
		const query = new URLSearchParams({
			project_id: KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID,
		});
		const pointer = parseActiveRevisionPointer(
			await this.#transport.json(
				`/v1/evolution/active-revision?${query}`,
				{
					method: "GET",
					headers: { accept: "application/json" },
					signal,
				},
			),
		);
		if (!pointer) return null;

		const sourceManifest = parsePedagogyRevisionManifestBytes(
			await this.#fetchManifestBytes(pointer.manifest, signal),
		);
		const sourceRevision = Object.freeze({
			...sourceManifest,
			manifestDigest: pointer.manifest.digest,
		});
		ensureCompatibility(sourceRevision, this.#compatibility);

		const declarativeRefs = sourceRevision.artifacts.filter((artifact) =>
			BROWSER_DECLARATIVE_KINDS.has(artifact.kind)
		);
		if (declarativeRefs.length === 0) {
			throw new AccountEvolutionClientError(
				"incompatible-artifact",
				`Revision ${sourceRevision.id} has no browser-compatible declarative artifacts.`,
			);
		}
		const omittedArtifactKinds = sourceRevision.artifacts
			.filter((artifact) => !BROWSER_DECLARATIVE_KINDS.has(artifact.kind))
			.map((artifact) => artifact.kind);
		const artifacts = await Promise.all(
			declarativeRefs.map((ref) => this.fetchVerifiedArtifact(ref, signal)),
		);
		return Object.freeze({
			projectId: KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID,
			revisionId: sourceRevision.id,
			...(sourceRevision.parentId
				? { parentRevisionId: sourceRevision.parentId }
				: {}),
			manifestDigest: pointer.manifest.digest,
			generation: pointer.revision,
			createdAt: sourceRevision.createdAt,
			compatibility: sourceRevision.compatibility,
			artifacts: Object.freeze(artifacts),
			omittedArtifactKinds: Object.freeze(omittedArtifactKinds),
			sourceRevision,
		});
	}
}

export function createBrowserAccountEvolutionClient(
	requester: AuthenticatedNotOrganicRequester,
	compatibility: BrowserEvolutionCompatibility,
): BrowserAccountEvolutionClient {
	return new BrowserAccountEvolutionClient(requester, compatibility);
}
