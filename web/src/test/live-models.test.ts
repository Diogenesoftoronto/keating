import { describe, expect, test } from "bun:test";
import {
	describeLiveModel,
	findLiveModel,
	isLiveProviderId,
	LIVE_MODELS,
	liveModelsFor,
	nextBestLiveModel,
	recommendedLiveModel,
} from "../keating/live-models";

describe("live model catalog", () => {
	test("every provider offers exactly one recommendation", () => {
		for (const providerId of ["gemini-live", "openai-realtime"] as const) {
			const recommended = liveModelsFor(providerId).filter((model) => model.grade === "recommended");
			expect(recommended).toHaveLength(1);
		}
	});

	test("the recommendation is the first entry, so the fallback chain starts at the best model", () => {
		for (const providerId of ["gemini-live", "openai-realtime"] as const) {
			expect(liveModelsFor(providerId)[0]).toBe(recommendedLiveModel(providerId)!);
		}
	});

	test("model ids are unique", () => {
		const ids = LIVE_MODELS.map((model) => `${model.providerId}/${model.value}`);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("only legacy models are allowed to lack vision", () => {
		for (const model of LIVE_MODELS) {
			if (model.video === "none") expect(model.grade).toBe("legacy");
		}
	});

	test("a model without vision explains itself, since the camera button goes dead", () => {
		for (const model of LIVE_MODELS) {
			if (model.video === "none") expect(model.note).toBeTruthy();
		}
	});

	test("gemini gets the native video lane and openai the sampled one", () => {
		for (const model of liveModelsFor("gemini-live")) expect(model.video).toBe("native");
		for (const model of liveModelsFor("openai-realtime")) expect(model.video).not.toBe("native");
	});
});

describe("fallback selection", () => {
	test("skips the model that just failed", () => {
		const failing = recommendedLiveModel("gemini-live")!;
		const next = nextBestLiveModel("gemini-live", failing.value);
		expect(next?.value).not.toBe(failing.value);
		expect(next?.providerId).toBe("gemini-live");
	});

	test("walks down the chain rather than re-offering an exhausted model", () => {
		const models = liveModelsFor("openai-realtime");
		const tried: string[] = [];
		let failing = models[0].value;
		for (let step = 1; step < models.length; step += 1) {
			const next = nextBestLiveModel("openai-realtime", failing, tried);
			expect(next).toBeDefined();
			expect(tried).not.toContain(next!.value);
			tried.push(failing);
			failing = next!.value;
		}
		// Everything has now been tried once, so there is nothing left to offer.
		expect(nextBestLiveModel("openai-realtime", failing, tried)).toBeUndefined();
	});

	test("never crosses providers — a Gemini failure cannot fall back to OpenAI", () => {
		const next = nextBestLiveModel("gemini-live", "gemini-3.1-flash-live-preview");
		expect(next?.providerId).toBe("gemini-live");
	});
});

describe("unknown models", () => {
	test("a hand-typed model id is described rather than dropped", () => {
		const described = describeLiveModel("gemini-live", "gemini-99-experimental");
		expect(described.value).toBe("gemini-99-experimental");
		expect(described.label).toBe("gemini-99-experimental");
		expect(described.note).toContain("tested list");
	});

	test("a known model keeps its catalog entry", () => {
		const known = recommendedLiveModel("openai-realtime")!;
		expect(describeLiveModel("openai-realtime", known.value)).toBe(known);
	});

	test("lookups do not match across providers", () => {
		expect(findLiveModel("openai-realtime", "gemini-3.1-flash-live-preview")).toBeUndefined();
	});

	test("provider ids are recognised", () => {
		expect(isLiveProviderId("gemini-live")).toBe(true);
		expect(isLiveProviderId("openai-tts")).toBe(false);
	});
});
