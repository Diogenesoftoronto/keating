import { normalizeOpenUiComponent } from "../../../../packages/learner-contracts/src/openui-diagnostic-turn";
import { diagnosticConversationId, openUIDiagnosticStore } from "./turn-diagnostics";

/** Read only markers emitted by Keating's committed text and shared-document renderers. */
export function mountedOpenUIComponents(root: Element, expectedTextParts: number): string[] | null {
  if (expectedTextParts < 1) return null;
  const parts = root.querySelectorAll("[data-openui-diagnostic-part]");
  if (parts.length !== expectedTextParts
    || [...parts].some(part => part.getAttribute("data-openui-diagnostic-part") !== "ready")) return null;
  const components = new Set<string>();
  for (const part of parts) {
    const documents = part.querySelectorAll("[data-openui-document] > [data-shared-openui-document][data-openui-diagnostic-nodes]");
    for (const document of documents) {
      for (const kind of (document.getAttribute("data-openui-diagnostic-nodes") ?? "").split(" ")) {
        const component = normalizeOpenUiComponent(kind);
        if (component) components.add(component);
      }
    }
  }
  return [...components].sort();
}

export function observeOpenUIRenderedRow(root: Element, sessionId: string, sourceIds: readonly string[], textParts: number) {
  const conversationId = diagnosticConversationId(sessionId);
  let observer: MutationObserver | undefined;
  let submitted = false;
  const observe = () => {
    try {
      if (!openUIDiagnosticStore.awaitingRender(conversationId, sourceIds)) {
        submitted = false;
        observer?.disconnect();
        observer = undefined;
        return;
      }
      const components = mountedOpenUIComponents(root, textParts);
      if (components !== null) {
        if (!submitted) openUIDiagnosticStore.rendered(conversationId, sourceIds, components);
        submitted = true;
        observer?.disconnect();
        observer = undefined;
      } else if (!observer && typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(observe);
        observer.observe(root, { subtree: true, childList: true, attributes: true,
          attributeFilter: ["data-openui-diagnostic-part", "data-openui-diagnostic-nodes"] });
      }
    } catch { observer?.disconnect(); }
  };
  const unsubscribe = openUIDiagnosticStore.subscribe(observe);
  observe();
  return () => { observer?.disconnect(); unsubscribe(); };
}
