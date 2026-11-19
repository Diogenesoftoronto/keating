import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	defaultDeclaredProfile,
	startPursuit,
} from "@keating/learner-contracts";
import { LearnerProfileTab } from "../LearnerProfileTab";
import { learnerContextPrompt } from "../../keating/learner-context";
import { GoalFields, PedagogyFields } from "./ProfileFieldGroups";

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

test("short teaching choices expose their current answer and a clear action", () => {
	const html = renderToStaticMarkup(<PedagogyFields profile={{ ...defaultDeclaredProfile(), tone: "warm" }} onChange={() => {}}/>);
	expect(html.match(/role="radiogroup"/g)).toHaveLength(5);
	expect(html.match(/Not answered/g)).toHaveLength(4);
 expect(html).toContain("Clear Tone");
	expect(html).toMatch(/aria-checked="true"[^>]*>Warm/);
});

test("the Learning summary uses the tutor prompt with the draft and legacy notes", () => {
	const profile = { ...defaultDeclaredProfile(), preferredName: "Ada", notes: "Evening classes" };
	const store = { save() {}, reset() {}, subscribe: () => () => {} };
	const html = renderToStaticMarkup(<LearnerProfileTab store={{ ...store, load: () => profile.notes }}
		profileStore={{ ...store, load: () => profile }}/>);
	expect(html).toContain(renderToStaticMarkup(<pre>{learnerContextPrompt(profile.notes, profile)}</pre>));
	expect(html).toContain("What Keating is told");
	expect(html).toContain("Save profile");
});

test("profile accessibility links to Interface and keeps teaching requirements editable", async () => {
 const { AccessibilityFields } = await import("./ProfileFieldGroups");
 const html = renderToStaticMarkup(<AccessibilityFields profile={{...defaultDeclaredProfile(),highContrast:true}} onChange={()=>{}} interfaceReadOnly/>);
 expect(html).toContain("Change in Interface");
 expect(html).toContain("Higher contrast · On");
 expect(html).not.toContain('aria-label="Higher contrast"');
 expect(html).toContain('aria-label="Plain language"');
});
