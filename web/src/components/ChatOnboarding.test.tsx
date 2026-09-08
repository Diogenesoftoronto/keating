import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CHAT_ONBOARDING_STORAGE_KEY, ChatOnboarding, hasCompletedChatOnboarding, markChatOnboarding } from "./ChatOnboarding";

function storage() {
	const values = new Map<string, string>();
	return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("first render leaves completion unset and exposes the unconditional skip action", () => {
	const saved = storage();
	expect(hasCompletedChatOnboarding(saved)).toBe(false);
	const html = renderToStaticMarkup(<ChatOnboarding onUseKeating={() => { throw new Error("must not change model on render"); }} onConnectAccount={() => { throw new Error("must not connect on render"); }} onChooseModel={() => { throw new Error("must not choose on render"); }} onComplete={() => { throw new Error("must not finish on render"); }} onSkip={() => { throw new Error("must not skip on render"); }} />);
	expect(html).toContain("Go straight to chat");
	expect(html).toContain("Next");
	expect(html).toContain("Inkling Small");
	expect(html).toContain("Bring your own key");
	expect(html).toMatch(/checked=""[^>]*value="keating"/);
	expect(saved.getItem(CHAT_ONBOARDING_STORAGE_KEY)).toBeNull();
});

test("explicit completion and skipping persist only versioned outcome metadata", () => {
	for (const outcome of ["completed", "skipped"] as const) {
		const saved = storage();
		expect(markChatOnboarding(outcome, saved)).toBe(true);
		expect(hasCompletedChatOnboarding(saved)).toBe(true);
		expect(Object.keys(JSON.parse(saved.getItem(CHAT_ONBOARDING_STORAGE_KEY)!)).sort()).toEqual(["completedAt", "outcome", "version"]);
	}
});

test("unknown versions and invalid flags do not hide onboarding", () => {
	const saved = storage();
	for (const value of ["broken JSON", '{"version":2,"outcome":"completed"}', '{"version":1,"outcome":"viewed"}']) {
		saved.setItem(CHAT_ONBOARDING_STORAGE_KEY, value);
		expect(hasCompletedChatOnboarding(saved)).toBe(false);
	}
});

test("unavailable browser storage never blocks explicit completion", () => {
	const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
	expect(hasCompletedChatOnboarding(blocked)).toBe(false);
	expect(markChatOnboarding("skipped", blocked)).toBe(false);
});
