import { describe, expect, test } from "bun:test";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import { roomSchema, type Room, type RoomOperationInput } from "../rooms/contracts";
import { applyRoomOperation, projectRoomForViewer } from "../rooms/operations";
import { buildFacilitatorContext, OFFER_PRIVATE_FORK_TOOL, parseFacilitatorDecision, planFacilitatorTurn, previewFromPartial } from "../rooms/facilitation";
import { runFacilitatorTurn, type FacilitatorTurnInput } from "../rooms/facilitator-turn";
import { learningMessageId, learningMessageSource, resolveLearningSource } from "../keating/learning-intelligence/source-navigation";
import { learningSourceHash } from "@keating/learner-contracts";

const TIME = "2026-10-24T12:00:00.000Z";
const NOW = Date.parse(TIME);
const MODEL: Model<Api> = {
  id: "private-fork-test", name: "Configured test model", api: "openai-completions", provider: "test",
  baseUrl: "https://model.invalid", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const proposal = { learnerAccountId: "maya", sourceMessageId: "message_maya", selectedText: "kinetic energy" };
const call = (argumentsValue: unknown = proposal, name = OFFER_PRIVATE_FORK_TOOL) => ({ type: "toolCall" as const, id: "call_private", name, arguments: argumentsValue as Record<string, unknown> });
function final(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant", content, api: MODEL.api, provider: MODEL.provider, model: MODEL.id, stopReason: "toolUse", timestamp: NOW,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}
function harness(review = false, body = "Where does the kinetic energy go?") {
  let current: Room = roomSchema.parse({
    schemaVersion: 1, id: "room_private", title: "Energy", hostAccountId: "host", createdAt: TIME, updatedAt: TIME, revision: 0,
    settings: { replyReview: review ? "teacher-approves" : "off" },
    members: [
      { accountId: "host", displayName: "Teacher Rowan", role: "host", joinedAt: TIME },
      { accountId: "maya", displayName: "Maya", role: "learner", joinedAt: TIME },
      { accountId: "leo", displayName: "Leo", role: "learner", joinedAt: TIME },
    ],
    turn: { status: "idle", throughSeq: 0, consideredSeq: 0 },
  });
  let id = 0;
  const operations: RoomOperationInput[] = [];
  const update = (account: string, input: RoomOperationInput) => {
    current = applyRoomOperation(current, account, { ...input, id: `op_${++id}`, roomId: current.id }, TIME).room;
    return projectRoomForViewer(current, account, { now: NOW });
  };
  update("host", { type: "facilitator.claim", facilitatorId: "browser_host", modelLabel: MODEL.name, takeOver: false });
  update("maya", { type: "message.post", messageId: "message_maya", body });
  const plan = planFacilitatorTurn(projectRoomForViewer(current, "host", { now: NOW }), NOW);
  if (!plan.run) throw new Error("Fixture must plan a turn");
  const input: FacilitatorTurnInput = { facilitatorId: "browser_host", plan, model: MODEL, modelLabel: MODEL.name, persona: "Teach through questions.", presentAccountIds: ["maya"] };
  return {
    input, update, operations,
    get room() { return current; },
    snapshot: (account = "host") => projectRoomForViewer(current, account, { now: NOW }),
    apply: async (operation: RoomOperationInput) => { operations.push(operation); return update("host", operation); },
  };
}

describe("model private-fork decisions", () => {
  test("provides exact source and recipient identifiers, without importing offers into model context", () => {
    const h = harness();
    const context = buildFacilitatorContext({ snapshot: h.snapshot(), persona: "Teach.", throughSeq: h.input.plan.throughSeq, trigger: "conversation", now: NOW });
    expect(context.tools?.map(tool => tool.name)).toContain(OFFER_PRIVATE_FORK_TOOL);
    expect(context.systemPrompt).toContain('accountId="maya"');
    expect(JSON.stringify(context.messages)).toContain('sourceMessageId=\\"message_maya\\"');
    expect(context.systemPrompt).toContain("They decide whether to open it");
    expect(context.systemPrompt).toContain("Teacher review, when enabled, also holds these offers.");
  });

  test("decodes an exact private proposal and discards unrelated generated fields", () => {
    expect(parseFacilitatorDecision({ content: [call({ ...proposal, privateText: "Never copy this generated text" })] }))
      .toEqual({ kind: "private-fork", proposal });
  });

  test.each([
    ["missing fields", {}], ["empty recipient", { ...proposal, learnerAccountId: "" }],
    ["invalid source id", { ...proposal, sourceMessageId: "../other" }],
    ["blank quote", { ...proposal, selectedText: "   " }],
    ["oversized quote", { ...proposal, selectedText: "x".repeat(8001) }],
  ])("malformed private proposals do not fall back to public prose: %s", (_label, invalid) => {
    expect(parseFacilitatorDecision({ content: [{ type: "text", text: "Do not announce this" }, call(invalid)] }))
      .toEqual({ kind: "pass" });
  });

  test("mixed private/public and duplicate tool calls stay silent", () => {
    const publicCall = call({ content: "Public announcement" }, "send_message");
    expect(parseFacilitatorDecision({ content: [publicCall, call()] })).toEqual({ kind: "pass" });
    expect(parseFacilitatorDecision({ content: [call(), publicCall] })).toEqual({ kind: "pass" });
    expect(parseFacilitatorDecision({ content: [call(), call()] })).toEqual({ kind: "pass" });
    expect(previewFromPartial({ content: [publicCall, call()] })).toBe("");
  });

  test("only explicit public messages can stream into the room", () => {
    expect(previewFromPartial({ content: [{ type: "text", text: "Thinking of offering Maya private help" }] })).toBe("");
    expect(previewFromPartial({ content: [call()] })).toBe("");
    expect(previewFromPartial({ content: [call({ content: "A public question" }, "send_message")] })).toBe("A public question");
    expect(parseFacilitatorDecision({ content: [{ type: "text", text: "A final public reply" }] }))
      .toEqual({ kind: "speak", content: "A final public reply", addressedTo: [] });
  });

  test("actual turn runner offers privately without a public message or preview", async () => {
    const h = harness();
    const previews: string[] = [];
    let received: Context | undefined;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "text_delta", contentIndex: 0, delta: "thinking", partial: final([{ type: "text", text: "Thinking of private help" }]) });
    stream.push({ type: "toolcall_delta", contentIndex: 0, delta: "{}", partial: final([call()]) });
    stream.end(final([call()]));
    const result = await runFacilitatorTurn(h.input, { apply: h.apply, newTurnId: () => "turn_private", stream: (_model, context) => { received = context; return stream; }, onPreview: (_turn, text) => previews.push(text) });
    expect(result.status).toBe("completed");
    expect(received?.tools?.map(tool => tool.name)).toContain(OFFER_PRIVATE_FORK_TOOL);
    expect(h.operations.at(-1)).toMatchObject({ type: "turn.complete", outcome: "offered-private", privateFork: proposal });
    expect(h.room.messages.filter(message => message.kind === "keating")).toHaveLength(0);
    expect(previews).toEqual([]);
    expect(h.snapshot("maya").room.privateForkOffers).toHaveLength(1);
    expect(h.snapshot("host").room.privateForkOffers).toEqual([]);
    expect(h.snapshot("leo").room.privateForkOffers).toEqual([]);
  });

  test("an apparent public partial followed by a private tool never leaves the facilitating browser", async () => {
    const h = harness();
    const previews: string[] = [];
    const publicCall = call({ content: "Maya needs private remedial help." }, "send_message");
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "toolcall_delta", contentIndex: 0, delta: "{}", partial: final([publicCall]) });
    stream.end(final([publicCall, call()]));
    const result = await runFacilitatorTurn(h.input, {
      apply: h.apply, newTurnId: () => "turn_mixed", stream: () => stream,
      onPreview: (_turn, text) => previews.push(text),
    });
    expect(result.status).toBe("completed");
    expect(previews).toEqual([]);
    expect(h.room.messages.some(message => message.body.includes("remedial"))).toBe(false);
    expect(h.room.privateForkOffers).toEqual([]);
    expect(h.operations.at(-1)).toMatchObject({ type: "turn.complete", outcome: "passed" });
  });

  test("the model sees and can select the original whitespace and Unicode source", async () => {
    const body = "first  \n\nsecond 🧠";
    const h = harness(false, body);
    const selection = { learnerAccountId: "maya", sourceMessageId: "message_maya", selectedText: body, start: 0, end: body.length };
    let context: Context | undefined;
    const stream = createAssistantMessageEventStream(); stream.end(final([call(selection)]));
    const result = await runFacilitatorTurn(h.input, { apply: h.apply, newTurnId: () => "turn_whitespace", stream: (_model, received) => { context = received; return stream; } });
    expect(context?.messages[0]?.content).toContain(JSON.stringify(body));
    expect(result.status).toBe("completed");
    expect(h.snapshot("maya").room.privateForkOffers[0]).toMatchObject(selection);
  });

  test("teacher review holds a model offer, then delivers only to the addressed learner", async () => {
    const h = harness(true);
    const stream = createAssistantMessageEventStream(); stream.end(final([call()]));
    expect((await runFacilitatorTurn(h.input, { apply: h.apply, newTurnId: () => "turn_review", stream: () => stream })).status).toBe("completed");
    expect(h.snapshot("maya").room.privateForkOffers).toEqual([]);
    const draft = h.room.drafts.find(draft => draft.status === "pending");
    expect(draft?.privateFork).toMatchObject(proposal);
    expect(draft?.privateFork).toMatchObject({ start: 15, end: 29 });
    h.update("host", { type: "draft.resolve", draftId: draft!.id, action: "approve" });
    expect(h.snapshot("maya").room.privateForkOffers).toHaveLength(1);
    expect(h.snapshot("leo").room.privateForkOffers).toEqual([]);
    expect(h.room.messages.filter(message => message.kind === "keating")).toHaveLength(0);
  });

  test("a server-refused model source frees its current turn", async () => {
    const h = harness();
    const stream = createAssistantMessageEventStream(); stream.end(final([call({ ...proposal, sourceMessageId: "missing_message" })]));
    const result = await runFacilitatorTurn(h.input, { apply: h.apply, newTurnId: () => "turn_bad_source", stream: () => stream });
    expect(result.status).toBe("failed");
    expect(h.room.turn.status).toBe("idle");
    expect(h.room.privateForkOffers).toEqual([]);
    expect(h.operations.at(-1)).toMatchObject({ type: "turn.complete", outcome: "failed" });
  });
});

test("imported peer statements are not learning evidence after persistence, while the learner's own question is", () => {
  const text = "Leo (learner): I divided by four.";
  const source = { role: "user", timestamp: NOW, content: text, keatingPrivateFork: { version: 1, kind: "imported-context", source: { kind: "room", roomId: "room_private", sourceMessageId: "message_maya" } } };
  const stored: unknown = JSON.parse(JSON.stringify(source));
  expect(learningMessageSource("private_chat", stored, 0)).toBeNull();
  expect(resolveLearningSource({ sessionId: "private_chat", messageId: learningMessageId(stored, 0), quote: text, start: 0, end: text.length, sourceHash: learningSourceHash(text) }, { id: "private_chat", messages: [stored] })).toBeNull();
  const learner = { role: "user", timestamp: NOW + 1, content: "Why would dividing by four preserve the ratio?" };
  expect(learningMessageSource("private_chat", learner, 1)?.text).toBe(learner.content);
});
