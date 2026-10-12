import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { defineStories, story } from "textbook-sh";
import { keatingDesignContract } from "../src/tui/design-contract.js";
import { createSacredSidebar } from "../src/tui/sacred-sidebar.js";
import { sessions, type FixtureSession } from "./fixtures.js";

export default defineStories({
  title: "Keating/Sidebar",
  component: "createSacredSidebar",
  description: "Production navigation and session tree with authored offline fixtures; activations update only this preview.",
});

// Focus listeners must be removed before child text buffers are torn down.
// Textbook uses recursive destruction when changing stories and closing previews.
class SidebarPreviewRoot extends BoxRenderable {
  disposeSidebar?: () => void;

  private disposeComponent(): void {
    const dispose = this.disposeSidebar;
    this.disposeSidebar = undefined;
    dispose?.();
  }

  override destroyRecursively(): void {
    this.disposeComponent();
    super.destroyRecursively();
  }

  override destroy(): void {
    this.disposeComponent();
    super.destroy();
  }
}

function sidebar(renderer: CliRenderer, options: { empty?: boolean; ascii?: boolean; light?: boolean; narrow?: boolean; sessionFocus?: boolean } = {}) {
  const colors = keatingDesignContract.themes[options.light ? "light" : "dark"].colors;
  const root = new SidebarPreviewRoot(renderer, {
    id: "textbook-sidebar", flexDirection: "row", width: "100%", height: "100%", backgroundColor: colors.surface,
  });
  const content = new BoxRenderable(renderer, { flexDirection: "column", flexGrow: 1, padding: 1, gap: 1 });
  const status = new TextRenderable(renderer, { content: "Preview ready. Select an action or session.", fg: colors.text, wrapMode: "word" });
  content.add(new TextRenderable(renderer, { content: "Offline component preview\n\nArrow keys select. Enter activates.\nTab moves between sidebar lists.\nDrag the handle to resize.", fg: colors.mutedText, wrapMode: "word" }));
  content.add(status);
  const component = createSacredSidebar<FixtureSession>(renderer, {
    id: "textbook-sacred-sidebar", width: options.narrow ? 24 : 34, minWidth: 18, maxWidth: 44,
    glyphMode: options.ascii ? "ascii" : "unicode", surface: colors.surfaceRaised,
    colors: { text: colors.text, muted: colors.mutedText, accent: colors.accent, border: colors.border, focus: colors.focus, selection: colors.accent, onSelection: colors.onAccent },
    identity: { label: "Learner", detail: "local tutor" },
    navigation: [{ id: "new", label: "New lesson", hint: ":n" }, { id: "library", label: "Library", hint: ":l" }, { id: "settings", label: "Settings" }],
    sessions: options.empty ? [] : sessions,
    activity: options.empty ? ["· Nothing yet"] : ["▣ Lesson plan saved", "▣ Worked example", "→ read notes.md"], activityRows: 3,
    onNavigate: (item) => { status.content = `Action activated: ${item.label} (preview only)`; },
    onSessionActivate: (value) => { status.content = `Session activated: ${value.title} (preview only)`; },
    onResizeRequest: (width) => { component.setWidth(width); },
    onFocusEscape: () => { component.focusNavigation(); },
  });
  root.add(component.root);
  root.add(content);
  root.disposeSidebar = () => component.destroy();
  if (options.sessionFocus) component.focusSessions();
  else component.focusNavigation();
  return root;
}

export const SessionTree = story({ name: "Session tree", description: "Interactive actions, forked lesson sessions, recent activity, and resizable sidebar.", render: (renderer) => sidebar(renderer) });
export const Empty = story({ name: "No sessions yet", description: "First-run session state with navigation available.", render: (renderer) => sidebar(renderer, { empty: true }) });
export const FocusedSessions = story({ name: "Session keyboard focus", description: "Session list starts focused; Enter or click shows the activated session in the preview.", render: (renderer) => sidebar(renderer, { sessionFocus: true }) });
export const NarrowAscii = story({ name: "Narrow ASCII sidebar", description: "24-column sidebar with ASCII tree fallback and truncated labels.", render: (renderer) => sidebar(renderer, { narrow: true, ascii: true }) });
export const Light = story({ name: "Light theme", description: "Sidebar and activation feedback on the shared light palette.", render: (renderer) => sidebar(renderer, { light: true }) });
