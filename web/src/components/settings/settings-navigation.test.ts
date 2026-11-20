import { expect, test } from "bun:test";
import { resolveDestination } from "./groups";
import { searchSettings } from "./search";
import { eventDestination } from "../../hooks/agent/settings-deep-link";

for (const [section, aliases] of Object.entries({
	"getting-around": ["start"],
	display: ["app", "appearance", "interface.display"],
	layout: ["ui-chat"],
	profile: [
		"learning",
		"profile-identity",
		"profile-language",
		"profile-context",
		"profile-goals",
		"profile-pedagogy",
		"profile-accessibility",
		"profile-notes",
		"learning-profile-language",
	],
	voice: ["speech", "learning.speech", "speech-provider", "voice-settings"],
	teaching: ["persona"],
	companion: ["learning-companion"],
	recall: ["local-recall", "decision-policies"],
	jobs: ["models", "model-roles", "your-models", "ui-reasoning", "unknown"],
	providers: [
		"providers",
		"models-cloud-providers",
		"my-models",
		"custom-providers",
	],
	checking: ["judgement", "models.judgement"],
	connections: ["sources", "knowledge-sources", "models.connections", "connect-sources"],
	"web-search": ["web-search", "models.web-search"],
	build: ["proxy", "ui-animation"],
	images: ["ui-images"],
	privacy: ["ui-share", "ui-privacy"],
	health: ["diagnostics"],
	"your-data": ["data.your-data"],
})) {
	test(section + " accepts legacy routes and events", () => {
		for (const name of aliases) {
			for (const detail of [
				name,
				{ tab: name },
				{ section: name },
				{ tab: "models", section: name },
			])
				expect(resolveDestination(eventDestination(detail)).section.id).toBe(
					section,
				);
		}
	});
}
test("search resolves old vocabulary and row anchors", () => {
	expect(searchSettings("appearance").some((s) => s.id === "theme")).toBe(true);
	expect(searchSettings("reasoning level")[0].section).toBe("jobs");
	expect(searchSettings("no such preference")).toEqual([]);
});

test("desktop offline links use the bridge section's actual id", () => {
	const old = Object.getOwnPropertyDescriptor(globalThis, "window");
	try {
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { keatingOffline: {} },
		});
		for (const name of [
			"offline-tutor",
			"models-offline-tutor",
			"models.offline",
		]) {
			const { section } = resolveDestination(name);
			expect(section.id).toBe("offline");
			expect(section.anchor).toBe("offline-tutor");
		}
	} finally {
		if (old) Object.defineProperty(globalThis, "window", old);
		else Reflect.deleteProperty(globalThis, "window");
	}
});
