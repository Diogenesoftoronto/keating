import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TuiOnboardingState {
  schemaVersion: 1;
  completedAt?: string;
  lastSeenVersion?: string;
}

export interface TuiOnboardingOptions {
  version?: string;
  hasSavedSession?: boolean;
  hasProvider?: boolean;
}

export function onboardingStatePath(cwd: string): string {
  return join(cwd, ".keating", "state", "tui-onboarding.json");
}

export async function loadTuiOnboardingState(cwd: string): Promise<TuiOnboardingState> {
  try {
    const parsed = JSON.parse(await readFile(onboardingStatePath(cwd), "utf8")) as Partial<TuiOnboardingState>;
    return {
      schemaVersion: 1,
      ...(typeof parsed.completedAt === "string" ? { completedAt: parsed.completedAt } : {}),
      ...(typeof parsed.lastSeenVersion === "string" ? { lastSeenVersion: parsed.lastSeenVersion } : {}),
    };
  } catch {
    return { schemaVersion: 1 };
  }
}

export async function markTuiOnboardingSeen(cwd: string, version?: string): Promise<void> {
  const path = onboardingStatePath(cwd);
  await mkdir(join(cwd, ".keating", "state"), { recursive: true });
  await writeFile(path, `${JSON.stringify({
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    ...(version ? { lastSeenVersion: version } : {}),
  }, null, 2)}\n`, "utf8");
}

/** First useful launch only: saved sessions and provider setup are already guidance. */
export function shouldShowTuiOnboarding(
  state: TuiOnboardingState,
  options: TuiOnboardingOptions = {},
): boolean {
  if (options.hasSavedSession) return false;
  if (options.version && state.lastSeenVersion === options.version) return false;
  return !state.completedAt;
}

export function onboardingMarkdown(options: TuiOnboardingOptions = {}): string {
  const providerLine = options.hasProvider === false
    ? "3. **Inference** — connect Not Organic with **keating login**, or connect another provider directly from **/settings** or the model picker."
    : options.hasProvider === true
      ? "3. **Inference** — your configured provider is ready; choose its model."
      : "3. **Inference** — choose a connected provider and model.";
  return [
    "# Welcome to Keating",
    "",
    "A local-first teaching workspace where questions branch into sessions, evidence, study plans, and review.",
    "",
    "## One-minute setup",
    "",
    "1. **Name** — enter what Keating should call you.",
    "2. **Profile image** — use the built-in portrait, your initials, or a local image. The TUI reads it locally and never uploads it.",
    providerLine,
    "   Not Organic uses **keating login** for a five-minute, device-bound session.",
    "",
    "- Type a question and press **Enter**.",
    "- Use **@path/to/file** to attach a text file to your prompt; press **Tab** after `@` to browse project files.",
    "- Type **/** for commands, or **! command** for an explicit shell handoff.",
    "- Press **Ctrl+F** to search this transcript and **Ctrl+P** for the command palette.",
    "- Open **Courses** from the palette to continue a local course.",
    "",
    "Change your name or profile image later with **/setup**, or open **[S] PROFILE** in the **Ctrl+B** side panel. The panel also holds the model, actions, and tree of forked sessions; **Ctrl+P** lists every command.",
  ].join("\n");
}

export async function hasOnboardingState(cwd: string): Promise<boolean> {
  try {
    await access(onboardingStatePath(cwd));
    return true;
  } catch {
    return false;
  }
}
