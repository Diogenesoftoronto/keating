import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TeacherPersonaTab } from "../TeacherPersonaTab";
import { SpeechSettingsTab, speechModelChoice } from "../SpeechSettingsTab";
import { searchSettings } from "./search";
import { resolveDestination } from "./groups";

test("Learning destinations mount distinct sections and retain profile and speech anchors", () => {
	const ids = ["profile", "teaching", "voice", "recall"];
	expect(
		new Set(
			ids.map((id) => resolveDestination("learning." + id).section.component),
		).size,
	).toBe(4);
	expect(resolveDestination("learning-profile-pedagogy").anchor).toBe(
		"settings-section-profile-pedagogy",
	);
	expect(resolveDestination("learning-speech-video").section.id).toBe("voice");
	expect(
		searchSettings("Socratic intensity").some(
			(row) => row.id === "pf-find-socratic",
		),
	).toBe(true);
	expect(
		searchSettings("response comparison").some(
			(row) => row.id === "response-comparison",
		),
	).toBe(true);
});

test("persona has one heading and its reset requires a confirmation", () => {
	const html = renderToStaticMarkup(<TeacherPersonaTab />);
	expect(html.match(/>Teacher persona<\/h3>/g)).toHaveLength(1);
	expect(html).toContain('for="pf-persona"');
	expect(html).toContain("characters");
	expect(html).toContain('role="alertdialog"');
	expect(html).toContain("Save persona");
});

test("voice settings labels each custom endpoint field and exposes account consent independently", () => {
	const html = renderToStaticMarkup(<SpeechSettingsTab hideNav />);
	for (const label of [
		"Label",
		"Base URL",
		"Model id",
		"Default voice",
		"Auth key from provider",
		"API path (optional)",
	]) {
		expect(html).toContain(">" + label + "</label>");
	}
	expect(html).toContain('id="live-consent"');
	expect(speechModelChoice("example")).toEqual({ model: "example" });
});
