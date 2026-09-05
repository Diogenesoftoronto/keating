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
	test("GPT Realtime offers a still image without camera or screen controls", () => {
		const html = renderToStaticMarkup(<LiveConversation session={session("openai-realtime")} />);
		expect(html).toContain("Add image");
		expect(html).toContain('accept="image/jpeg,image/png"');
		expect(html).not.toContain(">Camera<");
		expect(html).not.toContain("Share screen");
	});

	test("Gemini Live keeps camera and screen controls without the image-only action", () => {
		const html = renderToStaticMarkup(<LiveConversation session={session("gemini-live")} />);
		expect(html).toContain(">Camera<");
		expect(html).toContain("Share screen");
		expect(html).not.toContain("Add image");
	});

	test("Tavus renders a native Daily PAL surface with Keating controls and no iframe", () => {
		const html = renderToStaticMarkup(<LiveConversation session={session("tavus")} />);
		expect(html).toContain('aria-label="KeatingBot video"');
		expect(html).toContain('aria-label="Your camera preview"');
		expect(html).not.toContain("<iframe");
		expect(html).toContain(">Mute<");
		expect(html).toContain("Camera off");
		expect(html).toContain("Share screen");
		expect(html).toContain(">Flip<");
		expect(html).toContain(">End<");
	});
});
