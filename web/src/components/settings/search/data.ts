import type { Scope } from "../ui";

const legacyKeywords: Record<string, string> = {
	privacy: "Appearance & Privacy",
	"your-data": "Diagnostics export import backups",
	health: "Diagnostics health checks",
	developer: "Diagnostics Developer chat details",
};

function entry(section: string, id: string, label: string, help: string, scope: Scope = "this device") {
	return { group: "data", section, id, label, help, scope, keywords: legacyKeywords[section] ?? "" };
}

export const dataEntries = [
	entry("privacy", "sd-lessons", "Your lessons", "Hosted teaching model provider"),
	entry("privacy", "sd-analytics", "Anonymous usage analytics", "PostHog product analytics"),
	entry("privacy", "sd-replay", "Session replay", "Privacy-masked interface recording"),
	entry("privacy", "sd-crash", "Crash and error reports", "Send sanitized diagnostics to Keating support"),
	entry("privacy", "sd-extraction", "Learning extraction", "Forecasts and extraction account connection"),
	entry("privacy", "sd-judgements", "Save judgements for review", "Extracted passages and memory decisions"),
	entry("privacy", "sd-arize", "Arize evaluation", "Share future turns and tracing"),
	entry("privacy", "sd-live", "Live audio and content logging", "GPT Live consent in Voice and Live", "your account"),
	entry("privacy", "sd-links", "Public links", "Share mode and first-use warning. Ask me again before the next public share."),
	...[
		["Everything on this device", "Export portable Keating JSON"],
		["A session review", "Export review ZIP"],
		["A training dataset", "Export training examples"],
		["Materials from your sessions", "Open plans, maps and decks"],
		["Flashcards", "Anki APKG or TSV"],
		["Room transcripts", "Export Markdown from a room’s People panel"],
		["Bring data in", "Import a portable Keating file"],
	].map(([label, help]) => entry("your-data", "sd-" + label.toLowerCase().replaceAll(" ", "-"), label, help)),
	entry("health", "sd-health-network", "Internet connection", "Browser network status"),
	entry("health", "sd-health-provider", "Model access", "Connected providers"),
	entry("health", "sd-health-storage", "Saved data", "Browser storage availability"),
	entry("health", "sd-health-errors", "Recent errors", "Problems in this session"),
	entry("health", "sd-report", "Copy report or send to Keating", "Sanitized report, errors only or summary"),
	entry("developer", "showDeveloperDetails", "Developer chat details", "Draft reviews and technical details"),
	entry("developer", "showReasoning", "Show reasoning", "Reasoning disclosure in chat"),
	entry("developer", "showToolUi", "Show tool details", "Tool arguments and results"),
	entry("developer", "autoExpandReasoning", "Auto-open reasoning", "Open reasoning automatically"),
	entry("developer", "showRawErrors", "Show raw error details", "Full error messages and response bodies"),
	entry("developer", "sd-reasoning-default", "Reasoning level", "Change it for this chat from the composer.", "new chats"),
	entry("developer", "sd-explorer", "Interface use", "Data source, import JSON, export trace, query from CLI, inspect turns"),
	entry("developer", "sd-capture", "Judgement capture and inspectors", "Include redacted question details, review completed replies, review live transcripts, delete saved records, clear captured calls and learning operations"),
	entry("developer", "sd-request-log", "Model request log", "Record model requests, download JSON, clear request log"),
	entry("developer", "sd-session", "Sensitive session inspector", "Model session debug mode, context, lifecycle, raw session report and tool runs"),
	entry("developer", "sd-safe", "Safe runtime diagnostics", "Copy failures, download safe report, clear events"),
];

export const dataKeywords = Object.fromEntries(Object.entries(legacyKeywords).map(([section, legacy]) => [
	section, [legacy, ...dataEntries.filter(entry => entry.section === section).map(entry => entry.label + " " + entry.help)].join(" "),
]));
