import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  KEATING_RESOURCES,
  hasOnboardingState,
  loadTuiOnboardingState,
  markTuiOnboardingSeen,
  navigateTuiOnboarding,
  resetTuiOnboarding,
  shouldShowTuiOnboarding,
  tuiOnboardingActionForKey,
  tuiOnboardingLayout,
  tuiOnboardingPages,
} from "../src/tui/onboarding.js";
import {
  keatingLogoFrame,
  keatingObjectFrame,
  keatingSplashMode,
  keatingWordmarkHeight,
  shouldAnimateLogo,
} from "../src/tui/logo.js";
import { TUI_COMMANDS } from "../src/tui/view-model.js";

describe("TUI keyboard-first onboarding", () => {
  test("covers Keating capabilities, auth, keys, files/tools, panels, extensions, and verified resources", () => {
    const pages = tuiOnboardingPages({ hasProvider: false });
    const text = pages.flatMap((page) => [page.title, ...page.body]).join("\n");
    expect(pages).toHaveLength(8);
    expect(text).toContain("local-first hyperteacher");
    expect(text).toContain("keating login");
    expect(text).toContain("five minutes");
    expect(text).toContain("directly from the model picker");
    expect(text).toContain("OpenAI Codex");
    expect(text).toContain("Ctrl+P");
    expect(text).toContain("@path/to/file");
    expect(text).toContain("/settings");
    expect(text).toContain("prompts, skills, extensions, tools, and packages");
    expect(text).toContain("Choose the display name");
    expect(text).toContain("built-in learner portrait");
    expect(text).toContain("keating profile --name=");
    expect(text).toContain("--image=./portrait.png");
    expect(text).toContain(KEATING_RESOURCES.home);
    expect(text).toContain(KEATING_RESOURCES.tutorial);
    expect(text).toContain(KEATING_RESOURCES.repository);
    expect(text).toContain(KEATING_RESOURCES.issues);
    expect(tuiOnboardingPages({ hasProvider: true })[1]?.body.join(" ")).toContain("configured provider is ready");
  });

  test("maps complete keyboard controls and transitions from the final page into the prompt", () => {
    expect(tuiOnboardingActionForKey({ name: "space" })).toBe("next");
    expect(tuiOnboardingActionForKey({ name: "enter" })).toBe("next");
    expect(tuiOnboardingActionForKey({ name: "left" })).toBe("back");
    expect(tuiOnboardingActionForKey({ name: "backspace" })).toBe("back");
    expect(tuiOnboardingActionForKey({ name: "s" })).toBe("skip");
    expect(tuiOnboardingActionForKey({ name: "escape" })).toBe("skip");
    expect(tuiOnboardingActionForKey({ name: "p", ctrl: true })).toBeNull();

    expect(navigateTuiOnboarding(0, "back", 8)).toEqual({ pageIndex: 0, outcome: "active" });
    expect(navigateTuiOnboarding(0, "next", 8)).toEqual({ pageIndex: 1, outcome: "active" });
    expect(navigateTuiOnboarding(7, "next", 8)).toEqual({ pageIndex: 7, outcome: "completed" });
    expect(navigateTuiOnboarding(3, "skip", 8)).toEqual({ pageIndex: 3, outcome: "skipped" });
    expect(TUI_COMMANDS).toContainEqual(expect.objectContaining({ id: "onboarding", label: "Replay onboarding" }));
  });

  test("persists completion owner-only and reset makes the tour eligible again", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-onboarding-"));
    try {
      expect(await loadTuiOnboardingState(cwd)).toEqual({ schemaVersion: 1 });
      expect(shouldShowTuiOnboarding(await loadTuiOnboardingState(cwd), { hasSavedSession: false })).toBe(true);
      await markTuiOnboardingSeen(cwd, "3.9.0");
      expect(await hasOnboardingState(cwd)).toBe(true);
      const completed = await loadTuiOnboardingState(cwd);
      expect(completed).toMatchObject({ schemaVersion: 1, lastSeenVersion: "3.9.0", completedAt: expect.any(String) });
      expect(shouldShowTuiOnboarding(completed, { version: "3.9.0" })).toBe(false);
      if (process.platform !== "win32") {
        expect((await stat(join(cwd, ".keating", "state", "tui-onboarding.json"))).mode & 0o777).toBe(0o600);
      }
      await resetTuiOnboarding(cwd);
      expect(await hasOnboardingState(cwd)).toBe(false);
      expect(shouldShowTuiOnboarding(await loadTuiOnboardingState(cwd))).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("skips first-run onboarding for a saved session", () => {
    expect(shouldShowTuiOnboarding({ schemaVersion: 1 }, { hasSavedSession: true })).toBe(false);
    expect(shouldShowTuiOnboarding({ schemaVersion: 1, completedAt: "now" })).toBe(false);
  });

  test("degrades onboarding and splash geometry across terminal sizes", () => {
    expect(tuiOnboardingLayout(100, 30)).toBe("full");
    expect(tuiOnboardingLayout(60, 18)).toBe("compact");
    expect(tuiOnboardingLayout(40, 12)).toBe("minimal");
    expect(keatingSplashMode({ width: 86, height: 31, glyphMode: "unicode", shellPadding: 1, hintLines: 3 })).toBe("full");
    expect(keatingSplashMode({ width: 20, height: 9, glyphMode: "unicode", shellPadding: 0, hintLines: 3 })).toBe("hidden");
  });

  test("runs a large K stereogram only for interactive, motion-enabled terminals", () => {
    const unicodeFrame = keatingObjectFrame(0, "unicode");
    const asciiFrame = keatingObjectFrame(0, "ascii");
    expect(unicodeFrame.split("\n")).toHaveLength(10);
    expect(Math.max(...unicodeFrame.split("\n").map((line) => [...line].length))).toBeGreaterThanOrEqual(32);
    expect(unicodeFrame).toMatch(/[●◆]/);
    expect(keatingObjectFrame(1, "unicode")).not.toBe(keatingObjectFrame(0, "unicode"));
    expect(asciiFrame).toMatch(/[oO@]/);
    expect(asciiFrame).not.toMatch(/[⠂•●◆]/);
    expect(shouldAnimateLogo({ TERM: "xterm-256color" }, true)).toBe(true);
    expect(shouldAnimateLogo({ TERM: "dumb" }, true)).toBe(false);
    expect(shouldAnimateLogo({ REDUCE_MOTION: "1" }, true)).toBe(false);
    expect(shouldAnimateLogo({}, false)).toBe(false);
  });
});

describe("TUI full splash compatibility", () => {
  test("retains ASCII and Unicode brand fallbacks", () => {
    expect(keatingLogoFrame(0, "ascii")).not.toContain("█");
    expect(keatingWordmarkHeight("ascii")).toBe(31);
    expect(keatingLogoFrame(0, "ascii")).toContain("*@@@@@@@@*%@%");
    expect(keatingWordmarkHeight("unicode")).toBe(20);
    expect(keatingLogoFrame(0, "unicode")).toContain("⣿⡆⣠⣾⠟⢰⣿⡿⠿⠿");
  });
});
