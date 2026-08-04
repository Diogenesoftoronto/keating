import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import "../hooks/keating-storage";
import { IMAGE_GENERATORS } from "../lib/image-generators";
import type { SpeechProviderDescriptor } from "../keating/speech";
import {
	AudioModelSelectorDialog,
	ImageGenerationModelSelectorDialog,
	ModelSelectorDialog,
} from "./ModelSelector";

const meta = {
	title: "Models/ModelSelector",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const openAiTts: SpeechProviderDescriptor = {
	id: "openai-tts",
	label: "OpenAI Text to Speech",
	kind: "tts",
	status: "stable",
	description: "One-shot speech synthesis.",
	models: [
		{ value: "gpt-4o-mini-tts", label: "GPT-4o mini TTS" },
		{ value: "tts-1-hd", label: "TTS-1 HD" },
	],
	voices: ["alloy", "coral"],
};

const openAiRealtime: SpeechProviderDescriptor = {
	...openAiTts,
	id: "openai-realtime",
	label: "OpenAI Realtime",
	kind: "duplex",
	description: "Live bidirectional voice sessions.",
	models: [
		{ value: "gpt-realtime-2.1", label: "GPT Realtime 2.1" },
		{ value: "gpt-realtime-2.1-mini", label: "GPT Realtime 2.1 mini" },
	],
};

export const ChatModels: Story = {
	render: () => (
		<ModelSelectorDialog
			open
			currentModel={null}
			onClose={fn()}
			onSelect={fn()}
		/>
	),
};

export const ChatModelsConstrainedHeight: Story = {
	render: () => (
		<ModelSelectorDialog
			open
			currentModel={null}
			onClose={fn()}
			onSelect={fn()}
		/>
	),
	parameters: {
		viewport: { defaultViewport: "tablet" },
	},
};

export const ImageGenerationModels: Story = {
	render: () => (
		<ImageGenerationModelSelectorDialog
			open
			generator={IMAGE_GENERATORS[0]}
			currentModelId="gpt-image-1"
			onClose={fn()}
			onSelect={fn()}
		/>
	),
};

export const SpeechOutputModels: Story = {
	render: () => (
		<AudioModelSelectorDialog
			open
			provider={openAiTts}
			currentModelId="gpt-4o-mini-tts"
			onClose={fn()}
			onSelect={fn()}
		/>
	),
};

export const RealtimeVoiceModels: Story = {
	render: () => (
		<AudioModelSelectorDialog
			open
			provider={openAiRealtime}
			currentModelId="gpt-realtime-2.1"
			onClose={fn()}
			onSelect={fn()}
		/>
	),
};
