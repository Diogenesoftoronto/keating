import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultDeclaredProfile, declaredProfilePromptLines, parseDeclaredProfile, type DeclaredLearnerProfile } from "@keating/learner-contracts";
import { IdentityFields, LanguageFields } from "../components/profile/ProfileFieldGroups";

const profile = (patch: Partial<DeclaredLearnerProfile>) => ({ ...defaultDeclaredProfile(), ...patch });

test("pronouns are a dropdown; an unlisted answer reveals its own text box", () => {
	const listed = renderToStaticMarkup(<IdentityFields profile={profile({ pronouns: "they/them" })} onChange={() => {}} />);
	expect(listed).not.toContain('id="profile-pronouns-other"');
	const other = renderToStaticMarkup(<IdentityFields profile={profile({ pronouns: "xe/xem" })} onChange={() => {}} />);
	expect(other).toContain('id="profile-pronouns-other"');
	expect(other).toContain('value="xe/xem"');
});

test("each other language gets its own row with a fluency choice", () => {
	const html = renderToStaticMarkup(<LanguageFields onChange={() => {}}
		profile={profile({ otherLanguages: ["French", "Yoruba"], otherLanguageFluencies: { French: "fluent" } })} />);
	expect(html).toContain("Fluency in French");
	expect(html).toContain("Fluency in Yoruba");
	expect(html).toContain('id="profile-other-language-1-other"');
	expect(html).not.toContain('id="profile-other-language-0-other"');
	expect(html).not.toContain("Comma separated");
});

test("per-language fluency survives parsing and reaches the tutor as self-reported context", () => {
	const parsed = parseDeclaredProfile({ ...defaultDeclaredProfile(), otherLanguages: ["French", "Tagalog"],
		otherLanguageFluencies: { french: "fluent", Tagalog: "wizard", Klingon: "native" } });
	expect(parsed.otherLanguageFluencies).toEqual({ French: "fluent" });
	expect(declaredProfilePromptLines(parsed).join("\n")).toContain("French (self-reported fluency: fluent), Tagalog");
});
