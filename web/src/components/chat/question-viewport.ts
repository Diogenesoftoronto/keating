import { useCallback, useEffect, useRef } from "react";

const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
const readyPart = '[data-openui-diagnostic-part="ready"]';

/** Follow only a newly published Question in the learner turn that just began. */
export function watchQuestionViewport(viewport: HTMLElement) {
  if (!atBottom(viewport)) return;
  const existingMessages = new Set(Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]"), row => row.dataset.messageId));
  let frame = 0;
  let ended = false;
  let disposed = false;
  let prompt: HTMLElement | null = null;
  let previousTop = viewport.scrollTop;
  let previousHeight = viewport.scrollHeight;
  const observer = new MutationObserver(schedule);
  const input = new AbortController();
  function dispose() {
    disposed = true;
    input.abort();
    observer.disconnect();
    cancelAnimationFrame(frame);
  }
  function reveal() {
    // The default viewport can reach its new bottom a frame after the prompt mounts.
    if (!prompt?.isConnected || !atBottom(viewport)) return;
    const offset = prompt.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    dispose();
    if (offset < 0) viewport.scrollTo({ top: viewport.scrollTop + offset - 12, behavior: "instant" });
  }
  function schedule() {
    if (disposed || frame) return;
    // The thread first applies its normal bottom-follow behavior to the new content.
    frame = requestAnimationFrame(() => {
      frame = 0;
      const parts = Array.from(viewport.querySelectorAll<HTMLElement>(readyPart)).filter(el => {
        const id = el.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
        return id && !existingMessages.has(id);
      });
      for (const part of parts) {
        prompt = part.querySelector<HTMLElement>("fieldset[data-question-kind] > legend");
        if (prompt) { reveal(); return; }
      }
      if (ended && parts.length) dispose();
    });
  }
  observer.observe(viewport, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-openui-diagnostic-part"] });
  const passive = { passive: true, signal: input.signal };
  viewport.addEventListener("wheel", dispose, passive);
  viewport.addEventListener("touchmove", dispose, passive);
  viewport.addEventListener("scroll", () => {
    if (viewport.scrollTop < previousTop && viewport.scrollHeight === previousHeight) dispose();
    else reveal();
    previousTop = viewport.scrollTop;
    previousHeight = viewport.scrollHeight;
  }, passive);
  return { dispose, finish() { ended = true; schedule(); } };
}

export function useQuestionViewport(sessionId: string | undefined, running: boolean) {
  const viewport = useRef<HTMLDivElement>(null);
  const watching = useRef<ReturnType<typeof watchQuestionViewport>>(undefined);
  const followNextQuestion = useCallback(() => {
    watching.current?.dispose();
    watching.current = viewport.current ? watchQuestionViewport(viewport.current) : undefined;
  }, []);
  useEffect(() => () => { watching.current?.dispose(); watching.current = undefined; }, [sessionId]);
  useEffect(() => { if (!running) watching.current?.finish(); }, [running]);
  return { viewport, followNextQuestion };
}
