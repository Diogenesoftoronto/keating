import { expect, test } from "bun:test";

import {
	DEFAULT_WEB_SPEECH_SETTINGS,
	normalizeVoiceUtterance,
	voiceTagLine,
} from "../src/keating/speech";

test("web speech normalizes a short voice utterance", () => {
	const utterance = normalizeVoiceUtterance(
		{
			text: "  What would you test next?  ",
			tags: ["question", "verify", "ignored"],
			pace: "quick",
			affect: "curious",
		},
		DEFAULT_WEB_SPEECH_SETTINGS,
	);

	expect(utterance).toEqual({
		text: "What would you test next?",
		voice: "Kore",
		tags: ["question", "verify"],
		pace: "quick",
		affect: "curious",
	});
});

test("web speech renders voice tags without audio side effects", () => {
	const utterance = normalizeVoiceUtterance(
		{
			text: "Try that in your own words.",
			voice: "Puck",
			tags: "redirect,encourage",
		},
		DEFAULT_WEB_SPEECH_SETTINGS,
	);

	expect(voiceTagLine(utterance)).toBe(
		"[voice voice=Puck tags=redirect,encourage pace=conversational affect=warm] Try that in your own words.",
	);
});
