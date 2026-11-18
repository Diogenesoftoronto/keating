import type { NativePageEvidence } from "../../../../packages/learner-contracts/src/openui-diagnostic-turn";
import { nativeOriginKey } from "./native-page-evidence";
import { diagnosticConversationId, openUIDiagnosticStore } from "./turn-diagnostics";

/** Observe the host's DOM only. The authored sandbox is never read or evaluated here. */
export function observeNativeToolCards(root: HTMLElement, sessionId: string, callId: string, source: string,
  store = openUIDiagnosticStore) {
  const conversation = diagnosticConversationId(sessionId);
  const evidence = new Map<HTMLElement, Partial<NativePageEvidence>>();
  const frames = new Map<Element, HTMLElement>();
  const intersecting = new Map<Element, boolean>();
  let mutation: MutationObserver | undefined;
  let viewport: IntersectionObserver | undefined;
  function inspect() {
    try {
      const row = root.closest<HTMLElement>("[data-learning-message-ids]");
      if (!row || row.dataset.learningSessionId !== sessionId) return;
      for (const host of root.querySelectorAll<HTMLElement>("[data-interactive-page][data-native-page-status]")) {
        const flags = evidence.get(host) ?? { mounted: true };
        evidence.set(host, flags);
        const status = host.dataset.nativePageStatus;
        if (status === "ready") {
          flags.ready = true;
          flags.frameFailed ??= false;
          flags.opened = flags.opened === true || host.getAttribute("role") === "dialog";
          const frame = host.querySelector("iframe");
          if (frame && viewport) {
            if (!frames.has(frame)) { frames.set(frame, host); viewport.observe(frame); }
            const seen = intersecting.get(frame);
            if (seen !== undefined) flags.visible = flags.visible === true || (seen && document.visibilityState === "visible"
              && !host.closest('[hidden], [inert], [aria-hidden="true"]')
              && (typeof frame.checkVisibility !== "function" || frame.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })));
          }
        } else if (status && ["invalid", "oversize", "blocked", "crashed"].includes(status)) {
          flags.frameFailed = true;
          flags.ready ??= false;
          flags.visible ??= false;
          flags.opened ??= false;
        }
        store.nativeObservation(conversation, [nativeOriginKey(source, callId, host.dataset.interactivePage!)], { ...flags });
      }
    } catch { /* A missing or ambiguous source remains unobserved. */ }
  }
  if (typeof IntersectionObserver !== "undefined") viewport = new IntersectionObserver(entries => {
    for (const e of entries) intersecting.set(e.target, e.isIntersecting && e.intersectionRect.width > 0 && e.intersectionRect.height > 0);
    inspect();
  });
  if (typeof MutationObserver !== "undefined") {
    mutation = new MutationObserver(inspect);
    mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-native-page-status", "role"] });
  }
  const stop = store.subscribe(inspect);
  document.addEventListener("visibilitychange", inspect);
  inspect();
  return () => { stop(); mutation?.disconnect(); viewport?.disconnect(); document.removeEventListener("visibilitychange", inspect); };
}
