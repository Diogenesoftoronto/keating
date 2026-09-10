import { redirect } from "@tanstack/react-router";
import { DOCUMENTATION_URL, legacyTutorialHref } from "./tutorial-links";

export function tutorialRedirectBeforeLoad({ location, preload }: { location: { href: string }; preload: boolean }): void {
	if (preload) return;
	throw redirect({
		href: legacyTutorialHref(location.href) ?? DOCUMENTATION_URL,
		reloadDocument: true,
		replace: true,
	});
}
