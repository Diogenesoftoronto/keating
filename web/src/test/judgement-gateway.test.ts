import { describe, expect, test } from "bun:test";
import { H3, mockEvent, type H3Event } from "h3";
import judgementGateway from "../../server/api/judgement/index.post";
import notorganicJudgement from "../../server/api/notorganic/judgement/index.post";
import type { NotOrganicSessionAdapter } from "../notorganic-provider/server";
import {
	handleJudgementGateway,
	judgementErrorHttpStatus,
	judgementErrorResponse,
	judgementUpstreamErrorCode,
	validateJudgementGatewayBody,
} from "../../server/utils/judgement-gateway";

const gatewayApp = new H3().all("/api/judgement", judgementGateway);
const notorganicApp = new H3().all("/api/notorganic/judgement", notorganicJudgement);

const VALID_BODY = {
	state: { transcript: "learner wrote: the derivative is 2x" },
	model: "jev-latest",
	questions: {
		correct: { type: "noul", instructions: "The learner's work shows a correct result." },
	},
};

function saveEnv(): Record<string, string | undefined> {
	return { ...process.env };
}
function restoreEnv(saved: Record<string, string | undefined>): void {
	for (const key of Object.keys(process.env)) {
		if (!(key in saved)) delete process.env[key];
	}
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

const originalFetch = globalThis.fetch;

describe("validateJudgementGatewayBody", () => {
	test("accepts the SystemOne wire shape", () => {
		const result = validateJudgementGatewayBody(VALID_BODY);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.body.questions).toEqual(VALID_BODY.questions);
			expect(result.body.model).toBe("judgement");
		}
	});

	test("rejects non-objects, missing state, and missing questions", () => {
		for (const input of [null, "text", 42, [], {}, { state: "x" }, { questions: {} }, VALID_BODY && { state: "x", questions: {} }]) {
			expect(validateJudgementGatewayBody(input).ok).toBe(false);
		}
	});

	test("rejects an empty or oversized question map and a non-string model", () => {
		const tooMany: Record<string, unknown> = {};
		for (let index = 0; index < 65; index += 1) tooMany[`q${index}`] = { type: "noul", instructions: "x" };
		expect(validateJudgementGatewayBody({ state: "x", questions: tooMany }).ok).toBe(false);
		expect(validateJudgementGatewayBody({ ...VALID_BODY, model: 42 }).ok).toBe(false);
	});

	test("rejects state over the 96k ceiling", () => {
		expect(
			validateJudgementGatewayBody({ state: "x".repeat(96_001), questions: VALID_BODY.questions }).ok,
		).toBe(false);
	});

	test("preserves label-only Choices and serializes nested shared-contract state for the account gateway", () => {
		const state = { learner: { answer: "2x", attempts: 2 }, context: ["derivative"] };
		const questions = { move: { type: "choice", instructions: "Identify the move.", criteria: { explain: null, ask: null } } };
		const result = validateJudgementGatewayBody({ state, questions });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(JSON.parse(result.body.state as string)).toEqual(state);
			expect(result.body.questions).toEqual(questions);
		}
		const array = validateJudgementGatewayBody({ state: ["learner", { answer: "2x" }], questions });
		expect(array.ok).toBe(true);
		if (array.ok) expect(JSON.parse(array.body.state as string)).toEqual(["learner", { answer: "2x" }]);
	});

	test("enforces the account gateway's two-to-64 distinct criterion ceiling", () => {
		for (const criteria of [["only"], ["duplicate", "duplicate"], Array.from({ length: 65 }, (_, i) => String(i))]) {
			expect(validateJudgementGatewayBody({ state: "x", questions: { q: { type: "score", instructions: "Grade", criteria } } }).ok).toBe(false);
		}
	});
});

describe("upstream error mapping", () => {
	test("maps statuses to stable codes without reading a body", () => {
		expect(judgementUpstreamErrorCode(401)).toBe("backend-unauthorized");
		expect(judgementUpstreamErrorCode(403)).toBe("backend-unauthorized");
		expect(judgementUpstreamErrorCode(422)).toBe("request-invalid");
		expect(judgementUpstreamErrorCode(429)).toBe("backend-rate-limited");
		expect(judgementUpstreamErrorCode(503)).toBe("backend-overloaded");
		expect(judgementUpstreamErrorCode(529)).toBe("backend-overloaded");
		expect(judgementUpstreamErrorCode(500)).toBe("backend-unavailable");
		expect(judgementUpstreamErrorCode(404)).toBe("backend-unavailable");
		expect(judgementUpstreamErrorCode(408)).toBe("backend-timeout");
	});

	test("maps codes to HTTP statuses; credential failures leave as 502", () => {
		expect(judgementErrorHttpStatus("request-invalid")).toBe(400);
		expect(judgementErrorHttpStatus("backend-rate-limited")).toBe(429);
		expect(judgementErrorHttpStatus("backend-overloaded")).toBe(503);
		expect(judgementErrorHttpStatus("backend-timeout")).toBe(504);
		expect(judgementErrorHttpStatus("backend-unauthorized")).toBe(502);
		expect(judgementErrorHttpStatus("backend-unavailable")).toBe(502);
	});

	test("error responses carry the stable code only", async () => {
		const response = judgementErrorResponse(401);
		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ error: { code: "backend-unauthorized" } });
	});
});

function configureAccountGateway(): void {
	process.env.NOTORGANIC_ENABLED = "true";
	process.env.NOTORGANIC_ISSUER = "https://account.example";
	process.env.NOTORGANIC_MAX_COST_MICROUSD = "75000";
	process.env.TYPESAFE_API_KEY = "never-use-this-browser-bypass";
}

function requestEvent(body: unknown = VALID_BODY): H3Event {
	return mockEvent(new Request("https://keating.example/api/judgement", {
		method: "POST",
		headers: { "content-type": "application/json", "idempotency-key": "one-evaluation", authorization: "Bearer forged-browser-token", dpop: "forged-browser-proof" },
		body: JSON.stringify(body),
	}));
}

function authorize(event: H3Event, onFeature: (feature: string) => void = () => {}): void {
	const adapter: NotOrganicSessionAdapter = {
		getProductSession: async (_event, request) => {
			onFeature(request.feature);
			return {
				accountId: "did:plc:server-account",
				accessToken: "server-capability",
				createDpopProof: async ({ method, url, accessToken }) => {
					expect(method).toBe("POST");
					expect(url).toBe("https://account.example/v1/judgement");
					expect(accessToken).toBe("server-capability");
					return "server-bound-proof";
				},
			};
		},
	};
	event.context.notOrganicSessionAdapter = adapter;
}

for (const [name, handler] of [["/api/judgement", judgementGateway], ["/api/notorganic/judgement", notorganicJudgement]] as const) {
	describe(name, () => {
		test("requires the server session even when a TypeSafe key and browser credentials are present", async () => {
			const saved = saveEnv();
			let calls = 0;
			globalThis.fetch = Object.assign(async () => { calls++; throw new Error("unexpected fetch"); }, { preconnect: originalFetch.preconnect });
			try {
				configureAccountGateway();
				const response = await handler(requestEvent()) as Response;
				expect(response.status).toBe(503);
				expect(await response.json()).toEqual({ error: { code: "backend-unavailable" } });
				expect(calls).toBe(0);
			} finally { globalThis.fetch = originalFetch; restoreEnv(saved); }
		});

		test("uses account DPoP, alias, cost limit and idempotency; preserves returned model", async () => {
			const saved = saveEnv();
			let feature = "";
			let seen: { url: string; init?: RequestInit } | undefined;
			const payload = { model: "jev-1.13", answers: { correct: { type: "noul", noul: 0.8 } }, usage: { input_tokens: 10, output_tokens: 0 } };
			globalThis.fetch = (async (input, init) => { seen = { url: String(input), init }; return Response.json(payload, { headers: { "set-cookie": "upstream-must-not-escape" } }); }) as typeof fetch;
			try {
				configureAccountGateway();
				const event = requestEvent();
				authorize(event, (value) => { feature = value; });
				const response = await handler(event) as Response;
				expect(feature).toBe("keating:judgement");
				expect(seen?.url).toBe("https://account.example/v1/judgement");
				expect(JSON.parse(String(seen?.init?.body)).model).toBe("judgement");
				const headers = new Headers(seen?.init?.headers);
				expect(headers.get("authorization")).toBe("DPoP server-capability");
				expect(headers.get("dpop")).toBe("server-bound-proof");
				expect(headers.get("idempotency-key")).toBe("one-evaluation");
				expect(headers.get("x-notorganic-max-cost-microusd")).toBe("75000");
				expect(seen?.init?.redirect).toBe("error");
				expect(seen?.init?.signal).toBeInstanceOf(AbortSignal);
				expect(response.headers.get("set-cookie")).toBeNull();
				expect(response.headers.get("cache-control")).toBe("no-store");
				expect(await response.json()).toEqual(payload);
			} finally { globalThis.fetch = originalFetch; restoreEnv(saved); }
		});

		test("rejects malformed requests before session resolution or upstream", async () => {
			let sessions = 0;
			for (const body of [
				{ state: "x", questions: {} },
				{ ...VALID_BODY, state: 42 },
				{ ...VALID_BODY, questions: { q: { type: "score", instructions: "x", criteria: "wrong" } } },
				{ ...VALID_BODY, questions: { q: { type: "choice", instructions: "x", criteria: { yes: 42 } } } },
			]) {
				const event = requestEvent(body);
				authorize(event, () => { sessions++; });
				const response = await handler(event) as Response;
				expect(response.status).toBe(400);
				expect(await response.json()).toEqual({ error: { code: "request-invalid" } });
			}
			expect(sessions).toBe(0);
		});

		test("sanitizes upstream errors, thrown fetch errors, and malformed successful bodies", async () => {
			const saved = saveEnv();
			try {
				configureAccountGateway();
				for (const fetcher of [
					async () => new Response("learner-private-echo", { status: 401 }),
					async () => { throw new Error("learner-private-echo"); },
					async () => new Response("learner-private-echo", { status: 200 }),
				]) {
					globalThis.fetch = Object.assign(fetcher, { preconnect: originalFetch.preconnect });
					const event = requestEvent(); authorize(event);
					const response = await handler(event) as Response;
					expect(response.status).toBe(502);
					const text = await response.text();
					expect(text).not.toContain("learner-private-echo");
					expect(JSON.parse(text).error.code).toMatch(/^backend-(unauthorized|unavailable)$/);
				}
			} finally { globalThis.fetch = originalFetch; restoreEnv(saved); }
		});
	});
}

test("timeout bounds both upstream and product-session resolution", async () => {
	const saved = saveEnv();
	try {
		configureAccountGateway();
		let signal: AbortSignal | null | undefined;
		globalThis.fetch = (async (_input, init) => {
			signal = init?.signal;
			return new Promise<Response>(() => {});
		}) as typeof fetch;
		const event = requestEvent(); authorize(event);
		const response = await handleJudgementGateway(event, { timeoutMs: 5 });
		expect(response.status).toBe(504);
		expect(await response.json()).toEqual({ error: { code: "backend-timeout" } });
		expect(signal?.aborted).toBe(true);
		const stalledSession = requestEvent();
		stalledSession.context.notOrganicSessionAdapter = { getProductSession: async () => new Promise(() => {}) };
		expect((await handleJudgementGateway(stalledSession, { timeoutMs: 5 })).status).toBe(504);
	} finally { globalThis.fetch = originalFetch; restoreEnv(saved); }
});

test("unexpected session errors never escape H3 as learner text", async () => {
	const saved = saveEnv();
	try {
		configureAccountGateway();
		const event = requestEvent();
		event.context.notOrganicSessionAdapter = { getProductSession: async () => { throw new Error("learner-private-echo"); } };
		const response = await judgementGateway(event) as Response;
		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ error: { code: "backend-unavailable" } });
	} finally { restoreEnv(saved); }
});

test("disabled hosted access fails identically for both public routes", async () => {
	const saved = saveEnv();
	try {
		delete process.env.NOTORGANIC_ENABLED;
		process.env.TYPESAFE_API_KEY = "cannot-enable-a-bypass";
		for (const [app, path] of [[gatewayApp, "/api/judgement"], [notorganicApp, "/api/notorganic/judgement"]] as const) {
			const response = await app.request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(VALID_BODY) });
			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({ error: { code: "backend-unavailable" } });
		}
	} finally { restoreEnv(saved); }
});
