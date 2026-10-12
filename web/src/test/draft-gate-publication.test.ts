import { expect, test } from "bun:test";
import { createFlueClient } from "@flue/sdk";
import { createAssistantMessageEventStream, fauxProvider, type AssistantMessage, type Model, type Api } from "@earendil-works/pi-ai";
import type { JudgementCaller, JudgementAnswer } from "@keating/learner-contracts";
import { init, setProvider, useModel } from "../../../spikes/flue-host/node_modules/@flue/runtime/dist/index.mjs";
import { start } from "../../../spikes/flue-host/node_modules/@flue/runtime/dist/node/index.mjs";
import { createAgentRouter } from "../../../spikes/flue-host/node_modules/@flue/runtime/dist/routing.mjs";
import { withTeachingDraftGate } from "../keating/judgement/draft-gate";
import { shouldRenderFlueMessage } from "../components/assistant-chat-messages";

test("approved teaching text survives the real Flue native projection without exposing private drafts", async () => {
  const providerName = `draft-publication-${crypto.randomUUID()}`;
  const base = fauxProvider({ provider: providerName, models: [{ id: "teacher", name: "Publication fixture", reasoning: false, input: ["text"], contextWindow: 32_000, maxTokens: 4096 }] }).provider;
  const model = base.getModels()[0] as Model<Api>;
  let attempts = 0;
  let doneOnly = false;
  const judge: JudgementCaller = async request => {
    const reply = (request.state as { reply?: { text: string } }).reply;
    const answers: Record<string, JudgementAnswer> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type === "choice") {
        const choice = id === "draft_reasoning" ? "high" : id === "draft_standard" ? "concise" : Object.keys(question.criteria).find(key => key !== "no_match")!;
        answers[id] = { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === choice)])) };
      } else if (question.type === "noul") {
        answers[id] = { type: "noul", noul: id.startsWith("quality_") ? 1 : reply ? Number(id === "identity_invented" && reply.text.includes("PRIVATE REJECTED")) : Number(["direct_answer_requested", "learning_task"].includes(id)) };
      }
    }
    return { ok: true, response: { backend: { backend: "fixture", model: "judge", calibrationSha256: null }, answers } };
  };
  const gated = withTeachingDraftGate(() => {
    const text = ++attempts === 1 ? "PRIVATE REJECTED draft" : "Four factorial is twenty-four.";
    const message: AssistantMessage = { role: "assistant", api: model.api, model: model.id, provider: model.provider, timestamp: Date.now(), stopReason: "stop", content: [{ type: "thinking", thinking: "PRIVATE REASONING" }, { type: "text", text }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "text_delta", contentIndex: 1, delta: "PRIVATE STREAM FRAGMENT", partial: message });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  }, { sessionId: providerName, basePrompt: () => "Teach accurately.", makeCaller: () => judge, maxAttempts: 2 });
  const stream: typeof base.stream = (_model, _context, options) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      const reviewed = await gated(model, { systemPrompt: "Teach accurately.", messages: [{ role: "user", content: "What is four factorial?", timestamp: 1 }], tools: [] }, { signal: options?.signal });
      for await (const event of reviewed) {
        if (!doneOnly || event.type === "done" || event.type === "error") output.push(event);
      }
      output.end(await reviewed.result());
    })();
    return output;
  };
  // Browser and Node host install different Pi transcript versions. This
  // fixture deliberately supplies browser-owned messages across that boundary.
  const provider = { ...base, stream, streamSimple: stream } as unknown as Parameters<typeof setProvider>[0];
  setProvider(provider);
  function PublicationTeacher() { useModel(`${providerName}/teacher`, { compaction: false }); return "Teach accurately."; }
  PublicationTeacher.agentName = providerName;
  const runtime = await start({ agents: [PublicationTeacher], providers: [provider] });
  try {
    const teacher = init(PublicationTeacher, { id: "publication" });
    await teacher.read(await teacher.dispatch("What is four factorial?"));
    const router = createAgentRouter(PublicationTeacher);
    const localFetch = ((input, options) => router.request(input, options)) as typeof fetch;
    const client = createFlueClient({ url: "http://fixture.test/publication", fetch: localFetch });
    const native = await client.history();
    const visible = native.messages.filter(shouldRenderFlueMessage);
    const text = visible.flatMap(message => message.parts).filter(part => part.type === "text").map(part => part.text).join("\n");
    expect(attempts).toBe(2);
    expect(text).toContain("Four factorial is twenty-four.");
    expect(visible.some(message => message.role === "assistant")).toBe(true);
    expect(JSON.stringify(native)).not.toContain("PRIVATE");
    // Reproduce the previous publication contract through the same native
    // runtime: its terminal message retains text, but no text blocks survive.
    doneOnly = true;
    attempts = 0;
    const previous = init(PublicationTeacher, { id: "done-only" });
    const reply = await previous.read(await previous.dispatch("What is four factorial?"));
    const previousClient = createFlueClient({ url: "http://fixture.test/done-only", fetch: localFetch });
    const previousNative = await previousClient.history();
    expect(reply.text).toBe("");
    expect(previousNative.messages.filter(shouldRenderFlueMessage).some(message => message.role === "assistant")).toBe(false);
  } finally { await runtime.stop(); }
}, 30_000);
