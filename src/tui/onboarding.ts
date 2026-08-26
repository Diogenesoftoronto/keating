import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

export type TuiOnboardingOutcome = "active" | "completed" | "skipped";

export interface TuiOnboardingNavigation {
  pageIndex: number;
  outcome: TuiOnboardingOutcome;
}

export interface TuiOnboardingKey {
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export type TuiOnboardingAction = "next" | "back" | "skip" | null;

export type TuiOnboardingLayout = "full" | "compact" | "minimal";

export interface TuiOnboardingPage {
  title: string;
  body: readonly string[];
}

export const KEATING_RESOURCES = {
  home: "https://keating.help",
  repository: "https://github.com/Diogenesoftoronto/keating#readme",
  tutorial: "https://github.com/Diogenesoftoronto/keating/blob/main/docs/TUTORIAL.md",
  issues: "https://github.com/Diogenesoftoronto/keating/issues",
} as const;

export function tuiOnboardingPages(options: TuiOnboardingOptions = {}): readonly TuiOnboardingPage[] {
  const providerStatus = options.hasProvider === true
    ? "A configured provider is ready. Use :m or Ctrl+M to choose among authenticated models."
    : options.hasProvider === false
      ? "No provider was detected. Connect API-key or subscription providers directly from the model picker or `/settings`, including OpenAI Codex. For a five-minute, device-bound Not Organic capability, run `keating login`."
      : "Connect API-key or subscription providers directly from the model picker or `/settings`, including OpenAI Codex. Use `keating login` for hosted Not Organic inference.";
  return [
    {
      title: "Build understanding, not borrowed answers",
      body: [
        "Keating is a local-first hyperteacher. Ask questions, diagnose gaps, build lesson plans and maps, practise retrieval, review cards, and inspect the evidence behind your learning.",
        "Your sessions, learner history, and generated artifacts stay in this project's `.keating/` directory unless you explicitly export or share them.",
      ],
    },
    {
      title: "Connect a model safely",
      body: [
        providerStatus,
        "Provider secrets belong in Keating's dedicated login/configuration flows—not in the visible prompt. Not Organic capabilities expire after five minutes and do not store your password or a refresh token.",
      ],
    },
    {
      title: "Everything important has a key",
      body: [
        "Enter sends · Ctrl+P opens all commands · Ctrl+B toggles the side panel · Ctrl+M selects a model · Ctrl+T changes thinking · Ctrl+N starts fresh · Ctrl+X stops a response.",
        "Tab moves focus between the prompt, transcript, and an open panel. Escape returns focus or closes a dialog. Type `:` for the compact keyboard leader menu.",
      ],
    },
    {
      title: "Bring your own context",
      body: [
        "Reference a readable text file with `@path/to/file`; Keating previews and validates references before sending. Start a line with `!` only when you intentionally want to run a shell command.",
        "Tools can read/search and create teaching artifacts. This OpenTUI surface does not claim code mutation; `/shell` hands the exact session to the capable Pi surface when execution or source changes are needed.",
      ],
    },
    {
      title: "Open depth only when you need it",
      body: [
        "The main shell stays focused on the transcript and prompt. Ctrl+B reveals profile, activity, and session branches; Ctrl+P opens sessions, library, review, courses, models, settings, sharing, and setup.",
        "Use `/settings` for runtime queues and capability details, `/setup` for identity/provider defaults, and `/onboarding` to replay this tour.",
      ],
    },
    {
      title: "Extend the teacher deliberately",
      body: [
        "Keating runs on Pi prompts, skills, extensions, tools, and packages. Use `keating package recommended|add|remove` outside the TUI, then restart so Pi can sync the configured packages.",
        "Packages and process tools execute with local system access. Review third-party code before enabling it; inspect tool activity in the transcript and stop active work with Ctrl+X.",
      ],
    },
    {
      title: "Contribute your verse",
      body: [
        `Start with a real question. Learn in the browser: ${KEATING_RESOURCES.home}`,
        `Tutorial: ${KEATING_RESOURCES.tutorial}`,
        `Source and issues: ${KEATING_RESOURCES.repository} · ${KEATING_RESOURCES.issues}`,
      ],
    },
    {
      title: "Make Keating yours",
      body: [
        "Press Space to open Profile & setup. Choose the display name shown beside your messages, then use the built-in learner portrait, your initials, or a local PNG, JPEG, GIF, BMP, or TIFF image up to 5 MiB. Local images are read locally and never uploaded by setup.",
        "Change it later with `/setup`. From a terminal, use `keating profile --name=\"Ada Lovelace\" --image=./portrait.png`; `--learner` selects the built-in portrait and `--initials=AL` uses initials.",
      ],
    },
  ];
}

export function tuiOnboardingLayout(width: number, height: number): TuiOnboardingLayout {
  if (width >= 72 && height >= 28) return "full";
  if (width >= 42 && height >= 15) return "compact";
  return "minimal";
}

export function tuiOnboardingActionForKey(key: TuiOnboardingKey): TuiOnboardingAction {
  if (key.ctrl || key.meta) return null;
  const name = key.name.toLowerCase();
  if (name === " " || name === "space" || name === "return" || name === "enter" || name === "right" || name === "pagedown") return "next";
  if (name === "backspace" || name === "left" || name === "pageup") return "back";
  if (name === "escape" || name === "s") return "skip";
  return null;
}

export function navigateTuiOnboarding(
  pageIndex: number,
  action: Exclude<TuiOnboardingAction, null>,
  pageCount = tuiOnboardingPages().length,
): TuiOnboardingNavigation {
  const lastIndex = Math.max(0, pageCount - 1);
  const current = Math.min(lastIndex, Math.max(0, Math.floor(pageIndex)));
  if (action === "skip") return { pageIndex: current, outcome: "skipped" };
  if (action === "back") return { pageIndex: Math.max(0, current - 1), outcome: "active" };
  if (current >= lastIndex) return { pageIndex: lastIndex, outcome: "completed" };
  return { pageIndex: current + 1, outcome: "active" };
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
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function resetTuiOnboarding(cwd: string): Promise<void> {
  await rm(onboardingStatePath(cwd), { force: true });
}

/** First useful launch only: a saved session proves the shell has already been used. */
export function shouldShowTuiOnboarding(
  state: TuiOnboardingState,
  options: TuiOnboardingOptions = {},
): boolean {
  if (options.hasSavedSession) return false;
  if (options.version && state.lastSeenVersion === options.version) return false;
  return !state.completedAt;
}

/** Compact transcript summary retained for setup completion and non-tour surfaces. */
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
