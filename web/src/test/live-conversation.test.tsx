import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import LiveConversation from "../components/live/LiveConversation";
import type { LiveSessionController } from "../components/live/use-live-session";
import { liveModelsFor } from "../keating/live-models";
import { emptyLiveTranscript } from "../keating/live-transcript";

function session(providerId: "tavus" | "openai-realtime" | "gemini-live"): LiveSessionController {
	const model = liveModelsFor(providerId)[0];
	return {
		phase: "live",
		speechState: "listening",
		failure: null,
		notice: null,
		dismissNotice() {},
		transcript: emptyLiveTranscript(),
		tools: [],
		providerId,
		model,
		models: liveModelsFor(providerId),
		alternativeModel: undefined,
		tierLabel: providerId === "openai-realtime" ? "Audio duplex + image input" : "Audio + video duplex",
		videoCapable: providerId === "gemini-live",
		imageCapable: providerId === "openai-realtime",
		embeddedSurface: providerId === "tavus" ? {
			kind: "tavus",
			url: "https://tavus.daily.co/c_test?t=meeting-token",
			title: "KeatingBot interactive video conversation",
		} : null,
		handleEmbeddedEvent() {},
		micMuted: false,
		toggleMic() {},
		inputStream: null,
		videoSource: null,
		videoStarting: false,
		cameraFacing: "user",
		previewRef: createRef<HTMLVideoElement>(),
		startVideo() {},
		stopVideo() {},
		flipCamera() {},
		sharedImage: null,
		imageSending: false,
		imageError: null,
		async shareImage() {},
		framesSent: 0,
		elapsedMs: 0,
		retry() {},
		switchModel() {},
		end() {},
	};
}

describe("live visual input controls", () => {
	test("GPT Live exposes audio controls without images, video, or a hosted room", () => {
		const audioSession: LiveSessionController = {
			...session("openai-realtime"), providerId: "gpt-live", model: liveModelsFor("gpt-live")[0],
			models: liveModelsFor("gpt-live"), tierLabel: "Audio duplex", imageCapable: false,
		};
		const html = renderToStaticMarkup(<LiveConversation session={audioSession} />);
		expect(html).toContain('aria-label="Mute your microphone"');
		expect(html).toContain(">End<");
		expect(html).not.toContain('aria-label="Add an image"');
		expect(html).not.toContain('aria-label="Turn your camera on"');
		expect(html).not.toContain('aria-label="Share your screen"');
		expect(html).not.toContain('aria-label="KeatingBot video"');
	});
	test("GPT Realtime offers a still image without camera or screen controls", () => {
		const html = renderToStaticMarkup(<LiveConversation session={session("openai-realtime")} />);
		expect(html).toContain('aria-label="Add an image"');
		expect(html).toContain('accept="image/jpeg,image/png"');
		expect(html).not.toContain('aria-label="Turn your camera on"');
		expect(html).not.toContain('aria-label="Share your screen"');
	});

	test("Gemini Live keeps camera and screen controls without the image-only action", () => {
		const html = renderToStaticMarkup(<LiveConversation session={session("gemini-live")} />);
		expect(html).toContain('aria-label="Turn your camera on"');
		expect(html).toContain('aria-label="Share your screen"');
		expect(html).not.toContain('aria-label="Add an image"');
	});

	test("Tavus renders a native Daily PAL surface with Keating controls and no iframe", () => {
		const html = renderToStaticMarkup(<LiveConversation session={session("tavus")} />);
		expect(html).toContain('aria-label="KeatingBot video"');
		expect(html).toContain('aria-label="Your camera preview"');
		expect(html).not.toContain("<iframe");
		expect(html).toContain('aria-label="Mute your microphone"');
		expect(html).toContain('aria-label="Turn your camera on"');
		expect(html).toContain('aria-label="Share your screen"');
		expect(html).toContain('aria-label="Flip your camera"');
		expect(html).toContain(">End<");
	});

	test("names reflect active media and unfinished speech stays in the transcript", () => {
		const call = session("gemini-live");
		call.micMuted = true;
		call.videoSource = "camera";
		call.transcript.draft.assistant = "Consider the base case";
		const html = renderToStaticMarkup(<LiveConversation session={call}/>);
		expect(html).toContain('aria-label="Unmute your microphone"');
		expect(html).toContain('aria-label="Turn your camera off"');
		expect(html).toContain('aria-label="Flip your camera"');
		expect(html).toContain('aria-live="polite"><div class="lv-utterance"');
		expect(html).toContain("<em>Consider the base case</em>");
		call.videoSource = "screen";
		expect(renderToStaticMarkup(<LiveConversation session={call}/>)).toContain('aria-label="Stop sharing your screen"');
	});

	test("a microphone-free session keeps its connecting and ended states readable", () => {
		const call = session("gemini-live");
		call.phase = "connecting";
		const connecting = renderToStaticMarkup(<LiveConversation session={call}/>);
		expect(connecting).toContain("Connecting…");
		expect(connecting).toContain("No transcript yet.");
		call.phase = "ended";
		const ended = renderToStaticMarkup(<LiveConversation session={call}/>);
		expect(ended).toContain("Nothing was said.");
		expect(ended).toContain("Keating · ended");
	});

	test("an interrupted session keeps its transcript and all applicable recovery actions", () => {
		const call = session("gemini-live");
		call.phase = "failed";
		call.alternativeModel = call.models[1];
		call.failure = {kind: "model-unavailable", title: "Model unavailable", message: "Choose another model.",
			retry: true, switchModel: true, settings: "speech", dictation: true, videoOnly: false, detail: "Model lookup failed"};
		call.transcript.turns = [{user: "My question", assistant: "My answer"}];
		const html = renderToStaticMarkup(<LiveConversation session={call} onOpenSettings={() => {}} onUseDictation={() => {}}/>);
		for (const text of ["Try again", "Use " + call.models[1].label, "Speech settings", "Type or dictate instead",
			"Technical detail", "Model lookup failed", 'aria-label="Dismiss"', "My question", "My answer"]) expect(html).toContain(text);
		expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('aria-label="Transcript"'));
	});
});
