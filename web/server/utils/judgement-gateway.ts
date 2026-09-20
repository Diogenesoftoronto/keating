/**
 * Shared plumbing for the judgement gateway routes (`/api/judgement` and
 * `/api/notorganic/judgement`).
 *
 * Both routes accept the SystemOne wire shape (`{state, model, questions}`)
 * and forward it to a hosted backend that holds the credential. This module
 * owns the two rules both routes share:
 *
 * - The request is shape-checked before anything leaves this process, under
 *   the same ceilings as the transports (<=64 questions, <=96,000 state chars).
 * - Upstream error bodies are never forwarded, logged, or embedded in a
 *   diagnostic: a judgement request carries learner text, so the reply can
 *   echo it back. Failures leave as a stable `{error:{code}}` JSON body.
 */
import { getHeader, readBody, type H3Event } from "h3";
import {
	createNotOrganicServerClient,
	getNotOrganicServerConfig,
	NotOrganicOperationalError,
} from "../../src/notorganic-provider/server";

/** Account-authorized capability; the gateway owns the TypeSafe credential. */
export const NOTORGANIC_UPSTREAM_JUDGEMENT_PATH = "/v1/judgement";
export const JUDGEMENT_GATEWAY_TIMEOUT_MS = 15_000;

export const MAX_JUDGEMENT_GATEWAY_QUESTIONS = 64;
export const MAX_JUDGEMENT_GATEWAY_STATE_CHARS = 96_000;

export type JudgementGatewayErrorCode =
	| "request-invalid"
	| "backend-unavailable"
	| "backend-unauthorized"
	| "backend-rate-limited"
	| "backend-overloaded"
	| "backend-timeout";

export interface JudgementGatewayBody {
	readonly state: unknown;
	readonly model?: string;
	readonly questions: Record<string, unknown>;
}

export type JudgementGatewayValidation =
	| { readonly ok: true; readonly body: JudgementGatewayBody }
	| { readonly ok: false; readonly code: "request-invalid" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

function stateCharacterCount(state: unknown): number {
	try {
		const text = typeof state === "string" ? state : JSON.stringify(state);
		return text?.length ?? 0;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

/**
 * Validate the closed question vocabulary before acquiring a capability.
 */
export function validateJudgementGatewayBody(input: unknown): JudgementGatewayValidation {
	if (!isPlainObject(input)) return { ok: false, code: "request-invalid" };
	if (typeof input.state !== "string" && !isPlainObject(input.state) && !Array.isArray(input.state)) {
		return { ok: false, code: "request-invalid" };
	}
	if (input.model !== undefined && typeof input.model !== "string") {
		return { ok: false, code: "request-invalid" };
	}
	if (!isPlainObject(input.questions)) return { ok: false, code: "request-invalid" };
	const keys = Object.keys(input.questions);
	if (keys.length === 0 || keys.length > MAX_JUDGEMENT_GATEWAY_QUESTIONS) {
		return { ok: false, code: "request-invalid" };
	}
	if (Object.values(input.questions).some((question) => !validQuestion(question))) {
		return { ok: false, code: "request-invalid" };
	}
	// Not Organic accepts strings or a map of strings. Preserve richer shared
	// contract state as JSON text instead of dropping fields or rejecting it.
	let state: unknown = input.state;
	try {
		if (Array.isArray(state) || (isPlainObject(state) && Object.values(state).some((value) => typeof value !== "string"))) {
			state = JSON.stringify(state);
		}
		if (JSON.stringify(input.questions).length > 96_000) return { ok: false, code: "request-invalid" };
	} catch { return { ok: false, code: "request-invalid" }; }
	if (stateCharacterCount(input.state) > MAX_JUDGEMENT_GATEWAY_STATE_CHARS) {
		return { ok: false, code: "request-invalid" };
	}
	return {
		ok: true,
		body: {
			state,
			model: "judgement",
			questions: { ...input.questions },
		},
	};
}

function validQuestion(question: unknown): boolean {
	if (!isPlainObject(question) || typeof question.instructions !== "string" || !question.instructions.trim()) return false;
	const criteria = question.criteria;
	if (question.type === "noul") {
		return criteria === undefined || (isPlainObject(criteria)
			&& Object.keys(criteria).every((key) => key === "true" || key === "false")
			&& Object.values(criteria).every((value) => typeof value === "string"));
	}
	if (question.type === "score") {
		return Array.isArray(criteria) && criteria.length >= 2 && criteria.length <= 64
			&& new Set(criteria).size === criteria.length
			&& criteria.every((value) => typeof value === "string" && value.trim().length > 0);
	}
	return question.type === "choice" && isPlainObject(criteria)
		&& Object.keys(criteria).length >= 2 && Object.keys(criteria).length <= 64
		&& Object.keys(criteria).every((value) => value.trim().length > 0)
		&& Object.values(criteria).every((value) => value === null || typeof value === "string");
}

/** Both public paths enforce the same server-validated account boundary. */
export async function handleJudgementGateway(
	event: H3Event,
	options: { timeoutMs?: number } = {},
): Promise<Response> {
	let input: unknown;
	try { input = await readBody(event); }
	catch { return judgementErrorResponse("request-invalid"); }
	const validated = validateJudgementGatewayBody(input);
	if (!validated.ok) return judgementErrorResponse("request-invalid");
	const idempotencyKey = getHeader(event, "idempotency-key");
	if (idempotencyKey !== undefined && (idempotencyKey.length < 1 || idempotencyKey.length > 255)) {
		return judgementErrorResponse("request-invalid");
	}
	const controller = new AbortController();
	const timeoutMs = Math.min(JUDGEMENT_GATEWAY_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? JUDGEMENT_GATEWAY_TIMEOUT_MS));
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<Response>((resolve) => {
		timer = setTimeout(() => {
			controller.abort();
			resolve(judgementErrorResponse("backend-timeout"));
		}, timeoutMs);
	});
	const run = async (): Promise<Response> => {
		try {
			const config = getNotOrganicServerConfig();
			if (!config.enabled) return Response.json({ error: { code: "backend-unavailable" } }, { status: 503 });
			const client = await createNotOrganicServerClient(event, "keating:judgement", config);
			if (controller.signal.aborted) return judgementErrorResponse("backend-timeout");
			const upstream = await client.request(NOTORGANIC_UPSTREAM_JUDGEMENT_PATH, {
				method: "POST",
				body: JSON.stringify(validated.body),
				headers: { "content-type": "application/json" },
				idempotencyKey,
				maxCostMicrousd: config.maxCostMicrousd,
				signal: controller.signal,
			});
			if (!upstream.ok) return judgementErrorResponse(upstream.status);
			const payload: unknown = await upstream.json();
			if (!isPlainObject(payload) || typeof payload.model !== "string" || !isPlainObject(payload.answers)) {
				return judgementErrorResponse("backend-unavailable");
			}
			return Response.json({ model: payload.model, answers: payload.answers, usage: payload.usage }, {
				headers: { "cache-control": "no-store" },
			});
		} catch (error) {
			if (controller.signal.aborted) return judgementErrorResponse("backend-timeout");
			if (error instanceof NotOrganicOperationalError) {
				return Response.json({ error: { code: "backend-unavailable" } }, { status: 503 });
			}
			return judgementErrorResponse("backend-unavailable");
		}
	};
	try { return await Promise.race([run(), timeout]); }
	finally { if (timer !== undefined) clearTimeout(timer); }
}

/**
 * Map an upstream HTTP status to a stable code. Mirrors `errorForStatus` in
 * `@keating/learner-contracts`; kept local so server routes never import
 * browser-facing transport code. The upstream body is deliberately never read.
 */
export function judgementUpstreamErrorCode(status: number): JudgementGatewayErrorCode {
	if (status === 401 || status === 403) return "backend-unauthorized";
	if (status === 422) return "request-invalid";
	if (status === 429) return "backend-rate-limited";
	if (status === 408 || status === 504) return "backend-timeout";
	if (status === 529 || status === 503) return "backend-overloaded";
	if (status >= 500) return "backend-unavailable";
	return "backend-unavailable";
}

/**
 * Map a stable code to the HTTP status the gateway answers with. An upstream
 * credential failure is this deployment's problem, not the browser caller's,
 * so it leaves as a 502 rather than a 401.
 */
export function judgementErrorHttpStatus(code: JudgementGatewayErrorCode): number {
	if (code === "request-invalid") return 400;
	if (code === "backend-rate-limited") return 429;
	if (code === "backend-overloaded") return 503;
	if (code === "backend-timeout") return 504;
	return 502;
}

/** Build the sanitized error response: stable code only, no upstream text. */
export function judgementErrorResponse(statusOrCode: number | JudgementGatewayErrorCode): Response {
	const code = typeof statusOrCode === "number"
		? judgementUpstreamErrorCode(statusOrCode)
		: statusOrCode;
	return Response.json({ error: { code } }, { status: judgementErrorHttpStatus(code) });
}
