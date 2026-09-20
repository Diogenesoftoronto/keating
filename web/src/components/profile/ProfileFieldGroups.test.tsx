import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	defaultDeclaredProfile,
	startPursuit,
} from "@keating/learner-contracts";
import { GoalFields } from "./ProfileFieldGroups";

test("onboarding asks for a flexible starting point without exposing pursuit management", () => {
	const profile = defaultDeclaredProfile();
	const html = renderToStaticMarkup(<GoalFields profile={profile} onChange={() => {}} idPrefix="onboarding" />);
	expect(html).toContain("A starting point, not a contract.");
	expect(html).not.toContain("Make this current");
	expect(html).not.toContain("Your pursuits");
});

test("settings shows the one current pursuit and set-aside alternatives", () => {
	const first = startPursuit([], { id: "a", title: "Understand recursion", now: 1 });
	const second = startPursuit(first, { id: "b", title: "Learn Portuguese", now: 2 });
	const profile = { ...defaultDeclaredProfile(), goalText: "Learn Portuguese", pursuits: second };
	const html = renderToStaticMarkup(<GoalFields profile={profile} onChange={() => {}} showPursuits />);

	expect(html).toContain("Understand recursion");
	expect(html).toContain("Learn Portuguese");
	expect(html).toContain("Current pursuit");
	expect(html).toContain("Set aside");
	expect(html).toContain("Make current");
	expect(html).toContain("Mark achieved");
});

test("the starting-point action is disabled when it already names the current pursuit", () => {
	const pursuits = startPursuit([], { id: "a", title: "Understand recursion", now: 1 });
	const profile = { ...defaultDeclaredProfile(), goalText: "Understand recursion", pursuits };
	const html = renderToStaticMarkup(<GoalFields profile={profile} onChange={() => {}} showPursuits />);
	expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Current pursuit<\/button>/);
});
