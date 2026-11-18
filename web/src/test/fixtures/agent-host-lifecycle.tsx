import { expect, mock, spyOn } from "bun:test";
import { useEffect } from "react";
import { useAgentHostRefs, type AgentHostRefs } from "../../hooks/agent/host-refs";
import { DEFAULT_MODEL } from "../../hooks/keating-stream";
import { SessionSnapshotTracker } from "../../hooks/session-switch";
import { FlueConversation } from "../../keating/flue/conversation";
import { DEFAULT_WEB_SPEECH_SETTINGS } from "../../keating/speech";
import { createReactMountHarness } from "../helpers/react-mount";

// Vite supplies this static worker URL. No worker or model runs in this lifecycle test.
mock.module("virtual:keating-flue-runtime", () => ({ default: "/unused-runtime.js" }));
const { useAgentSessionLifecycle } = await import("../../hooks/agent/useAgentSessionLifecycle");

async function checkHostLifecycle() {
  const agent = new FlueConversation({
    initialState: { model: DEFAULT_MODEL },
    streamFn: () => { throw new Error("This lifecycle test must not generate a reply."); },
  }, "/unused-runtime.js");
  const dispose = spyOn(agent, "dispose");
  const cleanup = { panel: mock(), analytics: mock(), persistence: mock() };
  const renders: AgentHostRefs[] = [];
  function ChatHost({ courseId, speechEnabled }: { courseId: string; speechEnabled: boolean }) {
    const course = { activeCourseId: courseId };
    const refs = useAgentHostRefs(course, speechEnabled);
    const { subscriptions } = useAgentSessionLifecycle({
      refs, courseContext: course, speechSettings: DEFAULT_WEB_SPEECH_SETTINGS,
      persistence: {
        saveSessionSnapshot: async () => {}, endLearnerSession() {}, sessionSnapshots: new SessionSnapshotTracker(),
        learnerBookkeepingRef: { current: Promise.resolve() }, persistCurrentSnapshotRef: { current: async () => {} },
      },
      posthog: { capture: () => undefined }, toolOptions: () => ({}),
      applyThinkingLevel() {}, selectModel() {}, conversationRuntime: () => null, maybeGenerateAlternativeResponse: async () => {},
      setTeachingAdjustment() {}, openModelSelector() {}, openImageModelSelector() {}, forkSessionRef: { current: async () => {} },
    });
    useEffect(() => {
      refs.agentRef.current = agent;
      Object.assign(subscriptions, cleanup);
    }, [subscriptions]);
    renders.push(refs);
    return null;
  }

  const view = createReactMountHarness();
  try {
    await view.render(<ChatHost courseId="first" speechEnabled={false} />);
    await view.render(<ChatHost courseId="second" speechEnabled />);
    expect(renders).toHaveLength(2);
    expect(renders[1]).toBe(renders[0]);
    expect(renders[0]!.courseContextRef.current?.activeCourseId).toBe("second");
    expect(renders[0]!.speechEnabledRef.current).toBe(true);
    expect(renders[0]!.agentRef.current).toBe(agent);
    for (const unsubscribe of Object.values(cleanup)) expect(unsubscribe).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
  for (const unsubscribe of Object.values(cleanup)) expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(dispose).toHaveBeenCalledTimes(1);
}

await checkHostLifecycle();
