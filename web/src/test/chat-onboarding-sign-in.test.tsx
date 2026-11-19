import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatOnboarding, ONBOARDING_STEPS } from "../components/ChatOnboarding";

const index = (id: string) => ONBOARDING_STEPS.findIndex(step => step.id === id);
const noop = () => {};
const render = (props: Partial<Parameters<typeof ChatOnboarding>[0]> = {}) => renderToStaticMarkup(
	<ChatOnboarding onUseKeating={noop} onConnectAccount={noop} onChooseModel={noop} onComplete={noop} onSkip={noop} initialStep={index("model")} {...props} />,
);

test("checking an account leaves a way forward and a global exit", () => {
	const html = render({ isSignedIn: () => new Promise<boolean>(() => {}) });
	for (const label of ["Checking your account…", "Continue", "Go straight to chat"]) expect(html).toContain(label);
});

test("a learner without a session can use the hosted model later", () => {
	const html = render();
	expect(html).toContain("Sign in or create an account");
	expect(html).toMatch(/<button[^>]*class="ob-link"[^>]*>Skip sign-in for now/);
	expect(html).toContain("Continue");
});
