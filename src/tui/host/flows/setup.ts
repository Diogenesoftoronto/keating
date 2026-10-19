/**
 * The profile & setup wizard: display name, portrait, provider/model, thinking
 * effort and recommended runtime defaults.
 */
import { KEATING_VERSION } from "../../../core/version.js";
import { markTuiOnboardingSeen } from "../../onboarding.js";
import { type TuiProfile, loadTuiProfile, saveTuiProfile, validateCustomAvatarPath } from "../../profile.js";
import { sanitizeDiagnostic } from "../../view-model.js";
import type { HostContext } from "../context.js";
import { busySurfaceNotice } from "./common.js";
import { showModelPicker, showProviderLogin } from "./provider.js";

export type SetupDeps = Pick<HostContext, "client" | "controller" | "cwd" | "dialogs" | "openExternalUrl" | "state" | "surface" | "view">;

export async function showSetupWizard(deps: SetupDeps, options: { confirm?: boolean } = {}): Promise<void> {
  const { cwd, client, surface, state, dialogs } = deps;
  const { appendEntry, setFocusArea, refreshSidebarIdentity, status } = deps.view;
  const { presentSelect, presentTextInput } = dialogs;
  if (busySurfaceNotice(deps, "Setup")) return;
  if (options.confirm !== false) {
    const begin = await surface.presentConfirm(
      "Profile & setup · about one minute",
      "Set your name and profile image, then connect inference and runtime preferences without leaving OpenTUI. Secret inputs are hidden.",
    );
    if (!begin) return;
  }

  const displayNameResponse = await presentTextInput(
    "Set your learner name\nShown in the side panel. Change it later with /setup.",
    state.tuiProfile.displayName,
    "Display name…",
  );
  const displayName = displayNameResponse?.trim() || state.tuiProfile.displayName;
  const avatarChoice = await presentSelect(
    "Choose your profile image\nUse a built-in portrait, initials, or a local file. Change it later with /setup.",
    ["Built-in learner portrait", "Use my initials", "Choose local image…", "Keep current image"],
    { initialFocus: "list" },
  );
  let avatar: TuiProfile["avatar"] = state.tuiProfile.avatar;
  if (avatarChoice === "Built-in learner portrait") {
    avatar = { kind: "learner" };
  } else if (avatarChoice === "Use my initials") {
    const initials = await presentTextInput(
      "Initials · one or two characters",
      state.tuiProfile.avatar.initials ?? displayName.slice(0, 2).toUpperCase(),
      "ME",
    );
    if (initials !== undefined) avatar = { kind: "initials", initials };
  } else if (avatarChoice === "Choose local image…") {
    let customPath: string | undefined;
    while (customPath === undefined) {
      const supplied = await presentTextInput(
        "Local profile image path\nPNG, JPEG, GIF, BMP, or TIFF · 5 MiB max · read locally",
        state.tuiProfile.avatar.kind === "custom" ? state.tuiProfile.avatar.path : undefined,
        "./portrait.png",
      );
      if (supplied === undefined) break;
      try {
        customPath = await validateCustomAvatarPath(cwd, supplied);
      } catch (error) {
        const retry = await surface.presentConfirm(
          "That portrait could not be read",
          `${sanitizeDiagnostic(error)}\n\nChoose another local image?`,
        );
        if (!retry) break;
      }
    }
    if (customPath) avatar = { kind: "custom", path: customPath };
  }
  try {
    const nextProfile: TuiProfile = { schemaVersion: 1, displayName, avatar };
    await saveTuiProfile(cwd, nextProfile);
    state.tuiProfile = await loadTuiProfile(cwd);
    refreshSidebarIdentity();
  } catch (error) {
    appendEntry({
      id: `setup-profile-error-${Date.now()}`,
      kind: "error",
      title: "Terminal portrait was not saved",
      body: `${sanitizeDiagnostic(error)}\n\nThe prior terminal identity remains active. Provider and model setup can continue.`,
    });
  }

  try {
    let models = await client.getAvailableModels();
    if (models.length === 0) {
      const recovery = await presentSelect("No connected inference provider", ["Connect a provider in OpenTUI", "Continue with local interface tour", "Cancel"]);
      if (recovery === "Connect a provider in OpenTUI") {
        if (!await showProviderLogin(deps)) return;
        models = await client.getAvailableModels();
        if (models.length > 0) await showModelPicker(deps);
      } else if (recovery !== "Continue with local interface tour") return;
    } else {
      await showModelPicker(deps);
    }
    const thinking = await presentSelect("Thinking effort", ["off", "minimal", "low", "medium", "high", "xhigh"]);
    if (thinking) await client.setThinkingLevel(thinking);
    const defaults = await presentSelect("Runtime behavior", ["Recommended · retry on, compaction on, queues all", "Keep current runtime behavior"]);
    if (defaults?.startsWith("Recommended")) {
      await Promise.all([
        client.setAutoRetry(true),
        client.setAutoCompaction(true),
        client.setSteeringMode("all"),
        client.setFollowUpMode("all"),
      ]);
    }
    await markTuiOnboardingSeen(cwd, KEATING_VERSION);
    appendEntry({
      id: `setup-complete-${Date.now()}`,
      kind: "notice",
      title: "Keating setup complete",
      body: [
        `${state.tuiProfile.displayName}'s terminal portrait is ready.`,
        `${models.length} authenticated model${models.length === 1 ? "" : "s"} detected.`,
        thinking ? `Thinking set to ${thinking}.` : "Thinking was not changed.",
        "Use Ctrl+B for the side panel, :m for models, :p for every command, @path for files, and /setup to run this again.",
        "Change your name or profile image anytime: type /setup, or open Profile in the side panel (^B).",
        "Share publishes only after explicit confirmation and requires KEATING_SHARE_ORIGIN.",
      ].join("\n\n"),
    });
  } catch (error) {
    appendEntry({
      id: `setup-runtime-error-${Date.now()}`,
      kind: "error",
      title: "Setup paused safely",
      body: `${sanitizeDiagnostic(error)}\n\nYour saved terminal identity remains active. Provider, model, or runtime settings were not marked complete; repair access and reopen /setup to continue.`,
    });
    status.content = "Setup paused. Saved identity retained · repair provider access, then reopen /setup.";
    setFocusArea("composer");
  }
}
