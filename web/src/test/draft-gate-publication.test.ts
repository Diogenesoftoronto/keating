import { expect, test } from "bun:test";
import { createFlueClient } from "@flue/sdk";
import { createAssistantMessageEventStream, fauxProvider, fauxAssistantMessage, fauxText, fauxThinking, type AssistantMessage, type Model, type Api } from "@earendil-works/pi-ai";
import type { JudgementCaller, JudgementAnswer } from "@keating/learner-contracts";
import { init, setProvider, useModel } from "../../../spikes/flue-host/node_modules/@flue/runtime/dist/index.mjs";
import { start } from "../../../spikes/flue-host/node_modules/@flue/runtime/dist/node/index.mjs";
import { createAgentRouter } from "../../../spikes/flue-host/node_modules/@flue/runtime/dist/routing.mjs";
import { withTeachingDraftGate, type TeachingDraftReceipt } from "../keating/judgement/draft-gate";
import type { FlueConversation } from "../keating/flue/conversation";
import { projectThreadMessages } from "../components/AssistantChatPanel";
import { shouldRenderFlueMessage } from "../components/assistant-chat-messages";
import { answerDraftGateReview } from "./helpers/teaching-draft-judge";

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

test.each(["finish", "stop"] as const)("Flue keeps one visible opening and its receipt on %s during a private addition", async mode => {
  const name = `staged-publication-${crypto.randomUUID()}`;
  const query = "Define a square number and give a numeric example.";
  const opening = "A square number is an integer multiplied by itself.";
  const addition = "For example, three times three is nine.";
  const receipts: TeachingDraftReceipt[] = [];
  const stop = new AbortController();
  let stopReason: string | undefined;
  let terminal: AssistantMessage | undefined;
  const fixture = fauxProvider({ provider: name, tokensPerSecond: 0, models: [{ id: "teacher" }] });
  let finishAddition!: () => void;
  const additionAllowed = new Promise<void>(resolve => { finishAddition = resolve; });
  let additionStarted = false;
  fixture.setResponses([
    fauxAssistantMessage([fauxThinking("PRIVATE opening thought"), fauxText(opening)], { timestamp: 1100 }),
    fauxAssistantMessage("PRIVATE REJECTED alternative", { timestamp: 2200 }),
    async (context, options) => {
      additionStarted = true;
      expect(context.tools).toEqual([]);
      expect(options).toMatchObject({ hostedWebSearch: false });
      expect(context.messages.at(-1)?.content).toBe(JSON.stringify({ publishedText: opening }));
      await additionAllowed;
      return fauxAssistantMessage([fauxThinking("PRIVATE continuation thought"), fauxText(addition)], { timestamp: 3300 });
    },
  ]);
  const judge: JudgementCaller = async request => {
    const outcome = answerDraftGateReview(request, { standard: "supported" });
    if (!outcome.ok || !request.questions.requested_part_missing) return outcome;
    const { reply } = request.state as { reply: { text: string } };
    return { ...outcome, response: { ...outcome.response, answers: { ...outcome.response.answers,
      requested_part_missing: { type: "noul", noul: reply.text.includes(addition) ? 0 : 1 } } } };
  };
  const gated = withTeachingDraftGate(fixture.provider.streamSimple, {
    sessionId: name, basePrompt: () => "", makeCaller: () => judge, maxAttempts: 3,
    onReceipt: receipt => receipts.push(receipt),
  });
  const stream: typeof fixture.provider.stream = (_model, _context, options) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      const reviewed = await gated(fixture.getModel() as Model<Api>, { messages: [{ role: "user", content: query, timestamp: 1 }] },
        { signal: options?.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal });
      for await (const event of reviewed) {
        if (event.type === "error" && event.reason === "aborted") stopReason = event.error.errorMessage;
        output.push(event);
      }
      terminal = await reviewed.result();
      output.end(terminal);
    })();
    return output;
  };
  const provider = { ...fixture.provider, stream, streamSimple: stream } as unknown as Parameters<typeof setProvider>[0];
  setProvider(provider);
  function StagedTeacher() { useModel(`${name}/teacher`, { compaction: false }); return "Teach accurately."; }
  StagedTeacher.agentName = name;
  const runtime = await start({ agents: [StagedTeacher], providers: [provider] });
  try {
    const teacher = init(StagedTeacher, { id: "staged" });
    const request = await teacher.dispatch(query);
    const router = createAgentRouter(StagedTeacher);
    const client = createFlueClient({ url: "http://fixture.test/staged", fetch: ((input, options) => router.request(input, options)) as typeof fetch });
    const publicText = (history: Pick<Awaited<ReturnType<typeof client.history>>, "messages">) => history.messages.filter(message => message.role === "assistant")
      .flatMap(message => message.parts).filter(part => part.type === "text").map(part => part.text).join("");
    // The addendum waits until the same live Flue observer used by chat sees the opening.
    const observation = client.observe({ live: "sse" });
    try {
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error("The opening never appeared in the live Flue conversation.")), 4000);
        const inspect = () => {
          const { conversation, error } = observation.getSnapshot();
          if (error) { clearTimeout(deadline); reject(error); }
          else if (conversation && publicText(conversation) === opening) { clearTimeout(deadline); resolve(); }
        };
        observation.subscribe(inspect);
        inspect();
      });
    } finally { observation.close(); }
    expect(additionStarted).toBe(true);
    expect(receipts).toHaveLength(0);
    if (mode === "stop") stop.abort();
    finishAddition();
    const completion = teacher.read(request);
    if (mode === "finish") await completion;
    else await expect(completion).rejects.toThrow();
    const final = await client.history();
    expect(stopReason).toBe(mode === "stop" ? "Response stopped" : undefined);
    expect(publicText(final)).toBe(mode === "stop" ? opening : opening + "\n\n" + addition);
    expect(JSON.stringify(final)).not.toContain("PRIVATE");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.messageTimestamp).toBe(1100);
    expect(receipts[0]!.snapshot.phase).toBe(mode === "stop" ? "cancelled" : "released");
    expect(receipts[0]!.snapshot.selectedAttempt).toBe(mode === "stop" ? 1 : 3);
    if (mode === "stop") {
      const nativeUser = final.messages.find(message => message.role === "user")!;
      const nativeAnswer = final.messages.find(message => message.role === "assistant" && shouldRenderFlueMessage(message))!;
      const olderQuestion = "What is a square number?";
      const originals = [
        { role: "user" as const, content: olderQuestion, timestamp: 10 }, fauxAssistantMessage(opening, { timestamp: 11 }),
        { role: "user" as const, content: query, timestamp: 100 }, terminal!,
      ];
      const prior = [{ ...nativeUser, id: "older-question", parts: [{ type: "text", text: olderQuestion, state: "done" }] },
        { ...nativeAnswer, id: "older-answer" }];
      const agent = { context: { messages: originals }, legacyMessages: [], localMessages: [terminal!],
        getSnapshot: () => ({ conversation: { messages: [...prior, ...final.messages] } }) } as unknown as FlueConversation;
      const rows = projectThreadMessages(agent, originals, false, false, undefined);
      const answers = rows.filter(row => row.role === "assistant");
      expect(answers.map(row => row.id)).toEqual(["older-answer", nativeAnswer.id]);
      expect(answers.map(row => row.status?.type)).toEqual(["complete", "incomplete"]);
      expect(answers[1]!.status).toMatchObject({ reason: "cancelled" });
      expect(answers[1]!.metadata?.custom?.keatingDiagnosticTimestamps).toEqual([1100]);
      expect(answers[1]!.metadata?.custom?.keatingFailedLastTurn).toBe(true);
      const beforeCapture = { ...agent, getSnapshot: () => ({ conversation: { messages: prior } }) } as unknown as FlueConversation;
      const awaiting = projectThreadMessages(beforeCapture, originals, false, false, undefined).filter(row => row.role === "assistant");
      expect(awaiting).toHaveLength(2);
      expect(awaiting.find(row => row.id === "older-answer")?.status?.type).toBe("complete");
      expect(awaiting.find(row => row.id !== "older-answer")?.status).toMatchObject({ reason: "cancelled" });
    }
  } finally { finishAddition(); await runtime.stop(); }
}, 15_000);
