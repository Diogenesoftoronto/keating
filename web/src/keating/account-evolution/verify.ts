import {
	validatePedagogyRevisionManifest,
	type PedagogyArtifactRef,
	type PedagogyRevisionManifest,
} from "@keating/learner-contracts";

import {
	AccountEvolutionClientError,
	PROVIDER_ACTIVE_REVISION_CONTRACT_BLOCKER,
} from "./errors";
import {
	KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID,
	PEDAGOGY_REVISION_MANIFEST_MEDIA_TYPE,
	type EvolutionActiveRevisionPointer,
	type EvolutionManifestRef,
	type SafeJsonValue,
	type VerifiedBrowserDeclarativeArtifact,
} from "./types";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/;
const MAX_ARTIFACT_BYTES = 67_108_864;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 100_000;
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

interface ImmutableByteRef {
	digest: string;
	mediaType: string;
	sizeBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

function isLegacySlotPointer(value: unknown): boolean {
	return isRecord(value)
		&& typeof value.project_id === "string"
		&& typeof value.slot === "string"
		&& typeof value.revision === "number"
		&& isRecord(value.artifact);
}

function parseManifestRef(value: unknown): EvolutionManifestRef {
	if (
		!isRecord(value)
		|| !hasOnlyKeys(
			value,
			new Set(["digest", "kind", "media_type", "size_bytes", "schema_version"]),
		)
		|| typeof value.digest !== "string"
		|| !DIGEST_PATTERN.test(value.digest)
		|| value.kind !== "pedagogy_revision_manifest"
		|| value.media_type !== PEDAGOGY_REVISION_MANIFEST_MEDIA_TYPE
		|| !Number.isSafeInteger(value.size_bytes)
		|| (value.size_bytes as number) < 1
		|| (value.size_bytes as number) > MAX_ARTIFACT_BYTES
		|| value.schema_version !== 1
	) {
		throw new AccountEvolutionClientError(
			"invalid-response",
			"Not Organic returned a malformed immutable pedagogy revision manifest reference.",
		);
	}
	return Object.freeze({ ...value }) as unknown as EvolutionManifestRef;
}

export function parseActiveRevisionPointer(
	value: unknown,
): EvolutionActiveRevisionPointer | null {
	if (value === null) return null;
	if (isLegacySlotPointer(value)) {
		throw new AccountEvolutionClientError(
			"provider-contract-mismatch",
			PROVIDER_ACTIVE_REVISION_CONTRACT_BLOCKER,
		);
	}
	if (
		!isRecord(value)
		|| !hasOnlyKeys(
			value,
			new Set(["project_id", "revision", "manifest", "updated_at"]),
		)
		|| value.project_id !== KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID
		|| !Number.isSafeInteger(value.revision)
		|| (value.revision as number) < 1
		|| !Number.isSafeInteger(value.updated_at)
		|| (value.updated_at as number) < 0
	) {
		throw new AccountEvolutionClientError(
			"invalid-response",
			"Not Organic did not return the canonical Keating account active revision pointer.",
		);
	}
	return Object.freeze({
		project_id: KEATING_ACCOUNT_PEDAGOGY_PROJECT_ID,
		revision: value.revision as number,
		manifest: parseManifestRef(value.manifest),
		updated_at: value.updated_at as number,
	});
}

function safeJson(
	value: unknown,
	depth = 0,
	budget = { nodes: 0 },
): SafeJsonValue {
	budget.nodes += 1;
	if (depth > MAX_JSON_DEPTH || budget.nodes > MAX_JSON_NODES) {
		throw new AccountEvolutionClientError(
			"unsafe-artifact-payload",
			"Evolution artifact JSON exceeds browser safety limits.",
		);
	}
	if (
		value === null
		|| typeof value === "string"
		|| typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value)) {
		return Object.freeze(
			value.map((entry) => safeJson(entry, depth + 1, budget)),
		);
	}
	if (!isRecord(value)) {
		throw new AccountEvolutionClientError(
			"unsafe-artifact-payload",
			"Evolution artifact contains a non-JSON value.",
		);
	}
	const result: Record<string, SafeJsonValue> = Object.create(
		null,
	) as Record<string, SafeJsonValue>;
	for (const [key, entry] of Object.entries(value)) {
		if (UNSAFE_OBJECT_KEYS.has(key)) {
			throw new AccountEvolutionClientError(
				"unsafe-artifact-payload",
				`Evolution artifact contains unsafe object key ${key}.`,
			);
		}
		result[key] = safeJson(entry, depth + 1, budget);
	}
	return Object.freeze(result);
}

function decodedText(bytes: Uint8Array): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new AccountEvolutionClientError(
			"unsafe-artifact-payload",
			"Evolution artifact is not valid UTF-8.",
		);
	}
}

function jsonPayload(bytes: Uint8Array): SafeJsonValue {
	try {
		return safeJson(JSON.parse(decodedText(bytes)));
	} catch (error) {
		if (error instanceof AccountEvolutionClientError) throw error;
		throw new AccountEvolutionClientError(
			"unsafe-artifact-payload",
			"Evolution artifact is not valid JSON.",
		);
	}
}

function cloneManifest(
	value: PedagogyRevisionManifest,
): PedagogyRevisionManifest {
	return Object.freeze({
		id: value.id,
		...(value.parentId === undefined ? {} : { parentId: value.parentId }),
		createdAt: value.createdAt,
		artifacts: Object.freeze(
			value.artifacts.map((artifact) => Object.freeze({ ...artifact })),
		),
		compatibility: Object.freeze({
			...value.compatibility,
			targets: Object.freeze([...value.compatibility.targets]),
			requiredCapabilities: Object.freeze([
				...value.compatibility.requiredCapabilities,
			]),
		}),
	}) as PedagogyRevisionManifest;
}

export function parsePedagogyRevisionManifestBytes(
	bytes: Uint8Array,
): PedagogyRevisionManifest {
	const value = jsonPayload(bytes);
	if (!validatePedagogyRevisionManifest(value)) {
		throw new AccountEvolutionClientError(
			"invalid-response",
			"Manifest bytes are not the canonical camelCase PedagogyRevisionManifest contract.",
		);
	}
	return cloneManifest(value);
}

async function readExactBytes(
	response: Response,
	expectedSize: number,
): Promise<Uint8Array> {
	const declaredLength = response.headers.get("content-length");
	if (
		declaredLength !== null
		&& (!/^\d+$/.test(declaredLength)
			|| Number(declaredLength) !== expectedSize)
	) {
		throw new AccountEvolutionClientError(
			"artifact-size-mismatch",
			`Evolution artifact declared ${declaredLength} bytes; immutable reference requires ${expectedSize}.`,
			response.status,
		);
	}
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength !== expectedSize) {
			throw new AccountEvolutionClientError(
				"artifact-size-mismatch",
				`Evolution artifact contained ${bytes.byteLength} bytes; immutable reference requires ${expectedSize}.`,
				response.status,
			);
		}
		return bytes;
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > expectedSize) {
			await reader.cancel("immutable artifact exceeded declared size");
			throw new AccountEvolutionClientError(
				"artifact-size-mismatch",
				`Evolution artifact exceeded its immutable ${expectedSize}-byte reference.`,
				response.status,
			);
		}
		chunks.push(value);
	}
	if (total !== expectedSize) {
		throw new AccountEvolutionClientError(
			"artifact-size-mismatch",
			`Evolution artifact contained ${total} bytes; immutable reference requires ${expectedSize}.`,
			response.status,
		);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function digestHex(bytes: Uint8Array): Promise<string> {
	const stable = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(stable).set(bytes);
	return crypto.subtle.digest("SHA-256", stable).then((digest) =>
		[...new Uint8Array(digest)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
	);
}

export async function verifiedArtifactBytes(
	response: Response,
	ref: ImmutableByteRef,
): Promise<Uint8Array> {
	const responseType = response.headers
		.get("content-type")
		?.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	if (
		!MEDIA_TYPE_PATTERN.test(ref.mediaType)
		|| responseType !== ref.mediaType
	) {
		throw new AccountEvolutionClientError(
			"incompatible-artifact",
			`Evolution artifact media type ${responseType ?? "(missing)"} does not match immutable reference ${ref.mediaType}.`,
			response.status,
		);
	}
	const bytes = await readExactBytes(response, ref.sizeBytes);
	const digest = `sha256:${await digestHex(bytes)}`;
	if (digest !== ref.digest) {
		throw new AccountEvolutionClientError(
			"artifact-digest-mismatch",
			`Evolution artifact bytes do not match immutable digest ${ref.digest}.`,
			response.status,
		);
	}
	return bytes;
}

function requireJsonObject(
	ref: PedagogyArtifactRef,
	bytes: Uint8Array,
): SafeJsonValue {
	if (ref.mediaType !== "application/json") {
		throw new AccountEvolutionClientError(
			"incompatible-artifact",
			`${ref.kind} requires application/json in the browser declarative agent.`,
		);
	}
	const value = jsonPayload(bytes);
	if (!isRecord(value)) {
		throw new AccountEvolutionClientError(
			"unsafe-artifact-payload",
			`${ref.kind} must be a declarative JSON object.`,
		);
	}
	return value;
}

export function materializeDeclarativeArtifact(
	ref: PedagogyArtifactRef,
	bytes: Uint8Array,
): VerifiedBrowserDeclarativeArtifact {
	if (ref.kind === "prompt-set") {
		if (ref.mediaType === "application/json") {
			return Object.freeze({
				kind: "prompt-set",
				format: "json",
				ref,
				value: jsonPayload(bytes),
			});
		}
		if (
			ref.mediaType === "text/markdown"
			|| ref.mediaType === "text/plain"
		) {
			const value = decodedText(bytes);
			if (!value.trim()) {
				throw new AccountEvolutionClientError(
					"unsafe-artifact-payload",
					"Prompt-set artifact must not be empty.",
				);
			}
			return Object.freeze({
				kind: "prompt-set",
				format: ref.mediaType === "text/markdown" ? "markdown" : "text",
				ref,
				value,
			});
		}
	}
	if (
		ref.kind === "teacher-policy"
		|| ref.kind === "fitness-definition"
		|| ref.kind === "optimizer-strategy"
	) {
		return Object.freeze({
			kind: ref.kind,
			format: "json",
			ref,
			value: requireJsonObject(ref, bytes),
		});
	}
	throw new AccountEvolutionClientError(
		"incompatible-artifact",
		`Evolution artifact ${ref.kind} is not browser-compatible declarative data.`,
	);
}
