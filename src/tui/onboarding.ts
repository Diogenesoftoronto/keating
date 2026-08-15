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
    ? "Provider setup is not complete. Use **/settings** or **/shell** to repair access."
    : "Your configured provider is ready. Ask a question to begin.";
  return [
    "# Welcome to Keating",
    "",
    "A local-first teaching workspace for questions, study plans, review cards, and courses.",
    "",
    providerLine,
    "",
    "- Type a question and press **Enter**.",
    "- Use **@path/to/file** to attach a text file to your prompt.",
    "- Type **/** for commands, or **! command** for an explicit shell handoff.",
    "- Press **Ctrl+F** to search this transcript and **Ctrl+P** for the command palette.",
    "- Open **Courses** from the palette to continue a local course.",
    "",
    "The setup wizard will open now. You can cancel safely and reopen it later with **/setup**.",
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
