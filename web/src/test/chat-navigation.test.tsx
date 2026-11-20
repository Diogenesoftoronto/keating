import { expect, test } from "bun:test";
import { ChatHeader, type ChatHeaderProps } from "../pages/chat/ChatHeader";
import { moveMenuFocus, shareMenuDetail } from "../pages/chat/ChatActionsMenu";
import { renderWithRouter } from "./course-render";

const noop = () => {};
const props: ChatHeaderProps = {
  modelLabel: "Selected tutor", isPending: false, activeSessionId: "calculus", mobileSidebarOpen: false,
  speechEnabled: false, canvasEnabled: true, artifactBrowserOpen: false, shareState: "idle",
  toggleMobileSidebar: noop, openModelSelector: noop, openSettings: noop, toggleArtifactBrowser: noop,
  newSession: noop, handleShare: async () => {}, confirmShare: async () => {}, toggleSpeech: noop, onOpenNodePod: noop,
};

async function asPhone<T>(run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: true }), location: { hostname: "localhost" } } });
  try { return await run(); } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("desktop header keeps review and the selected model, and drops the sources picker", async () => {
  const html = await renderWithRouter(<ChatHeader {...props} />);
  expect(html).toContain("Model selected");
  expect(html).toContain('aria-label="Change model. Current model: Selected tutor"');
  expect(html).toContain('href="/review/sessions/calculus"');
  expect(html).not.toContain("Materials · 0");
  expect(html).not.toContain("knowledge-sources-button");
  expect(html).not.toContain("Choose knowledge sources");
});

test("header shows Share, the light/dark control and More at the top of the chat bar", async () => {
  const html = await renderWithRouter(<ChatHeader {...props} />);
  expect(html).toContain('aria-label="Share session"');
  expect(html).toMatch(/aria-label="Switch to (dark|light) mode"/);
  expect(html).toContain('aria-label="More menu"');
  expect(html).toContain('aria-expanded="false"');
});

test("Share is disabled while a link is being created and while a reply is pending", async () => {
  const sharing = await renderWithRouter(<ChatHeader {...props} shareState="sharing" />);
  expect(sharing).toContain('aria-label="Share session, creating link"');
  expect(sharing).toMatch(/<button[^>]*aria-label="Share session, creating link"[^>]*disabled/);
  const pending = await renderWithRouter(<ChatHeader {...props} isPending />);
  expect(pending).toMatch(/<button[^>]*aria-label="Share session"[^>]*disabled/);
});

test("thinking level is named in the desktop trigger's label and shown after the model on phones", async () => {
  const desktop = await renderWithRouter(<ChatHeader {...props} modelDetail="Thinking: High" />);
  expect(desktop).toContain('aria-label="Change model. Current model: Selected tutor · Thinking: High"');
  expect(desktop).toContain('title="Model: Selected tutor · Thinking: High"');
  const phone = await asPhone(() => renderWithRouter(<ChatHeader {...props} modelDetail="Thinking: High" />));
  expect(phone).toContain("<span>Selected tutor · Thinking: High</span>");
});

test("on phones the title block is the model trigger and More stays visible", async () => {
  const html = await asPhone(() => renderWithRouter(<ChatHeader {...props} />));
  expect(html).toContain('class="ch-title ch-title-model"');
  expect(html).toContain('aria-label="Change model. Current model: Selected tutor"');
  expect(html).toContain('aria-label="More menu"');
  expect(html).toContain('aria-label="Open materials"');
  expect(html).toContain('aria-label="Share session"');
  expect(html).not.toContain('aria-label="Review session"');
  expect(html).not.toContain("knowledge-sources-button");
});

test("share menu line says what the link is and how far it got", () => {
  expect(shareMenuDetail("idle", false)).toBe("Read-only link · you confirm first");
  expect(shareMenuDetail("idle", true)).toBe("Local link · stays on this device");
  expect(shareMenuDetail("sharing", false)).toBe("Creating link…");
  expect(shareMenuDetail("ready", false)).toBe("Link ready to copy");
});

test("arrow keys, Home and End move through menu entries and wrap", () => {
  const items = ["a", "b", "c"].map(id => ({ id }) as unknown as HTMLElement);
  expect(moveMenuFocus(items, items[0]!, "ArrowDown")).toBe(items[1]);
  expect(moveMenuFocus(items, items[2]!, "ArrowDown")).toBe(items[0]);
  expect(moveMenuFocus(items, items[0]!, "ArrowUp")).toBe(items[2]);
  expect(moveMenuFocus(items, null, "ArrowDown")).toBe(items[0]);
  expect(moveMenuFocus(items, items[1]!, "Home")).toBe(items[0]);
  expect(moveMenuFocus(items, items[1]!, "End")).toBe(items[2]);
  expect(moveMenuFocus(items, items[1]!, "Tab")).toBeUndefined();
  expect(moveMenuFocus([], null, "ArrowDown")).toBeUndefined();
});
