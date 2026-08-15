import { describe, expect, test } from "bun:test";
import { onboardingMarkdown, shouldShowTuiOnboarding } from "../src/tui/onboarding.js";
import { keatingLogoFrame, keatingWordmarkHeight, shouldAnimateLogo } from "../src/tui/logo.js";

describe("TUI first-run and logo affordances", () => {
  test("shows onboarding only for a genuinely new session", () => {
    expect(shouldShowTuiOnboarding({ schemaVersion: 1 }, { hasSavedSession: false })).toBe(true);
    expect(shouldShowTuiOnboarding({ schemaVersion: 1, completedAt: "now" }, { hasSavedSession: false })).toBe(false);
    expect(shouldShowTuiOnboarding({ schemaVersion: 1 }, { hasSavedSession: true })).toBe(false);
    expect(onboardingMarkdown()).toContain("@path/to/file");
  });

  test("has an ASCII-safe logo fallback and opt-out for motion", () => {
    expect(keatingLogoFrame(0, "ascii")).not.toContain("█");
    expect(keatingWordmarkHeight("ascii")).toBe(31);
    expect(keatingLogoFrame(0, "ascii")).toContain("*@@@@@@@@*%@%");
    expect(keatingLogoFrame(1, "ascii")).toBe(keatingLogoFrame(0, "ascii"));
    expect(shouldAnimateLogo({ TERM: "dumb" })).toBe(false);
    expect(shouldAnimateLogo({ KEATING_NO_MOTION: "1" })).toBe(false);
  });

  test("uses the detailed Braille reconstruction for Unicode terminals", () => {
    expect(keatingWordmarkHeight("unicode")).toBe(20);
    expect(keatingLogoFrame(0, "unicode")).toContain("⣿⡆⣠⣾⠟⢰⣿⡿⠿⠿");
  });
});
