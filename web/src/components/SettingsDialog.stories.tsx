import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { SettingsDialog, type SettingsTabDef } from "./SettingsDialog";
import { SettingsSectionNav } from "./SettingsSectionNav";
import { Toggle } from "./Toggle";

function Section({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section id={`settings-section-${id}`} className="flex flex-col gap-3 scroll-mt-20">
			<h3 className="text-base font-semibold text-foreground">{title}</h3>
			<div className="rounded-md border border-border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">
				{children}
			</div>
		</section>
	);
}

function SettingRow({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background px-3 py-2">
			<div className="min-w-0">
				<p className="text-sm font-medium text-foreground">{title}</p>
				<p className="text-xs leading-5 text-muted-foreground">{description}</p>
			</div>
			{children}
		</div>
	);
}

function ModelsContent() {
	return (
		<div className="flex flex-col gap-8">
			<SettingsSectionNav
				sections={[
					{ id: "cloud", label: "Cloud" },
					{ id: "web-search", label: "Web Search" },
					{ id: "visibility", label: "Visibility" },
					{ id: "custom", label: "Custom Providers" },
				]}
			/>
			<Section id="cloud" title="Cloud Providers">
				<div className="flex flex-col gap-3">
					<SettingRow title="OpenAI Codex" description="Signed in. Used for reasoning-heavy tutoring and code examples.">
						<Toggle checked onChange={fn()} aria-label="OpenAI Codex enabled" />
					</SettingRow>
					<SettingRow title="Google Gemini" description="Configured for speech and image generation fallbacks.">
						<Toggle checked onChange={fn()} aria-label="Google Gemini enabled" />
					</SettingRow>
					<SettingRow title="Anthropic" description="No key saved in this browser.">
						<Toggle checked={false} onChange={fn()} aria-label="Anthropic enabled" />
					</SettingRow>
				</div>
			</Section>
			<Section id="web-search" title="Web Search">
				<SettingRow title="Grounding" description="Let Google-backed models use web grounding when a prompt includes URLs or asks for current information.">
					<Toggle checked onChange={fn()} aria-label="Grounding enabled" />
				</SettingRow>
			</Section>
			<Section id="visibility" title="Provider Visibility">
				Hide providers you never use so the model selector stays short during repeated tutoring sessions.
			</Section>
			<Section id="custom" title="Custom Providers">
				Custom OpenAI-compatible gateways and local endpoints appear here after discovery.
			</Section>
		</div>
	);
}

function LearningContent() {
	return (
		<div className="flex flex-col gap-8">
			<SettingsSectionNav
				sections={[
					{ id: "persona", label: "Persona" },
					{ id: "speech", label: "Speech" },
					{ id: "microphone", label: "Microphone" },
				]}
			/>
			<Section id="persona" title="Teacher Persona">
				Socratic, terse, practical. Pushes reconstruction before explanation.
			</Section>
			<Section id="speech" title="Speech & Voice">
				<SettingRow title="Live voice" description="Generate spoken explanations when the active provider supports it.">
					<Toggle checked={false} onChange={fn()} aria-label="Live voice enabled" />
				</SettingRow>
			</Section>
			<Section id="microphone" title="Microphone">
				For duplex speech providers, microphone capture remains explicit and off by default.
			</Section>
		</div>
	);
}

function AppContent() {
	return (
		<div className="flex flex-col gap-8">
			<SettingsSectionNav
				sections={[
					{ id: "chat", label: "Chat" },
					{ id: "animation", label: "Animation" },
					{ id: "flashcards", label: "Flashcards" },
				]}
			/>
			<Section id="chat" title="Chat">
				<SettingRow title="Auto-open artifacts" description="Open generated plans, maps, decks, and animations when tools finish.">
					<Toggle checked onChange={fn()} aria-label="Auto-open artifacts" />
				</SettingRow>
			</Section>
			<Section id="animation" title="Animation">
				Hyperframes is selected so animation artifacts render directly in chat and in the artifact viewer.
			</Section>
			<Section id="flashcards" title="Flashcards">
				<SettingRow title="Flashcard sounds" description="Play quiet feedback ticks while flipping and grading.">
					<Toggle checked={false} onChange={fn()} aria-label="Flashcard sounds" />
				</SettingRow>
			</Section>
		</div>
	);
}

const tabs: SettingsTabDef[] = [
	{ id: "models", label: "Models & Providers", component: <ModelsContent /> },
	{ id: "learning", label: "Learning", component: <LearningContent /> },
	{ id: "app", label: "App", component: <AppContent /> },
];

function SettingsDialogStory({ defaultTabId = "models" }: { defaultTabId?: string }) {
	const [open, setOpen] = useState(true);
	return (
		<div className="min-h-[720px] bg-[#07150f] p-6">
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="dialog-compact-button rounded-md border border-border bg-background px-3 py-2 text-sm font-medium"
			>
				Open settings
			</button>
			<SettingsDialog
				open={open}
				tabs={tabs}
				defaultTabId={defaultTabId}
				onClose={() => setOpen(false)}
			/>
		</div>
	);
}

const meta = {
	title: "Settings/SettingsDialog",
	component: SettingsDialog,
	parameters: {
		layout: "fullscreen",
	},
	render: (args) => <SettingsDialogStory defaultTabId={args.defaultTabId} />,
	args: {
		open: true,
		tabs,
		onClose: fn(),
		defaultTabId: "models",
	},
} satisfies Meta<typeof SettingsDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ModelsProviders: Story = {};

export const Learning: Story = {
	args: { defaultTabId: "learning" },
};

export const App: Story = {
	args: { defaultTabId: "app" },
};
