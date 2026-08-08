import { describe, expect, test } from "bun:test";
import {
	classifyCaptureFailure,
	classifyLiveFailure,
	visionUnsupportedFailure,
} from "../keating/live-errors";

const GEMINI = { providerId: "gemini-live", model: "gemini-3.1-flash-live-preview" };
const OPENAI = { providerId: "openai-realtime", model: "gpt-realtime-2.1" };

/** A DOMException-shaped error, which is what getUserMedia actually rejects with. */
function mediaError(name: string, message = ""): Error {
	const error = new Error(message);
	error.name = name;
	return error;
}

describe("session failures", () => {
	test("a missing key points at Providers & Models, not at a retry", () => {
		const failure = classifyLiveFailure(
			new Error("No OpenAI API key configured. Add one in Settings → Providers & Models."),
			OPENAI,
		);
		expect(failure.kind).toBe("missing-key");
		expect(failure.settings).toBe("providers");
		expect(failure.retry).toBe(false);
	});

	test("a 404 is read as the model, not as a broken endpoint", () => {
		const failure = classifyLiveFailure(
			new Error("Realtime session mint failed (404): model not found"),
			GEMINI,
		);
		expect(failure.kind).toBe("model-unavailable");
		expect(failure.switchModel).toBe(true);
		// The learner should be told which model let them down.
		expect(failure.title).toContain("Gemini 3.1 Flash Live");
	});

	test("401 and 403 are credential problems, distinct from a missing key", () => {
		for (const message of ["Request failed (401): invalid api key", "HTTP 403 Forbidden"]) {
			const failure = classifyLiveFailure(new Error(message), OPENAI);
			expect(failure.kind).toBe("auth");
			expect(failure.settings).toBe("providers");
			expect(failure.retry).toBe(true);
		}
	});

	test("429 offers both waiting and a smaller model", () => {
		const failure = classifyLiveFailure(new Error("429 Too Many Requests: rate limit"), OPENAI);
		expect(failure.kind).toBe("rate-limit");
		expect(failure.retry).toBe(true);
		expect(failure.switchModel).toBe(true);
	});

	test("a dropped socket is retryable and blames nothing", () => {
		const failure = classifyLiveFailure(new Error("WebRTC transport failed"), OPENAI);
		expect(failure.kind).toBe("network");
		expect(failure.retry).toBe(true);
		expect(failure.switchModel).toBe(false);
	});

	test("a model with no realtime lane cannot be fixed by retrying", () => {
		const failure = classifyLiveFailure(
			new Error("OpenAI Realtime model gpt-realtime-2.1 cannot satisfy duplex WebRTC and native tool-call requirements."),
			OPENAI,
		);
		expect(failure.kind).toBe("unsupported-provider");
		expect(failure.retry).toBe(false);
		expect(failure.switchModel).toBe(true);
	});

	test("an unrecognised failure still offers every escape route", () => {
		const failure = classifyLiveFailure(new Error("something went sideways"), GEMINI);
		expect(failure.kind).toBe("unknown");
		expect(failure.retry).toBe(true);
		expect(failure.dictation).toBe(true);
	});

	test("session failures are never treated as video-only", () => {
		for (const message of ["404 not found", "429 quota", "websocket closed", "boom"]) {
			expect(classifyLiveFailure(new Error(message), GEMINI).videoOnly).toBe(false);
		}
	});

	test("the provider's own words are kept for the details disclosure", () => {
		const failure = classifyLiveFailure(new Error("Realtime error: unexpected_eof"), OPENAI);
		expect(failure.detail).toContain("unexpected_eof");
	});

	test("non-Error rejections do not crash the classifier", () => {
		expect(classifyLiveFailure("404 model not found", GEMINI).kind).toBe("model-unavailable");
		expect(classifyLiveFailure(undefined, GEMINI).kind).toBe("unknown");
		expect(classifyLiveFailure({ message: "429 quota exceeded" }, GEMINI).kind).toBe("rate-limit");
	});
});

describe("capture failures", () => {
	test("every camera failure leaves the voice session alone", () => {
		for (const name of ["NotAllowedError", "NotFoundError", "NotReadableError", "SomethingElseError"]) {
			expect(classifyCaptureFailure(mediaError(name), "camera").videoOnly).toBe(true);
		}
	});

	test("a declined camera is distinguished from a missing one", () => {
		expect(classifyCaptureFailure(mediaError("NotAllowedError"), "camera").kind).toBe("camera-denied");
		expect(classifyCaptureFailure(mediaError("NotFoundError"), "camera").kind).toBe("camera-unavailable");
	});

	test("a camera held by another app says so, and is retryable", () => {
		const failure = classifyCaptureFailure(mediaError("NotReadableError", "Could not start video source"), "camera");
		expect(failure.kind).toBe("camera-in-use");
		expect(failure.retry).toBe(true);
		expect(failure.hint).toContain("Close the other app");
	});

	test("a cancelled screen picker reads as a choice, not as an error", () => {
		const failure = classifyCaptureFailure(mediaError("NotAllowedError"), "screen");
		expect(failure.kind).toBe("screen-denied");
		expect(failure.title).toContain("declined");
	});

	test("an unsupported browser is not offered a pointless retry", () => {
		const failure = classifyCaptureFailure(new Error("Screen sharing is not supported by this browser."), "screen");
		expect(failure.retry).toBe(false);
		expect(failure.videoOnly).toBe(true);
	});
});

describe("vision-unsupported notice", () => {
	test("names the model and routes to Speech settings", () => {
		const failure = visionUnsupportedFailure("openai-realtime", "gpt-4o-realtime-preview-2024-12-17");
		expect(failure.message).toContain("gpt-4o-realtime-preview");
		expect(failure.settings).toBe("speech");
		expect(failure.switchModel).toBe(true);
		expect(failure.videoOnly).toBe(true);
	});
});
