import type { Agent } from "@earendil-works/pi-agent-core";
import { createAnimationArgAccumulator, emitAnimationProgress } from "../keating/tool-arg-stream";

interface AgentInterfaceLike {
  requestUpdate?: () => unknown;
}
interface AgentPanelLike {
  agentInterface?: AgentInterfaceLike;
}

// The pi-agent-core Agent pushes messages in-place (same array reference),
// so Lit's @property({ type: Array }) never detects the change. We replace the
// array reference on message_end/agent_end so message-list re-renders.
//
// Separately, Agent#finishRun() — which clears `state.isStreaming` — runs in
// the `finally` block of `runWithLifecycle`, *after* `agent_end` listeners
// fire. AgentInterface's own `agent_end` handler calls `requestUpdate()` while
// `isStreaming` is still true, so the MessageEditor renders the Abort button
// and never re-renders. We force a follow-up render once `waitForIdle()`
// resolves (post-finishRun), at which point `isStreaming` is false and the
// Send button comes back.
export function subscribeAgentEvents(agent: Agent, panel: AgentPanelLike) {
  // `animate` writes its HTML as a tool argument, so the authored source is
  // available token by token. Accumulate it and publish partial renders the
  // same way image generation publishes partial frames.
  const animationArgs = createAnimationArgAccumulator();

  return agent.subscribe((ev) => {
    if (ev.type === "message_end" || ev.type === "agent_end" || ev.type === "message_update" || ev.type === "message_start") {
      const msgs = agent.state.messages;
      agent.state.messages = [...msgs];
    }

    if (ev.type === "message_update") {
      const streamEvent = (ev as any).assistantMessageEvent;
      const contentIndex = streamEvent?.contentIndex;
      if (typeof contentIndex === "number") {
        const part = streamEvent.partial?.content?.[contentIndex];
        const callId: string = part?.id ?? `call-${contentIndex}`;
        if (streamEvent.type === "toolcall_start") {
          animationArgs.start(contentIndex, part?.name ?? "");
        } else if (streamEvent.type === "toolcall_delta") {
          const html = animationArgs.delta(contentIndex, streamEvent.delta ?? "", part?.name);
          if (html) {
            emitAnimationProgress({ callId, topic: animationArgs.topic(contentIndex), html, status: "streaming" });
          }
        } else if (streamEvent.type === "toolcall_end") {
          emitAnimationProgress({ callId, topic: animationArgs.topic(contentIndex), html: "", status: "done" });
          animationArgs.end(contentIndex);
        }
      }
    }

    if (ev.type === "agent_end") animationArgs.clear();
    if (ev.type === "agent_end") {
      agent.waitForIdle().then(() => panel.agentInterface?.requestUpdate?.());
    }
    if (import.meta.env?.DEV) {
      const summary = ev.type === "message_end" || ev.type === "message_start" || ev.type === "message_update"
        ? `${ev.type} role=${(ev as any).message?.role}`
        : ev.type;
      console.log(`[keating:agent] ${summary} (messages=${agent.state.messages.length}, streaming=${agent.state.isStreaming})`);
    }
  });
}
