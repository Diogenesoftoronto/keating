import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { defaultDeclaredProfile, parseDeclaredProfile, type DeclaredLearnerProfile } from "@keating/learner-contracts";
import { learnerContextPrompt } from "../../keating/learner-context";
import { LanguageFields } from "./ProfileFieldGroups";

function LanguageProfileFixture({ initial = defaultDeclaredProfile() }: { initial?: DeclaredLearnerProfile }) {
  const [profile, setProfile] = useState(initial);
  const [saved, setSaved] = useState("");
  const [message, setMessage] = useState("");
  return <div style={{ width: "min(640px, calc(100vw - 32px))", padding: "16px" }}>
    <LanguageFields idPrefix="language-story" profile={profile} onChange={patch => {
      setProfile(current => ({ ...current, ...patch })); setMessage("");
    }} />
    <div style={{ marginTop: "24px", display: "flex", gap: "12px" }}>
      <button type="button" onClick={() => {
        const normalized = parseDeclaredProfile(profile);
        setSaved(JSON.stringify(normalized)); setProfile(normalized); setMessage("Profile saved in this fixture.");
      }}>Save profile</button>
      <button type="button" disabled={!saved} onClick={() => {
        setProfile(parseDeclaredProfile(saved)); setMessage("Saved profile reloaded.");
      }}>Reload saved profile</button>
    </div>
    <p role="status" style={{ marginTop: "8px", fontSize: "13px" }}>{message}</p>
    <output hidden data-testid="language-profile-evidence">{JSON.stringify({ profile, saved: saved ? JSON.parse(saved) : null, prompt: learnerContextPrompt("", parseDeclaredProfile(profile)) })}</output>
  </div>;
}

const meta = { title: "Profile/Other languages", component: LanguageProfileFixture, parameters: { layout: "centered" } } satisfies Meta<typeof LanguageProfileFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { args: {} };
export const LegacyLanguages: Story = { args: { initial: { ...defaultDeclaredProfile(), otherLanguages: ["French", "Mandarin Chinese"], otherLanguageFluencies: undefined } } };

export const TypingAndPersistence: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const evidence = () => JSON.parse(canvas.getByTestId("language-profile-evidence").textContent!);
    expect(canvas.getByLabelText("Language 1")).toHaveValue("");
    expect(canvas.getByRole("combobox", { name: "Fluency in language 1" })).toBeDisabled();
    await userEvent.type(canvas.getByLabelText("Language 1"), "French");
    await userEvent.click(canvas.getByRole("combobox", { name: "Fluency in French" }));
    await userEvent.click(body.getByRole("option", { name: "Fluent" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Add language" })).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Add language" }));
    await userEvent.type(canvas.getByLabelText("Language 2"), "Mandarin Chinese");
    expect(canvas.getByLabelText("Language 2")).toHaveValue("Mandarin Chinese");
    await userEvent.click(canvas.getByRole("combobox", { name: "Fluency in Mandarin Chinese" }));
    await userEvent.click(body.getByRole("option", { name: "Intermediate" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Add language" })).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Add language" }));
    await userEvent.type(canvas.getByLabelText("Language 3"), "Klingon");
    await userEvent.click(canvas.getByRole("button", { name: "Save profile" }));
    await userEvent.click(canvas.getByRole("button", { name: "Reload saved profile" }));
    expect(evidence().profile.otherLanguages).toEqual(["French", "Mandarin Chinese", "Klingon"]);
    expect(evidence().profile.otherLanguageFluencies).toEqual({ French: "fluent", "Mandarin Chinese": "intermediate" });
    expect(evidence().prompt).toContain("French (self-reported fluency: fluent)");
    expect(evidence().prompt).toContain("Mandarin Chinese (self-reported fluency: intermediate)");
    expect(evidence().prompt).toContain("not evidence of subject knowledge or mastery");
    await userEvent.type(canvas.getByLabelText("Language 1"), " Canadian");
    expect(canvas.getByRole("combobox", { name: "Fluency in French Canadian" })).toHaveTextContent("Fluent");
    expect(evidence().profile.otherLanguageFluencies).toEqual({ "French Canadian": "fluent", "Mandarin Chinese": "intermediate" });
    await userEvent.click(canvas.getByRole("button", { name: "Remove Mandarin Chinese" }));
    expect(evidence().profile.otherLanguageFluencies).toEqual({ "French Canadian": "fluent" });
    await userEvent.click(canvas.getByRole("button", { name: "Save profile" }));
    await userEvent.click(canvas.getByRole("button", { name: "Reload saved profile" }));
    expect(evidence().profile.otherLanguages).toEqual(["French Canadian", "Klingon"]);
    await userEvent.click(canvas.getByRole("combobox", { name: "Fluency in French Canadian" }));
    await userEvent.click(body.getByRole("option", { name: "Not answered" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Save profile" })).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Save profile" }));
    await userEvent.click(canvas.getByRole("button", { name: "Reload saved profile" }));
    expect(evidence().profile.otherLanguageFluencies).toEqual({});
    expect(canvas.getByRole("combobox", { name: "Fluency in French Canadian" })).toHaveTextContent("Not answered");
  },
};

export const EightLanguages: Story = {
  args: { initial: { ...defaultDeclaredProfile(), otherLanguages: ["French", "Mandarin Chinese", "Spanish", "Arabic", "Punjabi", "Portuguese", "Tagalog", "Tamil"] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("button", { name: "Add language" })).toBeDisabled();
    expect(canvas.getByLabelText("Language 8")).toHaveValue("Tamil");
    await userEvent.click(canvas.getByRole("button", { name: "Remove French" }));
    expect(canvas.getByRole("button", { name: "Add language" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Add language" }));
    await userEvent.type(canvas.getByLabelText("Language 8"), "Elvish");
    expect(canvas.getByRole("button", { name: "Add language" })).toBeDisabled();
    expect(canvas.getByLabelText("Language 8")).toHaveValue("Elvish");
  },
};
