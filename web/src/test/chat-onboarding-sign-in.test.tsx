import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatOnboarding, ONBOARDING_STEPS, adjacentOnboardingStep } from "../components/ChatOnboarding";

const index = (id: string) => ONBOARDING_STEPS.findIndex(step => step.id === id);
const noop = () => {};
const render = (props: Partial<Parameters<typeof ChatOnboarding>[0]> = {}) => renderToStaticMarkup(
	<ChatOnboarding onUseKeating={noop} onConnectAccount={noop} onChooseModel={noop} onComplete={noop} onSkip={noop} initialStep={index("setup")} {...props} />,
);

test("signed-in learners pass over the sign-in step in both directions", () => {
	expect(adjacentOnboardingStep(ONBOARDING_STEPS, index("access"), 1, true)).toBe(index("identity"));
	expect(adjacentOnboardingStep(ONBOARDING_STEPS, index("identity"), -1, true)).toBe(index("access"));
	expect(adjacentOnboardingStep(ONBOARDING_STEPS, index("access"), 1, false)).toBe(index("setup"));
	expect(adjacentOnboardingStep(ONBOARDING_STEPS, index("setup"), 1, true)).toBe(index("identity"));
});

test("the sign-in step has one action and no way forward until an account session is confirmed", () => {
	const html = render({ isSignedIn: () => new Promise<boolean>(() => {}) });
	expect(html).toContain("Sign in or create an account");
	expect(html).toContain("Checking your account…");
	expect(html).not.toContain(">Next<");
});

test("without an account checker the step is not gated", () => {
	expect(render()).toContain(">Next<");
});
