/**
 * Renderable tree for the OpenTUI host. `createTuiShell` builds and mounts the
 * header, onboarding, splash, transcript workspace, composer and status line
 * from a theme; it owns construction only, never behaviour or state.
 */
import {
  BoxRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
  type Renderable,
} from "@opentui/core";
import { EMPTY_HEADER_STATE, headerText } from "../view-model.js";
import {
  keatingLogoFrame,
  keatingObjectFrame,
  keatingWordmarkHeight,
} from "../logo.js";
import { tryCreateThreeLogo } from "../three-logo.js";
import { SacredTranscriptRenderable } from "../sacred-transcript.js";
import { markdownSyntaxStyle, type TuiTheme } from "./theme.js";

export interface TuiShell {
  shell: BoxRenderable;
  header: TextRenderable;
  onboarding: BoxRenderable;
  onboardingObject: TextRenderable;
  onboardingCopy: TextRenderable;
  onboardingProgress: TextRenderable;
  splash: BoxRenderable;
  logo: TextRenderable;
  splashHint: TextRenderable;
  indicator: TextRenderable;
  status: TextRenderable;
  workspace: BoxRenderable;
  scroll: ScrollBoxRenderable;
  transcript: SacredTranscriptRenderable;
  activityRail: BoxRenderable;
  activity: TextRenderable;
  inputFrame: BoxRenderable;
  inputPrompt: TextRenderable;
  input: InputRenderable;
  threeLogo: Renderable | null;
}

export function currentSidebarWidth(terminalWidth: number): number {
  if (terminalWidth >= 140) return 34;
  if (terminalWidth >= 112) return 30;
  return 24;
}

export function terminalCanShowSidebar(terminalWidth: number, terminalHeight: number): boolean {
  return terminalWidth >= 88 && terminalHeight >= 22;
}

/** Build every renderable, wire the parent/child tree, and mount it on `renderer.root`. */
export async function createTuiShell(renderer: CliRenderer, theme: TuiTheme): Promise<TuiShell> {
  const { profile, surfaceColor, customBorderChars, textColor, mutedColor, accentColor, borderColor } = theme;
  const ascii = profile.design.glyphMode === "ascii";

  const shell = new BoxRenderable(renderer, {
    id: "keating-open-tui",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    gap: 0,
    ...(surfaceColor ? { backgroundColor: surfaceColor } : {}),
  });
  const header = new TextRenderable(renderer, {
    id: "keating-open-tui-header",
    content: headerText(EMPTY_HEADER_STATE, profile),
    fg: mutedColor,
    height: 1,
    width: "100%",
    marginBottom: 1,
  });
  const onboarding = new BoxRenderable(renderer, {
    id: "keating-open-tui-onboarding",
    flexGrow: 1,
    width: "100%",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 1,
    paddingBottom: 1,
    gap: 1,
    visible: false,
  });
  const onboardingObject = new TextRenderable(renderer, {
    id: "keating-open-tui-onboarding-object",
    content: keatingObjectFrame(0, profile.design.glyphMode),
    fg: accentColor,
    width: 48,
    height: 10,
  });
  const onboardingCopy = new TextRenderable(renderer, {
    id: "keating-open-tui-onboarding-copy",
    content: "",
    fg: textColor,
    width: "82%",
    flexGrow: 1,
  });
  const onboardingProgress = new TextRenderable(renderer, {
    id: "keating-open-tui-onboarding-progress",
    content: "",
    fg: mutedColor,
    width: 72,
    height: 2,
  });
  // Welcome state: the brand mark owns the empty workspace, then steps aside.
  const splash = new BoxRenderable(renderer, {
    id: "keating-open-tui-splash",
    flexGrow: 1,
    width: "100%",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 1,
  });
  const logo = new TextRenderable(renderer, {
    id: "keating-open-tui-logo",
    content: keatingLogoFrame(0, profile.design.glyphMode),
    fg: accentColor,
    height: keatingWordmarkHeight(profile.design.glyphMode),
  });
  const splashHint = new TextRenderable(renderer, {
    id: "keating-open-tui-splash-hint",
    content: "",
    fg: mutedColor,
    height: 2,
  });
  const indicator = new TextRenderable(renderer, {
    id: "keating-open-tui-indicator",
    content: "",
    fg: accentColor,
    height: 1,
    width: "100%",
    visible: false,
  });
  const status = new TextRenderable(renderer, {
    id: "keating-open-tui-status",
    content: "Ctrl+P commands  ·  Ctrl+S sessions  ·  Ctrl+T thinking  ·  Ctrl+N new  ·  Ctrl+X stop",
    fg: mutedColor,
    height: 1,
    width: "100%",
  });
  const workspace = new BoxRenderable(renderer, {
    id: "keating-open-tui-workspace",
    flexGrow: 1,
    width: "100%",
    flexDirection: "row",
    gap: 1,
  });
  const scroll = new ScrollBoxRenderable(renderer, {
    id: "keating-open-tui-transcript-scroll",
    flexGrow: 1,
    border: false,
    paddingLeft: 1,
    paddingRight: 1,
    scrollY: true,
    stickyScroll: true,
    stickyStart: "bottom",
    // A short conversation sits on the composer, the way it is read and
    // written, instead of hanging from the header over an empty pane.
    contentOptions: { justifyContent: "flex-end" },
    scrollbarOptions: ascii ? { visible: false } : undefined,
  });
  const transcript = new SacredTranscriptRenderable(renderer, {
    id: "keating-open-tui-transcript",
    entries: [],
    streaming: null,
    profile,
    width: Math.max(20, renderer.terminalWidth - 6),
    syntaxStyle: markdownSyntaxStyle(profile),
    emptyText: "Ask a question, continue a learning goal, or type /shell for the classic Pi interface.",
    tableOptions: {
      style: "columns",
      widthMode: "full",
      columnFitter: "proportional",
      wrapMode: "word",
      borders: false,
      borderColor,
    },
  });
  const activityRail = new BoxRenderable(renderer, {
    id: "keating-open-tui-activity-rail",
    width: 30,
    height: "100%",
    border: ["left"],
    borderStyle: "single",
    customBorderChars,
    borderColor,
    paddingLeft: 2,
    paddingTop: 1,
  });
  const activity = new TextRenderable(renderer, {
    id: "keating-open-tui-activity",
    content: "SESSION\nnew session\n\nACTIVITY\n· No tool activity yet",
    fg: mutedColor,
    width: "100%",
  });
  const inputFrame = new BoxRenderable(renderer, {
    id: "keating-open-tui-input-frame",
    width: "100%",
    height: 3,
    border: true,
    borderStyle: ascii ? "single" : "rounded",
    customBorderChars,
    borderColor,
    flexDirection: "row",
    paddingLeft: 1,
    paddingRight: 1,
    alignItems: "center",
    gap: 1,
  });
  const inputPrompt = new TextRenderable(renderer, {
    id: "keating-open-tui-input-prompt",
    content: ascii ? ">" : "›",
    fg: accentColor,
    width: 1,
    height: 1,
  });
  const input = new InputRenderable(renderer, {
    id: "keating-open-tui-input",
    flexGrow: 1,
    placeholder: ascii ? "Message Keating..." : "Message Keating…",
    textColor,
    placeholderColor: mutedColor,
    backgroundColor: surfaceColor,
    focusedBackgroundColor: surfaceColor,
    focusedTextColor: textColor,
  });

  scroll.add(transcript);
  activityRail.add(activity);
  workspace.add(scroll);
  workspace.add(activityRail);
  inputFrame.add(inputPrompt);
  inputFrame.add(input);
  onboarding.add(onboardingObject);
  onboarding.add(onboardingCopy);
  onboarding.add(onboardingProgress);
  splash.add(logo);
  splash.add(splashHint);
  shell.add(header);
  shell.add(onboarding);
  shell.add(splash);
  shell.add(workspace);
  shell.add(indicator);
  shell.add(inputFrame);
  shell.add(status);
  renderer.root.add(shell);
  /**
   * The Three.js mark needs a WebGPU device. When there is none the flat
   * wordmark in `logo` already carries the splash, so a null result is silent.
   */
  const threeLogo = await tryCreateThreeLogo(renderer, {
    id: "keating-open-tui-three-logo",
    height: 8,
    edgeColor: profile.design.colors.accent?.truecolor ?? "#e7a04f",
    fillColor: theme.configuredSurfaceColor ?? "#12160f",
  });
  if (threeLogo) splash.add(threeLogo, 0);

  return {
    shell, header, onboarding, onboardingObject, onboardingCopy, onboardingProgress,
    splash, logo, splashHint, indicator, status, workspace, scroll, transcript,
    activityRail, activity, inputFrame, inputPrompt, input, threeLogo,
  };
}
