import { describe, expect, test } from "bun:test";
import { onboardingMarkdown, shouldShowTuiOnboarding } from "../src/tui/onboarding.js";
import {
  keatingLogoFrame,
  keatingSplashMode,
  keatingWordmarkHeight,
  shouldAnimateLogo,
} from "../src/tui/logo.js";

describe("TUI first-run and logo affordances", () => {
  test("shows onboarding only for a genuinely new session", () => {
    expect(shouldShowTuiOnboarding({ schemaVersion: 1 }, { hasSavedSession: false })).toBe(true);
    expect(shouldShowTuiOnboarding({ schemaVersion: 1, completedAt: "now" }, { hasSavedSession: false })).toBe(false);
    expect(shouldShowTuiOnboarding({ schemaVersion: 1 }, { hasSavedSession: true })).toBe(false);
    expect(onboardingMarkdown()).toContain("@path/to/file");
    expect(onboardingMarkdown()).toContain("tree of forked sessions");
    expect(onboardingMarkdown()).toContain("keating login");
    expect(onboardingMarkdown()).toContain("local image");
    expect(onboardingMarkdown()).toContain("**Name**");
    expect(onboardingMarkdown()).toContain("**Profile image**");
    expect(onboardingMarkdown()).toContain("**/setup**");
    expect(onboardingMarkdown()).toContain("**[S] PROFILE**");
    expect(onboardingMarkdown({ hasProvider: true })).toContain("configured provider is ready");
    expect(onboardingMarkdown({ hasProvider: false })).toContain("connect Not Organic");
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

  test("only shows the full raster when its terminal-cell geometry fits", () => {
    expect(keatingSplashMode({ width: 86, height: 31, glyphMode: "unicode", shellPadding: 1, hintLines: 3 })).toBe("full");
    expect(keatingSplashMode({ width: 85, height: 31, glyphMode: "unicode", shellPadding: 1, hintLines: 3 })).toBe("compact");
    expect(keatingSplashMode({ width: 86, height: 30, glyphMode: "unicode", shellPadding: 1, hintLines: 3 })).toBe("compact");

    expect(keatingSplashMode({ width: 70, height: 42, glyphMode: "ascii", shellPadding: 1, hintLines: 3 })).toBe("full");
    expect(keatingSplashMode({ width: 69, height: 42, glyphMode: "ascii", shellPadding: 1, hintLines: 3 })).toBe("compact");
    expect(keatingSplashMode({ width: 80, height: 24, glyphMode: "unicode", shellPadding: 0, hintLines: 3 })).toBe("compact");
    expect(keatingSplashMode({ width: 20, height: 9, glyphMode: "unicode", shellPadding: 0, hintLines: 3 })).toBe("hidden");
  });
});
