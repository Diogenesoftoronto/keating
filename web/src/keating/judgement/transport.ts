/**
 * The web surface's `JudgementCaller`.
 *
 * This is a *sibling* of `hybridStreamFn` (`web/src/hooks/keating-stream.ts`),
 * not a change to it. That function already picks a transport in the order
 * `DESKTOP_OFFLINE_PROVIDER -> browser -> NotOrganic -> proxy -> direct`;
 * judgement follows the same ladder for the same reasons, and stops at the same
 * place.
 *
 * The one rule that is not negotiable: **the TypeSafe credential must never
 * reach a browser bundle.** There is no `VITE_` variable and no literal here.
 * In a browser the caller is built with an `endpoint` pointing at a same-origin
 * gateway backed by the Not Organic account session, and `apiKey` is left undefined — a
 * supplied key is dropped rather than forwarded. Only a trusted runtime
 * (desktop shell or CLI, where the code is not served to a visitor) may hold a
 * key directly.
 *
 * Errors are returned, never thrown, and upstream bodies are never read: a
 * judgement request carries learner text, so the reply can echo it back.
 */
import {
	createLocalJudgementCaller,
	createSystemOneCaller,
	type FetchLike,
	type JudgementBackendKey,
	type JudgementCaller,
	type JudgementOutcome,
	type LocalLabelScorer,
} from "@keating/learner-contracts";
import { desktopOfflineBridge } from "../../lib/desktop-offline";

/**
 * Same-origin entrypoint for authenticated Not Organic judgement.
 * The account gateway holds the TypeSafe key; this bundle never receives it.
 */
export const WEB_JUDGEMENT_GATEWAY_PATH = "/api/judgement";

/**
 * Explicit Not Organic entrypoint, sharing the same authenticated server handler.
 * Unavailable product sessions cause abstention; no direct-key bypass is used.
 */
export const NOTORGANIC_JUDGEMENT_GATEWAY_PATH = "/api/notorganic/judgement";
export const WEB_JUDGEMENT_MODEL_ALIAS = "judgement";

export type WebJudgementGateway = "same-origin" | "notorganic" | "none";

export type WebJudgementUnavailableReason =
	| "no-transport-configured"
	| "credential-withheld-from-browser";

/** Which implementation the ladder settled on. Recorded, never guessed at. */
export type WebJudgementTransport =
	| { readonly kind: "on-device"; readonly model: string }
	| { readonly kind: "gateway"; readonly endpoint: string; readonly via: "same-origin" | "notorganic" }
	| { readonly kind: "direct"; readonly endpoint?: string }
	| { readonly kind: "unavailable"; readonly reason: WebJudgementUnavailableReason };

export interface WebJudgementEnvironment {
	/**
	 * On-device label scorer. Supplied by the desktop offline bridge or the
	 * browser model; absent means there is no local tier on this surface.
	 */
	readonly localScorer?: LocalLabelScorer;
	readonly localModel?: string;
	/**
	 * True only where the code is not served to a visitor: the desktop shell and
	 * the CLI. A browser tab is never trusted, whatever it claims.
	 */
	readonly trustedRuntime?: boolean;
	/** Read only on a trusted runtime. Dropped, not forwarded, anywhere else. */
	readonly apiKey?: string;
	/** Defaults to the same-origin gateway. `"none"` disables the hosted tier. */
	readonly gateway?: WebJudgementGateway;
	/** Overrides the resolved gateway path; must stay same-origin in a browser. */
	readonly endpoint?: string;
	readonly origin?: string;
	readonly calibrationSha256?: string | null;
	readonly model?: string;
}

/**
 * A desktop shell exposes `window.keatingOffline`; a CLI or test runner has no
 * `window` at all. Everything else is a page someone was served.
 */
export function isTrustedJudgementRuntime(): boolean {
	if (typeof window === "undefined") return true;
	return desktopOfflineBridge() !== undefined;
}

function gatewayPath(gateway: "same-origin" | "notorganic"): string {
	return gateway === "notorganic" ? NOTORGANIC_JUDGEMENT_GATEWAY_PATH : WEB_JUDGEMENT_GATEWAY_PATH;
}

function sameOriginEndpoint(path: string, origin: string | undefined): string {
	const base = origin ?? globalThis.location?.origin ?? "";
	return base ? `${base.replace(/\/+$/, "")}${path}` : path;
}

/**
 * Pick the transport, cheapest and most private first.
 *
 * On-device answers without leaving the machine, so it wins whenever it exists.
 * Otherwise a gateway carries the request and the deployment holds the key. A
 * direct credential is reachable only from a trusted runtime; asking for one
 * from a browser resolves to `unavailable` rather than quietly sending it.
 */
export function resolveWebJudgementTransport(
	environment: WebJudgementEnvironment = {},
): WebJudgementTransport {
	if (environment.localScorer) {
		return { kind: "on-device", model: environment.localModel ?? "local-judgement" };
	}

	const trusted = environment.trustedRuntime ?? false;
	const gateway = environment.gateway ?? "same-origin";
	if (gateway !== "none") {
		return {
			kind: "gateway",
			endpoint: environment.endpoint ?? sameOriginEndpoint(gatewayPath(gateway), environment.origin),
			via: gateway,
		};
	}

	if (environment.apiKey) {
		if (!trusted) return { kind: "unavailable", reason: "credential-withheld-from-browser" };
		return { kind: "direct", endpoint: environment.endpoint };
	}
	return { kind: "unavailable", reason: "no-transport-configured" };
}

/** The identity the router and the export checkpoint file thresholds against. */
export function webJudgementBackendKey(
	transport: WebJudgementTransport,
	environment: WebJudgementEnvironment = {},
): JudgementBackendKey {
	const calibrationSha256 = environment.calibrationSha256 ?? null;
	if (transport.kind === "on-device") {
		return { backend: "local", model: transport.model, calibrationSha256 };
	}
	if (transport.kind === "unavailable") {
		return { backend: "fixture", model: `unavailable:${transport.reason}`, calibrationSha256: null };
	}
	if (transport.kind === "gateway") {
		const model = environment.model ?? WEB_JUDGEMENT_MODEL_ALIAS;
		const concrete = model !== WEB_JUDGEMENT_MODEL_ALIAS && !model.endsWith("-latest");
		return { backend: "system-one", model, calibrationSha256: concrete ? calibrationSha256 : null };
	}
	return { backend: "system-one", model: environment.model ?? "jev-latest", calibrationSha256 };
}

function browserFetch(): FetchLike {
	return (input, init) => globalThis.fetch(input, init as RequestInit);
}

/** Always returns; an unconfigured judgement tier is an abstention, not a crash. */
function unavailableCaller(): JudgementCaller {
	return async (): Promise<JudgementOutcome> => ({
		ok: false,
		error: { code: "backend-unavailable", retryable: false },
	});
}

export interface WebJudgementCallerOptions extends WebJudgementEnvironment {
	readonly fetch?: FetchLike;
	/** Injected so retry backoff is instant under test. */
	readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface WebJudgementCaller {
	readonly call: JudgementCaller;
	readonly transport: WebJudgementTransport;
	readonly backend: JudgementBackendKey;
}

/**
 * Build the web `JudgementCaller` and report which tier answered.
 *
 * The credential clamp lives here rather than at the call sites: a key survives
 * into `createSystemOneCaller` only on the `direct` branch, which the resolver
 * above will not select from a browser. Everything else passes `endpoint` and
 * omits `apiKey`, so there is no path by which a bundle can send one.
 */
export function createWebJudgementCaller(options: WebJudgementCallerOptions = {}): WebJudgementCaller {
	const transport = resolveWebJudgementTransport(options);
	const backend = webJudgementBackendKey(transport, options);

	if (transport.kind === "on-device" && options.localScorer) {
		return {
			transport,
			backend,
			call: createLocalJudgementCaller({
				scoreLabels: options.localScorer,
				model: transport.model,
				calibrationSha256: options.calibrationSha256 ?? null,
			}),
		};
	}

	if (transport.kind === "gateway") {
		return {
			transport,
			backend,
			call: createSystemOneCaller({
				fetch: options.fetch ?? browserFetch(),
				endpoint: transport.endpoint,
				model: backend.model,
				requestModel: WEB_JUDGEMENT_MODEL_ALIAS,
				requireResolvedModel: true,
				calibrationSha256: backend.calibrationSha256,
				sleep: options.sleep,
				// No apiKey. The server resolves its account capability; Not Organic holds the provider key.
			}),
		};
	}

	if (transport.kind === "direct") {
		return {
			transport,
			backend,
			call: createSystemOneCaller({
				fetch: options.fetch ?? browserFetch(),
				endpoint: transport.endpoint,
				apiKey: options.apiKey,
				model: options.model,
				calibrationSha256: options.calibrationSha256 ?? null,
				sleep: options.sleep,
			}),
		};
	}

	return { transport, backend, call: unavailableCaller() };
}
