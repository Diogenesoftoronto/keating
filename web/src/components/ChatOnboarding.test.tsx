import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NOTORGANIC_DEFAULT_MODEL } from "../notorganic-provider";
import { CHAT_ONBOARDING_STORAGE_KEY, ChatOnboarding, ONBOARDING_STEPS, hasCompletedChatOnboarding, markChatOnboarding, readChatOnboardingStep } from "./ChatOnboarding";

function storage() {
	const values = new Map<string, string>();
	return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

const inert = {
	onUseKeating: () => { throw new Error("must not change model on render"); },
	onConnectAccount: () => { throw new Error("must not connect on render"); },
	onChooseModel: () => { throw new Error("must not choose on render"); },
	onComplete: () => { throw new Error("must not finish on render"); },
	onSkip: () => { throw new Error("must not skip on render"); },
};

test("first render leaves completion unset and exposes the unconditional skip action", () => {
	const saved = storage();
	expect(hasCompletedChatOnboarding(saved)).toBe(false);
	const html = renderToStaticMarkup(<ChatOnboarding {...inert} initialStep={0} />);
	expect(html).toContain("Go straight to chat");
	expect(html).toContain("Continue");
	expect(html).toContain("1 of 4");
	expect(saved.getItem(CHAT_ONBOARDING_STORAGE_KEY)).toBeNull();
});

test("both tracks share four named stages", () => {
	expect(ONBOARDING_STEPS.map(step => step.label)).toEqual(["Question", "Model", "You", "Ready"]);
	for (const [index, step] of ONBOARDING_STEPS.entries()) {
		const html = renderToStaticMarkup(<ChatOnboarding {...inert} initialStep={index}/>);
		expect(html).toContain(`aria-current="step" aria-label="Step ${index + 1} of 4: ${step.label}"`);
	}
});

test("model access still leads, unchanged, on its own step", () => {
	const access = ONBOARDING_STEPS.findIndex((step) => step.id === "model");
	const html = renderToStaticMarkup(<ChatOnboarding {...inert} initialStep={access} />);
	expect(html).toContain(NOTORGANIC_DEFAULT_MODEL.name);
	expect(html).toContain("Bring your own key");
	expect(html).toMatch(/checked=""[^>]*value="keating"/);
});

test("asking for age offers a band and a refusal, never a date of birth", () => {
	const identity = ONBOARDING_STEPS.findIndex((step) => step.id === "you");
	const html = renderToStaticMarkup(<ChatOnboarding {...inert} initialStep={identity} />);
	expect(html).toContain("Age range");
	expect(html).toContain("Prefer not to say");
	expect(html).not.toContain('type="date"');
});

test("explicit completion and skipping persist only versioned outcome metadata", () => {
	for (const outcome of ["completed", "skipped"] as const) {
		const saved = storage();
		expect(markChatOnboarding(outcome, saved)).toBe(true);
		expect(hasCompletedChatOnboarding(saved)).toBe(true);
		expect(Object.keys(JSON.parse(saved.getItem(CHAT_ONBOARDING_STORAGE_KEY)!)).sort()).toEqual(["completedAt", "outcome", "step", "version"]);
	}
});

test("an unfinished run resumes where it stopped without counting as complete", () => {
	const saved = storage();
	expect(markChatOnboarding("in-progress", saved, 2)).toBe(true);
	expect(hasCompletedChatOnboarding(saved)).toBe(false);
	expect(readChatOnboardingStep(saved)).toBe(2);
	expect(JSON.parse(saved.getItem(CHAT_ONBOARDING_STORAGE_KEY)!).completedAt).toBeNull();
});

test("a resume position past the end of the flow is clamped, not trusted", () => {
	const saved = storage();
	for (const [step, expected] of [[99, ONBOARDING_STEPS.length - 1], [-3, 0], [1.5, 0]] as const) {
		saved.setItem(CHAT_ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 2, outcome: "in-progress", step }));
		expect(readChatOnboardingStep(saved)).toBe(expected);
	}
});

test("a finished v1 record stays finished after the version bump", () => {
	const saved = storage();
	saved.setItem(CHAT_ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 1, outcome: "completed", completedAt: "2026-01-01T00:00:00.000Z" }));
	expect(hasCompletedChatOnboarding(saved)).toBe(true);
	expect(readChatOnboardingStep(saved)).toBe(0);
});

test("unknown versions and invalid flags do not hide onboarding", () => {
	const saved = storage();
	for (const value of ["broken JSON", "[]", '{"version":3,"outcome":"completed"}', '{"version":1,"outcome":"viewed"}', '{"version":2,"outcome":"in-progress","step":2}']) {
		saved.setItem(CHAT_ONBOARDING_STORAGE_KEY, value);
		expect(hasCompletedChatOnboarding(saved)).toBe(false);
	}
});

test("unavailable browser storage never blocks explicit completion", () => {
	const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
	expect(hasCompletedChatOnboarding(blocked)).toBe(false);
	expect(readChatOnboardingStep(blocked)).toBe(0);
	expect(markChatOnboarding("skipped", blocked)).toBe(false);
});

test("legacy screen ids and numeric positions migrate to the corresponding stage", () => {
	const saved = storage();
	for (const [index, id] of ["welcome","access","setup","identity","learning","teaching","accessibility","finish"].entries()) {
		for (const position of [{ stepId: id, step: 0 }, { step: index }]) {
			saved.setItem(CHAT_ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 2, outcome: "in-progress", ...position }));
			expect(readChatOnboardingStep(saved)).toBe([0,1,1,2,2,2,2,3][index]);
		}
	}
});
