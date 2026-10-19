import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingRow } from "../components/SettingRow";
import { Toggle } from "../components/Toggle";
import { isDuplicateLanguage, parseList, reconcileListText } from "../components/profile/ProfileFieldGroups";
import {
	CHAT_ONBOARDING_STORAGE_KEY,
	markChatOnboarding,
	readChatOnboardingResume,
} from "../components/ChatOnboarding";

function memoryStorage(initial?: string) {
	const data = new Map<string, string>(initial ? [[CHAT_ONBOARDING_STORAGE_KEY, initial]] : []);
	return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

test("a switch inside a SettingRow is named by the row's visible title and described by its text", () => {
	const html = renderToStaticMarkup(<SettingRow title="Show reasoning" description="Display the model's thinking."><Toggle checked={false} onChange={() => {}} /></SettingRow>);
	const titleId = /id="([^"]+)"[^>]*>Show reasoning</.exec(html)?.[1];
	const descriptionId = /id="([^"]+)"[^>]*>Display the model/.exec(html)?.[1];
	expect(titleId).toBeTruthy();
	expect(descriptionId).toBeTruthy();
	expect(html).toContain(`aria-labelledby="${titleId}"`);
	expect(html).toContain(`aria-describedby="${descriptionId}"`);
});

test("an explicit aria-label wins over the row title, on the input itself", () => {
	const html = renderToStaticMarkup(<SettingRow title="Row"><Toggle checked aria-label="Custom" onChange={() => {}} /></SettingRow>);
	expect(html).toMatch(/<input[^>]*aria-label="Custom"/);
	expect(html).not.toContain("aria-labelledby");
});

test("typing a trailing comma keeps the raw text while the saved list is parsed", () => {
	expect(parseList("cooking, ")).toEqual(["cooking"]);
	expect(reconcileListText("cooking, ", ["cooking"])).toBe("cooking, ");
	expect(reconcileListText("cooking, chess", ["cooking", "chess"])).toBe("cooking, chess");
	// An outside change replaces the text.
	expect(reconcileListText("cooking, ", ["music"])).toBe("music");
});

test("duplicate other languages are detected ignoring case and spacing", () => {
	const rows = ["French", "Yoruba", ""];
	expect(isDuplicateLanguage(rows, 2, " french ")).toBe(true);
	expect(isDuplicateLanguage(rows, 2, "FRENCH")).toBe(true);
	expect(isDuplicateLanguage(rows, 0, "French")).toBe(false);
	expect(isDuplicateLanguage(rows, 2, "")).toBe(false);
	expect(isDuplicateLanguage(rows, 2, "Spanish")).toBe(false);
});

test("onboarding resumes on a stable step id with its access and intake choices", () => {
	const saved = memoryStorage();
	markChatOnboarding("in-progress", saved, 3, { stepId: "setup", access: "byok", mode: "conversation" });
	// Conversation track is shorter, so the id, not the number, decides.
	expect(readChatOnboardingResume(saved)).toEqual({ step: 2, access: "byok", mode: "conversation" });
});

test("a legacy numeric record still resumes on the form track", () => {
	const saved = memoryStorage(JSON.stringify({ version: 2, outcome: "in-progress", step: 4 }));
	expect(readChatOnboardingResume(saved)).toEqual({ step: 4, access: "keating", mode: "form" });
	expect(readChatOnboardingResume(memoryStorage(JSON.stringify({ version: 2, outcome: "in-progress", stepId: "gone", step: 99, access: "x" }))))
		.toEqual({ step: 7, access: "keating", mode: "form" });
});
