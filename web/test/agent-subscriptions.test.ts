import { describe, expect, test } from "bun:test";
import { Agent } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { subscribeAgentEvents } from "../src/hooks/agent-subscriptions";

const FAKE_MODEL: Model<Api> = {
  id: "fake",
  name: "fake",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
} as unknown as Model<Api>;

function makeFinalMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    api: FAKE_MODEL.api,
    provider: FAKE_MODEL.provider,
    model: FAKE_MODEL.id,
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function fakeStreamFn(_model: Model<Api>, _ctx: Context, _opts?: SimpleStreamOptions) {
  const stream = createAssistantMessageEventStream();
  const final = makeFinalMessage("ok");
  queueMicrotask(() => {
    stream.push({ type: "start", partial: final });
    stream.push({ type: "done", reason: "stop", message: final });
  });
  return stream;
}

function makeAgent() {
  return new Agent({
    initialState: { model: FAKE_MODEL, messages: [], tools: [] },
    streamFn: fakeStreamFn,
  });
}

describe("Agent lifecycle timing (the upstream contract our fix relies on)", () => {
  test("state.isStreaming is still true during agent_end, then false after waitForIdle", async () => {
    const agent = makeAgent();

    let streamingDuringAgentEnd: boolean | undefined;
    agent.subscribe((ev) => {
      if (ev.type === "agent_end") {
        streamingDuringAgentEnd = agent.state.isStreaming;
      }
    });

    expect(agent.state.isStreaming).toBe(false);
    await agent.prompt("hello");
    await agent.waitForIdle();

    // The bug we patched: AgentInterface re-renders on agent_end while this is true,
    // sees Streaming=true, draws the Square (Abort) button, then never re-renders.
    expect(streamingDuringAgentEnd).toBe(true);
    // After finishRun() runs in the `finally` block, the flag is finally clear.
    expect(agent.state.isStreaming).toBe(false);
  });
});

describe("subscribeAgentEvents", () => {
  test("calls panel.agentInterface.requestUpdate after the run settles, with isStreaming cleared", async () => {
    const agent = makeAgent();

    const updates: { isStreaming: boolean }[] = [];
    const panel = {
      agentInterface: {
        requestUpdate: () => {
          updates.push({ isStreaming: agent.state.isStreaming });
        },
      },
    };

    const unsub = subscribeAgentEvents(agent, panel);
    try {
      await agent.prompt("hello");
      await agent.waitForIdle();
      // waitForIdle resolves inside finishRun; the .then() requestUpdate is
      // queued as a microtask, so flush microtasks before asserting.
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      unsub();
    }

    expect(updates.length).toBeGreaterThanOrEqual(1);
    // The whole point: by the time we requestUpdate, isStreaming must be false
    // so the MessageEditor re-renders with the Send button (not Abort).
    for (const u of updates) {
      expect(u.isStreaming).toBe(false);
    }
  });

  test("replaces messages array reference on message_end so Lit detects the change", async () => {
    const agent = makeAgent();
    const arrayRefs: unknown[] = [];

    // Snapshot agent.state.messages reference inside our own listener that runs
    // *after* subscribeAgentEvents (Set iteration is insertion order).
    const unsubHelper = subscribeAgentEvents(agent, { agentInterface: undefined });
    const unsubProbe = agent.subscribe((ev) => {
      if (ev.type === "message_end") {
        arrayRefs.push(agent.state.messages);
      }
    });

    try {
      await agent.prompt("hello");
      await agent.waitForIdle();
    } finally {
      unsubProbe();
      unsubHelper();
    }

    // We expect at least two message_end events: one for the user prompt and
    // one for the assistant reply. Each should observe a fresh array reference.
    expect(arrayRefs.length).toBeGreaterThanOrEqual(2);
    const unique = new Set(arrayRefs);
    expect(unique.size).toBe(arrayRefs.length);
  });
});
