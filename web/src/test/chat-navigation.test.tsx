import { expect, test } from "bun:test";
import { ChatHeader, type ChatHeaderProps } from "../pages/chat/ChatHeader";
import { renderWithRouter } from "./course-render";

const noop = () => {};
const props: ChatHeaderProps = {
  modelLabel: "Selected tutor", isPending: false, activeSessionId: "calculus", mobileSidebarOpen: false,
  speechEnabled: false, canvasEnabled: true, artifactBrowserOpen: false, shareState: "idle",
  toggleMobileSidebar: noop, openModelSelector: noop, openSettings: noop, toggleArtifactBrowser: noop,
  newSession: noop, handleShare: async () => {}, confirmShare: async () => {}, toggleSpeech: noop, onOpenNodePod: noop,
};

test("desktop session header retains review, source count and selected model", async () => {
  const html = await renderWithRouter(<ChatHeader {...props} />);
  expect(html).toContain("Model selected");
  expect(html).toContain("Choose knowledge sources. 0 selected.");
  expect(html).toContain('href="/review/sessions/calculus"');
  expect(html).not.toContain("Materials · 0");
});

test("compact header names the model below the title and keeps materials and More visible", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: true }), location: { hostname: "localhost" } } });
  try {
    const html = await renderWithRouter(<ChatHeader {...props} />);
    expect(html).toContain(" · Socratic");
    expect(html).toContain("Selected tutor");
    expect(html).toContain('aria-label="More menu"');
    expect(html).toContain('aria-label="Open materials"');
    expect(html).not.toContain('aria-label="Review session"');
    expect(html).not.toContain('class="knowledge-sources-button"');
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
