import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { tuiProfilePath } from "../src/tui/profile.js";
import { beginOnboarding, finishOnboarding } from "../src/tui/host/flows/onboarding.js";
import { showSetupWizard } from "../src/tui/host/flows/setup.js";
import { choose, createFlowHarness, type FlowHarness } from "./tui-host-harness.js";

let harness: FlowHarness | undefined;
afterEach(async () => { await harness?.destroy(); harness = undefined; });

describe("showSetupWizard", () => {
  test("confirms first, and stops cleanly when declined", async () => {
    harness = await createFlowHarness();
    harness.script(choose("No"));
    await showSetupWizard(harness.ctx);
    expect(harness.dialogs.map((call) => call.title)).toEqual(["Profile & setup · about one minute"]);
    expect(harness.calls.client).toEqual([]);
  });

  test("walks name, portrait, thinking and runtime defaults, saving the profile and applying settings", async () => {
    harness = await createFlowHarness();
    harness.script(
      "Ada Lovelace", // display name
      choose("initials"), // portrait style
      "AL", // initials
      choose("Continue with local interface tour"), // no provider connected
      choose("high"), // thinking
      choose("Recommended"), // runtime defaults
    );
    await showSetupWizard(harness.ctx, { confirm: false });

    expect(harness.dialogs.map((call) => call.title)).toEqual([
      "Set your learner name\nShown in the side panel. Change it later with /setup.",
      "Choose your profile image\nUse a built-in portrait, initials, or a local file. Change it later with /setup.",
      "Initials · one or two characters",
      "No connected inference provider",
      "Thinking effort",
      "Runtime behavior",
    ]);
    const thinking = harness.dialogs[4]!;
    expect(thinking.kind === "select" && thinking.options).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);

    const called = harness.calls.client.map(([name]) => name);
    expect(called).toContain("setThinkingLevel");
    expect(harness.calls.client).toContainEqual(["setThinkingLevel", "high"]);
    for (const setter of ["setAutoRetry", "setAutoCompaction", "setSteeringMode", "setFollowUpMode"]) {
      expect(called).toContain(setter);
    }
    expect(harness.state.tuiProfile.displayName).toBe("Ada Lovelace");
    expect(harness.state.tuiProfile.avatar).toEqual({ kind: "initials", initials: "AL" });
    const saved = JSON.parse(await readFile(tuiProfilePath(harness.cwd), "utf8"));
    expect(saved).toMatchObject({ displayName: "Ada Lovelace", avatar: { kind: "initials", initials: "AL" } });
    expect(harness.entryTitles()).toContain("Keating setup complete");
  });

  test("keeps the current name and image when the learner cancels those steps", async () => {
    harness = await createFlowHarness();
    harness.script(undefined, choose("Keep current"), choose("Continue with local"), undefined, undefined);
    await showSetupWizard(harness.ctx, { confirm: false });
    expect(harness.state.tuiProfile.displayName).toBe("Learner");
    expect(harness.state.tuiProfile.avatar).toEqual({ kind: "learner" });
    expect(harness.calls.client.map(([name]) => name)).not.toContain("setThinkingLevel");
  });

  test("a runtime failure pauses setup safely and returns focus to the composer", async () => {
    harness = await createFlowHarness({ client: { getAvailableModels: async () => { throw new Error("rpc down"); } } });
    harness.state.interaction = { ...harness.state.interaction, focusArea: "transcript" };
    harness.script(undefined, choose("Keep current"));
    await showSetupWizard(harness.ctx, { confirm: false });
    expect(harness.entryTitles()).toContain("Setup paused safely");
    // Refocusing repaints the idle hints over the pause message, as the host always did.
    expect(harness.status()).toBe(harness.ctx.view.idleStatus());
    expect(harness.state.interaction.focusArea).toBe("composer");
  });

  test("refuses while busy", async () => {
    harness = await createFlowHarness();
    harness.state.busy = true;
    await showSetupWizard(harness.ctx);
    expect(harness.dialogs).toEqual([]);
  });
});

describe("onboarding", () => {
  test("beginOnboarding records provider availability, shows the tour and blurs the composer", async () => {
    harness = await createFlowHarness({ client: { getAvailableModels: async () => [{ provider: "a", id: "b" }] } });
    await beginOnboarding(harness.ctx);
    expect(harness.state.firstRunHasProvider).toBe(true);
    expect(harness.state.interaction.onboarding).toEqual({ active: true, pageIndex: 0 });
    expect(harness.parts.onboarding.visible).toBe(true);
    expect(harness.parts.inputFrame.visible).toBe(false);
  });

  test("beginOnboarding treats an unreachable catalog as no provider", async () => {
    harness = await createFlowHarness({ client: { getAvailableModels: async () => { throw new Error("down"); } } });
    await beginOnboarding(harness.ctx);
    expect(harness.state.firstRunHasProvider).toBe(false);
  });

  test("skipping the tour returns focus to the composer and reports the replay command", async () => {
    harness = await createFlowHarness();
    await beginOnboarding(harness.ctx);
    await finishOnboarding(harness.ctx, "skipped");
    expect(harness.state.interaction.onboarding.active).toBe(false);
    expect(harness.state.interaction.focusArea).toBe("composer");
    expect(harness.state.suppressEmptySplash).toBe(true);
    expect(harness.status()).toContain("Tour skipped");
    expect(harness.dialogs).toEqual([]);
    expect(harness.parts.inputFrame.visible).toBe(true);
  });

  test("completing the tour continues into setup without the confirm step", async () => {
    harness = await createFlowHarness();
    harness.script(undefined, choose("Keep current"), choose("Continue with local"), undefined, undefined);
    await beginOnboarding(harness.ctx);
    await finishOnboarding(harness.ctx, "completed");
    expect(harness.dialogs[0]!.title).toContain("Set your learner name");
  });
});
