import { readThemePreference } from "../../theme-sync";
import {
	loadModelPrefs,
	loadKeatingUiSettings,
} from "../../keating/ui-settings";
import { loadDeclaredProfile } from "../../keating/learner-profile-store";
import { SPEECH_SECTIONS } from "../SpeechSettingsTab";
import type { ComponentType } from "react";
import type { GlyphName } from "../../design-system/glyphs";
import { desktopOfflineBridge } from "../../lib/desktop-offline";
import {
	DisplaySettings,
	MotionSettings,
	ChatLayout,
	CompanionSound,
	InterfacePreview,
} from "./interface/InterfaceSections";
import { StartTab } from "./StartTab";
import { LearningTab, TeachingSection, VoiceSection, RecallSection } from "./LearningTab";
import { Connections, ModelsAside, WebSearch, useModelsAttention } from "./ModelsProvidersTab";
import { ProvidersModelsTab } from "../ProvidersModelsTab";
import { ModelRolesPanel } from "./ModelRolesPanel";
import { OfflineTutorSettings } from "../OfflineTutorSettings";
import { JudgementSettings } from "./JudgementSettings";
import { ProxyTab } from "../ProxyTab";
import { DiagnosticsTab, HealthSummary } from "./DiagnosticsTab";
import { YourDataSection } from "../export/YourDataSection";
import { SharingPrivacy } from "./data/SharingPrivacy";
import { AccountImage } from "./models/AccountImage";
import { ImageSettings } from "./models/ImageSettings";
import { NotOrganicAccountCard } from "./NotOrganicAccountCard";
import { LEARNER_PROFILE_SECTIONS } from "../LearnerProfileTab";

export interface Section {
	id: string;
	title: string;
	component: ComponentType;
	aliases: string[];
	anchor?: string;
	aside?: ComponentType;
	supplement?: ComponentType;
	available?(): boolean;
	useStatus?(): string;
}
export interface Group {
	id: string;
	title: string;
	glyph: GlyphName;
	docsPath:string;
	summary: string;
	currentSummary(): string;
	sections: Section[];
}
function section(
	id: string,
	title: string,
	component: ComponentType,
	aliases: string[] = [],
	extras: Partial<Section> = {},
): Section {
	return { id, title, component, aliases, ...extras };
}
function Account() {
	return (
		<>
			<NotOrganicAccountCard />
			<AccountImage />
		</>
	);
}
// Older recording URLs used ?settings=diagnostics&source=… before the explorer moved.
function hasLinkedRecording() {
	return typeof window !== "undefined" && !!window.location?.search && new URLSearchParams(window.location.search).has("source");
}
export const groups: Group[] = [
	{
		id: "interface",
		docsPath: "start-here/",
		title: "Interface",
		glyph: "gear",
		summary: "Display, motion and chat layout",
		currentSummary: () =>
			({ light: "Paper", dark: "Terminal", system: "System theme" })[
				readThemePreference()
			] +
			" · " +
			(loadKeatingUiSettings().visualEffects ? "Effects on" : "Effects off"),
		sections: [
			section("display", "Display and reading", DisplaySettings, [
				"app",
				"appearance",
			]),
			section("motion", "Motion and effects", MotionSettings),
			section("layout", "Chat layout", ChatLayout, ["ui-chat"]),
			section("companion", "Companion and sound", CompanionSound),
			section("getting-around", "Getting around", StartTab, ["start"]),
		].map((s) => ({ ...s, aside: InterfacePreview })),
	},
	{
		id: "learning",
		docsPath: "learning-with-keating/",
		title: "Learning",
		glyph: "bulb",
		summary: "Profile, teaching and voice",
		currentSummary: () =>
			loadDeclaredProfile().reduceMotion
				? "Reduced motion · Profile and voice"
				: "Follow system motion · Profile and voice",
		sections: [
			section(
				"profile",
				"Your profile",
				LearningTab,
				LEARNER_PROFILE_SECTIONS.map((s) => s.id),
			),
			section("teaching", "Teaching", TeachingSection, ["persona"], {
				anchor: "settings-section-persona",
			}),
			section(
				"voice",
				"Voice and Live",
				VoiceSection,
				["speech", "voice-settings", "live-consent", ...SPEECH_SECTIONS.map((s) => s.id)],
				{ anchor: "settings-section-speech" },
			),
			section(
				"recall",
				"Recall and predictions",
				RecallSection,
				["local-recall", "decision-policies", "predictions"],
				{ anchor: "settings-section-local-recall" },
			),
		],
	},
	{
		id: "models",
		docsPath: "choose-a-model/",
		title: "Models and connections",
		glyph: "chip",
		summary: "Models, accounts and sources",
		currentSummary: () =>
			loadModelPrefs().defaultChatModelKey ??
			"New chats use the most recent model",
		sections: [
			section("jobs", "Models for each job", ModelRolesPanel, ["model-roles", "your-models", "ui-reasoning"]),
			section("providers", "Providers and keys", ProvidersModelsTab, ["cloud-providers", "my-models", "custom-providers"], {useStatus:useModelsAttention}),
			section("account", "Your account", Account),
			section("connections", "Connections", Connections, ["sources", "knowledge-sources", "source-permissions", "connect-sources"]),
			section("web-search", "Web search", WebSearch, []),
			section("checking", "Checking replies", JudgementSettings, ["judgement"]),
			section("offline", "Offline tutor", OfflineTutorSettings, ["offline-tutor"], {anchor:"offline-tutor",available:()=>!!desktopOfflineBridge()}),
			section("images", "Images", ImageSettings, ["ui-images"]),
			section("build", "How this build is set up", ProxyTab, ["proxy","ui-animation"]),
		].map(s => ({...s, aside:ModelsAside})),
	},
	{
		id: "data",
		docsPath: "troubleshooting/",
		title: "Data and support",
		glyph: "lock",
		summary: "Privacy, exports and health",
		currentSummary: () =>
			loadKeatingUiSettings().diagnosticsReporting
				? "Crash reporting on"
				: "Crash reporting off",
		sections: [
			section("privacy", "What leaves this device", SharingPrivacy, [
				"ui-share",
				"ui-privacy", "app-privacy", "app-share", "app-ui-share", "app-ui-privacy", "extraction-privacy",
			]),
			section("your-data", "Your data", YourDataSection),
			{
				...section("health", "Health", HealthSummary),
				get aliases() { return hasLinkedRecording() ? [] : ["diagnostics"]; },
			},
			{
				...section("developer", "Developer tools", DiagnosticsTab),
				get aliases() {
					const aliases = ["developer-tools", "diagnostics-developer", "app-developer", "interface-use"];
					return hasLinkedRecording() ? [...aliases, "diagnostics"] : aliases;
				},
			},
		],
	},
];
export function resolveDestination(raw: string) {
	const groupName = raw.split(/[.-]/)[0];
	const prefix = groups.find((g) => g.id === groupName);
	const name = raw.includes(".")
		? raw.slice(raw.indexOf(".") + 1)
		: prefix && raw.startsWith(prefix.id + "-")
			? raw.slice(prefix.id.length + 1)
			: raw;
	for (const group of groups) {
		const section = group.sections.find(
			(s) => s.id === name || s.aliases.includes(name),
		);
		if (section && (!section.available || section.available()))
			return {
				group,
				section,
				anchor: section.aliases.includes(name)
					? "settings-section-" + name
					: undefined,
			};
	}
	const group = prefix ?? groups[2];
	return { group, section: group.sections[0], anchor: undefined };
}
