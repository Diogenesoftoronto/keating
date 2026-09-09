import { describe, expect, it } from "bun:test";
import type {
	AccountEvolutionJobRequest,
	PedagogyArtifactKind,
	PedagogyArtifactRef,
	PedagogyCompatibility,
	PedagogyRevisionRef,
} from "@keating/learner-contracts";

import {
	AccountEvolutionClientError,
	AuthenticatedAccountEvolutionTransport,
	BrowserAccountEvolutionClient,
	KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID,
	PEDAGOGY_REVISION_MANIFEST_MEDIA_TYPE,
	PROVIDER_ACTIVE_REVISION_CONTRACT_BLOCKER,
	type BrowserEvolutionCompatibility,
	type EvolutionManifestRef,
} from "../keating/account-evolution";

interface FixtureArtifact {
	ref: PedagogyArtifactRef;
	bytes: Uint8Array;
}

const BROWSER_COMPATIBILITY: BrowserEvolutionCompatibility = {
	agentApi: "keating-portable-agent-v1",
	learnerContract: 1,
	capabilities: [
		"prompt-set",
		"teacher-policy",
		"fitness-definition",
		"optimizer-strategy",
	],
};

const MANIFEST_COMPATIBILITY: PedagogyCompatibility = {
	agentApi: "keating-portable-agent-v1",
	learnerContract: 1,
	targets: ["browser-nodepod", "mobile-declarative", "flue-node"],
	minimumFlue: "2.0.3",
	mobileSdk: "54",
	requiredCapabilities: ["prompt-set", "teacher-policy"],
};

function responseBody(bytes: Uint8Array): ArrayBuffer {
	const body = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(body).set(bytes);
	return body;
}

async function digest(bytes: Uint8Array): Promise<string> {
	const value = await crypto.subtle.digest("SHA-256", responseBody(bytes));
	return `sha256:${[...new Uint8Array(value)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")}`;
}

async function artifact(
	kind: PedagogyArtifactKind,
	mediaType: string,
	content: string,
	index = 1,
): Promise<FixtureArtifact> {
	const bytes = new TextEncoder().encode(content);
	return {
		bytes,
		ref: {
			id: `artifact-${kind}-${index}`,
			digest: await digest(bytes),
			kind,
			mediaType,
			sizeBytes: bytes.byteLength,
		},
	};
}

async function manifest(
	artifacts: readonly FixtureArtifact[],
	compatibility: PedagogyCompatibility = MANIFEST_COMPATIBILITY,
): Promise<{ ref: EvolutionManifestRef; bytes: Uint8Array }> {
	const revision: Omit<PedagogyRevisionRef, "manifestDigest"> = {
		id: "revision-7",
		parentId: "revision-6",
		createdAt: "2026-08-31T12:00:00.000Z",
		artifacts: artifacts.map((value) => value.ref),
		compatibility,
	};
	const bytes = new TextEncoder().encode(JSON.stringify(revision));
	return {
		bytes,
		ref: {
			digest: await digest(bytes),
			kind: "pedagogy_revision_manifest",
			media_type: PEDAGOGY_REVISION_MANIFEST_MEDIA_TYPE,
			size_bytes: bytes.byteLength,
			schema_version: 1,
		},
	};
}

function requester(
	handler: (path: string, init?: RequestInit) => Response | Promise<Response>,
): {
	getSession: () => { scope: string } | null;
	request: (path: string, init?: RequestInit) => Promise<Response>;
	calls: Array<{ path: string; init?: RequestInit }>;
} {
	const calls: Array<{ path: string; init?: RequestInit }> = [];
	return {
		calls,
		getSession: () => ({ scope: "evolution:read" }),
		async request(path, init) {
			calls.push({ path, init });
			return handler(path, init);
		},
	};
}

function artifactResponse(
	value: { ref: { mediaType?: string; media_type?: string }; bytes: Uint8Array },
): Response {
	return new Response(responseBody(value.bytes), {
		headers: {
			"content-type": value.ref.mediaType ?? value.ref.media_type ?? "",
			"content-length": String(value.bytes.byteLength),
		},
	});
}

function activePointer(manifestValue: {
	ref: EvolutionManifestRef;
}): Record<string, unknown> {
	return {
		project_id: KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID,
		revision: 7,
		manifest: manifestValue.ref,
		updated_at: 1_788_177_600_000,
	};
}

function activeRequester(
	manifestValue: { ref: EvolutionManifestRef; bytes: Uint8Array },
	artifacts: readonly FixtureArtifact[],
) {
	const byDigest = new Map(
		artifacts.map((value) => [value.ref.digest, value]),
	);
	return requester((path) => {
		if (path.startsWith("/v1/evolution/active-revision?")) {
			return Response.json(activePointer(manifestValue));
		}
		const prefix = "/v1/evolution/artifacts/";
		const suffix = "/content";
		const encodedDigest = path.slice(prefix.length, -suffix.length);
		const decodedDigest = decodeURIComponent(encodedDigest);
		if (decodedDigest === manifestValue.ref.digest) {
			return artifactResponse(manifestValue);
		}
		const value = byDigest.get(decodedDigest);
		return value
			? artifactResponse(value)
			: new Response("missing", { status: 404 });
	});
}

describe("browser account-evolution transport", () => {
	it("does not send evolution reads without the exact granted scope", async () => {
		const signed = requester(() => Response.json({ ok: true }));
		const transport = new AuthenticatedAccountEvolutionTransport(signed);
		for (const scope of [null, "", "wallet:read usage:read", "evolution:read-all", "evolution:write"]) {
			signed.getSession = () => scope === null ? null : { scope };
			await expect(transport.json("/v1/evolution/active-revision?project_id=keating-account"))
				.rejects.toMatchObject({ code: "missing-scope", status: 403 });
		}
		expect(signed.calls).toHaveLength(0);
		signed.getSession = () => ({ scope: "wallet:read evolution:read usage:read" });
		await expect(transport.json("/v1/evolution/active-revision?project_id=keating-account"))
			.resolves.toEqual({ ok: true });
		expect(signed.calls).toHaveLength(1);
	});

	it("confines every request to the authenticated Not Organic evolution surface", async () => {
		const signed = requester(() => Response.json({ ok: true }));
		const transport = new AuthenticatedAccountEvolutionTransport(signed);

		await transport.json("/v1/evolution/jobs?limit=2");
		expect(signed.calls.map((call) => call.path)).toEqual([
			"/v1/evolution/jobs?limit=2",
		]);
		await expect(
			transport.request("https://attacker.test/v1/evolution/jobs"),
		).rejects.toMatchObject({ code: "invalid-request" });
		await expect(transport.request("/v1/account")).rejects.toMatchObject({
			code: "invalid-request",
		});
	});
});

describe("browser active account-evolution revision", () => {
	it("verifies the canonical manifest and every declarative artifact before returning it", async () => {
		const fixtures = await Promise.all([
			artifact("prompt-set", "text/markdown", "# Fractions\nAsk for retrieval."),
			artifact(
				"teacher-policy",
				"application/json",
				JSON.stringify({ schemaVersion: 1, retrievalWeight: 0.7 }),
			),
			artifact(
				"fitness-definition",
				"application/json",
				JSON.stringify({ schemaVersion: 1, objectives: ["retention"] }),
			),
			artifact(
				"optimizer-strategy",
				"application/json",
				JSON.stringify({ schemaVersion: 1, mutationRate: 0.15 }),
			),
		]);
		const manifestValue = await manifest(fixtures);
		const signed = activeRequester(manifestValue, fixtures);

		const resolved = await new BrowserAccountEvolutionClient(
			signed,
			BROWSER_COMPATIBILITY,
		).resolveActiveRevision();

		expect(resolved).toMatchObject({
			projectId: "keating-account",
			revisionId: "revision-7",
			parentRevisionId: "revision-6",
			generation: 7,
			manifestDigest: manifestValue.ref.digest,
			createdAt: "2026-08-31T12:00:00.000Z",
		});
		expect(resolved?.artifacts.map((value) => value.kind)).toEqual([
			"prompt-set",
			"teacher-policy",
			"fitness-definition",
			"optimizer-strategy",
		]);
		expect(resolved?.sourceRevision.compatibility).toEqual(
			MANIFEST_COMPATIBILITY,
		);
		expect(signed.calls).toHaveLength(6);
		expect(signed.calls[0]?.path).toBe(
			"/v1/evolution/active-revision?project_id=keating-account",
		);
		expect(
			signed.calls.slice(1).every(
				(call) =>
					call.path.endsWith("/content")
					&& call.init?.method === "GET"
					&& new Headers(call.init.headers).has("accept"),
			),
		).toBe(true);
	});

	it("does not treat a metadata pointer as usable when manifest bytes are unavailable", async () => {
		const prompt = await artifact("prompt-set", "text/plain", "Explain fractions.");
		const manifestValue = await manifest([prompt]);
		const signed = requester((path) =>
			path.startsWith("/v1/evolution/active-revision?")
				? Response.json(activePointer(manifestValue))
				: new Response("metadata exists but blob is absent", { status: 404 }),
		);

		await expect(
			new BrowserAccountEvolutionClient(
				signed,
				BROWSER_COMPATIBILITY,
			).resolveActiveRevision(),
		).rejects.toMatchObject({
			code: "artifact-bytes-unavailable",
			status: 404,
		});
	});

	it("rejects manifest and child byte mismatches before materializing data", async () => {
		const prompt = await artifact("prompt-set", "text/plain", "Explain fractions.");
		const manifestValue = await manifest([prompt]);
		const wrongManifest = {
			...manifestValue,
			ref: {
				...manifestValue.ref,
				digest: `sha256:${"0".repeat(64)}`,
			},
		};
		const signed = activeRequester(wrongManifest, [prompt]);
		await expect(
			new BrowserAccountEvolutionClient(
				signed,
				BROWSER_COMPATIBILITY,
			).resolveActiveRevision(),
		).rejects.toMatchObject({ code: "artifact-digest-mismatch" });

		const client = new BrowserAccountEvolutionClient(
			requester(() => artifactResponse(prompt)),
			BROWSER_COMPATIBILITY,
		);
		await expect(
			client.fetchVerifiedArtifact({
				...prompt.ref,
				sizeBytes: prompt.ref.sizeBytes + 1,
			}),
		).rejects.toMatchObject({ code: "artifact-size-mismatch" });
	});

	it("never downloads or executes source bundles and reports them as omitted", async () => {
		const [prompt, source] = await Promise.all([
			artifact("prompt-set", "text/plain", "Explain fractions."),
			artifact(
				"source-bundle",
				"application/javascript",
				"globalThis.compromised = true",
			),
		]);
		const manifestValue = await manifest([prompt, source], {
			...MANIFEST_COMPATIBILITY,
			requiredCapabilities: ["prompt-set"],
		});
		const signed = activeRequester(manifestValue, [prompt, source]);

		const resolved = await new BrowserAccountEvolutionClient(
			signed,
			BROWSER_COMPATIBILITY,
		).resolveActiveRevision();

		expect(resolved?.artifacts.map((value) => value.kind)).toEqual([
			"prompt-set",
		]);
		expect(resolved?.omittedArtifactKinds).toEqual(["source-bundle"]);
		expect(
			signed.calls.some((call) => call.path.includes(encodeURIComponent(source.ref.digest))),
		).toBe(false);
		expect((globalThis as { compromised?: boolean }).compromised).toBeUndefined();
	});

	it("fails closed on target, agent, learner, or required-capability mismatch", async () => {
		const prompt = await artifact("prompt-set", "text/plain", "Explain fractions.");
		const manifestValue = await manifest([prompt], {
			...MANIFEST_COMPATIBILITY,
			requiredCapabilities: ["source-bundle"],
		});
		const signed = activeRequester(manifestValue, [prompt]);

		await expect(
			new BrowserAccountEvolutionClient(
				signed,
				BROWSER_COMPATIBILITY,
			).resolveActiveRevision(),
		).rejects.toMatchObject({
			code: "incompatible-artifact",
			message: expect.stringContaining("source-bundle"),
		});
		expect(signed.calls).toHaveLength(2);
	});

	it("fails closed with the precise legacy slot-pointer mismatch", async () => {
		const prompt = await artifact("prompt-set", "text/plain", "Explain fractions.");
		const signed = requester(() =>
			Response.json({
				project_id: KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID,
				slot: "prompt",
				revision: 3,
				artifact: prompt.ref,
				updated_at: 123,
			}),
		);

		try {
			await new BrowserAccountEvolutionClient(
				signed,
				BROWSER_COMPATIBILITY,
			).resolveActiveRevision();
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(AccountEvolutionClientError);
			expect(error).toMatchObject({ code: "provider-contract-mismatch" });
			expect((error as Error).message).toBe(
				PROVIDER_ACTIVE_REVISION_CONTRACT_BLOCKER,
			);
		}
		expect(signed.calls).toHaveLength(1);
	});
});

describe("browser account-evolution jobs", () => {
	it("posts the exact shared request under the canonical contract envelope", async () => {
		const request: AccountEvolutionJobRequest = {
			schemaVersion: 1,
			clientRequestId: "request-1",
			requestedAt: "2026-08-31T12:02:00.000Z",
			operation: "prompt-evolution",
			baseRevision: {
				id: "revision-1",
				createdAt: "2026-08-31T12:00:00.000Z",
				manifestDigest: `sha256:${"a".repeat(64)}`,
				artifacts: [{
					id: "revision-1-prompts",
					kind: "prompt-set",
					digest: `sha256:${"b".repeat(64)}`,
					mediaType: "application/json",
					sizeBytes: 4096,
				}],
				compatibility: MANIFEST_COMPATIBILITY,
			},
			evidence: [{
				id: "evidence-1",
				kind: "observed",
				digest: `sha256:${"c".repeat(64)}`,
				capturedAt: "2026-08-31T12:01:00.000Z",
				exposureCount: 2,
				sizeBytes: 1024,
			}],
			requirements: {
				runtime: {
					kind: "bun",
					version: "1.2",
					abi: "keating-evolution-v1",
					entrypoint: "src/run.ts",
				},
				minimumIsolation: "microvm",
				network: {
					mode: "allowlist",
					allowedHosts: ["api.notorganic.info:443"],
				},
				filesystem: {
					mode: "workspace-snapshot",
					maximumWritableBytes: 268_435_456,
				},
				secrets: {
					mode: "brokered",
					capabilities: ["model-inference"],
				},
				resources: {
					cpuMillis: 120_000,
					memoryMiB: 1024,
					diskMiB: 4096,
					wallTimeSeconds: 300,
					maximumOutputBytes: 4_194_304,
				},
			},
		};
		const signed = requester(() =>
			Response.json({ id: "job-1", source_request: request }, { status: 202 }),
		);

		await new BrowserAccountEvolutionClient(
			signed,
			BROWSER_COMPATIBILITY,
		).submitEvolutionJob(request);

		expect(signed.calls).toHaveLength(1);
		expect(signed.calls[0]?.path).toBe("/v1/evolution/jobs");
		expect(signed.calls[0]?.init?.method).toBe("POST");
		expect(JSON.parse(String(signed.calls[0]?.init?.body))).toEqual({
			contract: "keating-account-evolution-job-v1",
			request,
		});
	});
});
