import { expect, test } from "bun:test";
import type { FetchLike } from "@keating/learner-contracts";
import {
	createWebJudgementCaller,
	NOTORGANIC_JUDGEMENT_GATEWAY_PATH,
	WEB_JUDGEMENT_GATEWAY_PATH,
} from "../keating/judgement/transport";

const REQUEST = {
	state: { learnerAnswer: "2x" },
	questions: { correct: { type: "noul" as const, instructions: "The learner answered correctly." } },
};
const PIN = "a".repeat(64);
const response = (model: string | undefined) => ({
	ok: true, status: 200,
	json: async () => ({ ...(model === undefined ? {} : { model }), answers: { correct: { type: "noul", noul: 0.8 } } }),
});

test("both gateway choices request the account alias and resolve concrete provenance without a provider key", async () => {
	for (const [gateway, path] of [["same-origin", WEB_JUDGEMENT_GATEWAY_PATH], ["notorganic", NOTORGANIC_JUDGEMENT_GATEWAY_PATH]] as const) {
		let captured: Parameters<FetchLike> | undefined;
		const caller = createWebJudgementCaller({
			gateway, origin: "https://keating.example", apiKey: "must-not-leak", calibrationSha256: PIN,
			fetch: async (...args) => { captured = args; return response("jev-1.13"); },
		});
		expect(caller.backend).toEqual({ backend: "system-one", model: "judgement", calibrationSha256: null });
		const outcome = await caller.call(REQUEST);
		expect(captured![0]).toBe(`https://keating.example${path}`);
		expect(JSON.parse(captured![1].body).model).toBe("judgement");
		expect(captured![1].headers.authorization).toBeUndefined();
		expect(JSON.stringify(captured)).not.toContain("must-not-leak");
		expect(outcome.ok).toBe(true);
		if (outcome.ok) expect(outcome.response.backend).toEqual({ backend: "system-one", model: "jev-1.13", calibrationSha256: null });
	}
});

test("a concrete configured model keeps its calibration only when the gateway confirms that version", async () => {
	for (const model of ["jev-1.13", "jev-1.14"]) {
		const caller = createWebJudgementCaller({ model: "jev-1.13", calibrationSha256: PIN, fetch: async () => response(model) });
		expect(caller.backend.calibrationSha256).toBe(PIN);
		const outcome = await caller.call(REQUEST);
		expect(outcome.ok).toBe(true);
		if (outcome.ok) {
			expect(outcome.response.backend.model).toBe(model);
			expect(outcome.response.backend.calibrationSha256).toBe(model === "jev-1.13" ? PIN : null);
		}
	}
});

test("a missing or unresolved gateway version cannot produce scored provenance", async () => {
	for (const model of [undefined, "judgement", "jev-latest"]) {
		const caller = createWebJudgementCaller({ model: "jev-1.13", calibrationSha256: PIN, fetch: async () => response(model) });
		expect(await caller.call(REQUEST)).toEqual({ ok: false, error: { code: "response-malformed", retryable: false } });
	}
	const latest = createWebJudgementCaller({ model: "jev-latest", calibrationSha256: PIN, fetch: async () => response("jev-1.13") });
		expect(latest.backend.calibrationSha256).toBeNull();
});

test("local judgement remains on device and hosted-off cannot send a browser credential", async () => {
	let hostedCalls = 0;
	const fetch: FetchLike = async () => { hostedCalls++; return response("jev-1.13"); };
	const local = createWebJudgementCaller({ localScorer: async () => [0.1, 0.9], localModel: "local-scorer", gateway: "notorganic", fetch });
	const outcome = await local.call(REQUEST);
	if (outcome.ok) expect(outcome.response.backend.model).toBe("local-scorer");
	else throw new Error("local scorer should answer");
	const disabled = createWebJudgementCaller({ gateway: "none", apiKey: "browser-key", fetch });
		expect((await disabled.call(REQUEST)).ok).toBe(false);
		expect(hostedCalls).toBe(0);
});
