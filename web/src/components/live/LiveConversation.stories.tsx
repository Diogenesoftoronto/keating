import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef } from "react";
import { fn } from "storybook/test";

import { css } from "../../../styled-system/css";
import { liveModelsFor } from "../../keating/live-models";
import { emptyLiveTranscript, type LiveTranscriptState } from "../../keating/live-transcript";
import LiveConversation from "./LiveConversation";
import type { LiveSessionController } from "./use-live-session";

const frameClass = css({
	width: "min(62rem, 100vw)",
	height: "min(52rem, 100vh)",
	minHeight: "40rem",
	backgroundColor: "var(--background)",
});

const transcript: LiveTranscriptState = {
	turns: [{
		user: "Can we make the eigenvector idea visible?",
		assistant: "Picture a transformation stretching one line while its direction stays fixed.",
	}],
	draft: { user: "", assistant: "" },
};

function controller(
	providerId: "tavus" | "openai-realtime" | "gemini-live",
	overrides: Partial<LiveSessionController> = {},
): LiveSessionController {
	const model = liveModelsFor(providerId)[0];
	return {
		phase: "live",
		speechState: "listening",
		failure: null,
		notice: null,
		dismissNotice: fn(),
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
			url: "https://tavus.daily.co/storybook-preview?t=not-a-real-token",
			title: "KeatingBot interactive video conversation",
		} : null,
		handleEmbeddedEvent: fn(),
		micMuted: false,
		toggleMic: fn(),
		inputStream: null,
		videoSource: null,
		videoStarting: false,
		cameraFacing: "user",
		previewRef: createRef<HTMLVideoElement>(),
		startVideo: fn(),
		stopVideo: fn(),
		flipCamera: fn(),
		sharedImage: null,
		imageSending: false,
		imageError: null,
		shareImage: fn(async () => undefined),
		framesSent: 0,
		elapsedMs: 83_000,
		retry: fn(),
		switchModel: fn(),
		end: fn(),
		...overrides,
	};
}

const meta = {
	title: "Live/LiveConversation",
	component: LiveConversation,
	parameters: { layout: "centered" },
	decorators: [(Story) => <div className={frameClass}><Story /></div>],
	args: {
		session: controller("tavus", { transcript }),
		connectEmbeddedSurface: false,
		onOpenSettings: fn(),
		onUseDictation: fn(),
	},
} satisfies Meta<typeof LiveConversation>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Safe provider-hosted preview: the Daily room is deliberately not joined. */
export const TavusKeatingBot: Story = {};

export const TavusUsingAQuizTool: Story = {
	args: {
		session: controller("tavus", {
			transcript,
			speechState: "speaking",
			tools: [{ callId: "quiz-story", name: "quiz", status: "running" }],
		}),
	},
};

export const GptRealtimeImageOnly: Story = {
	args: {
		connectEmbeddedSurface: true,
		session: controller("openai-realtime", {
			transcript,
			sharedImage: { previewUrl: "/brand/mascot-head-v2.png", filename: "quadratic-sketch.png" },
		}),
	},
};

export const GptRealtimeImageError: Story = {
	args: {
		connectEmbeddedSurface: true,
		session: controller("openai-realtime", {
			transcript,
			imageError: "Choose a JPEG or PNG image smaller than 12 MB.",
		}),
	},
};

export const GeminiNativeVideo: Story = {
	args: {
		connectEmbeddedSurface: true,
		session: controller("gemini-live", { transcript }),
	},
};

export const MobileTavus: Story = {
	parameters: { viewport: { defaultViewport: "mobile1" } },
	globals: { viewport: { value: "mobile1", isRotated: false } },
};
