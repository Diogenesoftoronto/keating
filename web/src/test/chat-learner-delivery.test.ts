import { describe, expect, test } from "bun:test";
import type { AppendMessage } from "@assistant-ui/react";
import {
  canonicalActionReceiptId,
  LearnerDeliveryQueue,
  learnerDeliveryPaused,
  learnerSubmission,
  pauseLearnerDelivery,
  quizSubmissionId,
  transcriptUserTexts,
} from "../components/chat/learner-delivery";
import {
  createQuizConversationHandlers,
  quizReframeText,
  quizRemediationText,
  quizSubmissionText,
  type QuizSubmissionDetail,
} from "../components/chat/quiz-conversation";
import {
  audioCapabilityError,
  makeUserMessageFromAppend,
  prepareAttachmentsForModel,
  userTextMessage,
  visionCapabilityError,
} from "../components/chat/user-message";

const textOf = (message: AppendMessage) => (message.content[0] as { text: string }).text;

const submission = (sessionId: string, receiptId: string, serialized = receiptId) =>
  learnerSubmission({ sessionId, serialized, submissionId: receiptId });

describe("learner delivery queue", () => {
  test("delivers only the active session's turns, oldest first, keeping other sessions queued", () => {
    const queue = new LearnerDeliveryQueue();
    expect(queue.admit(submission("A", "a1"))).toBe("queued");
    expect(queue.admit(submission("B", "b1"))).toBe("queued");
    expect(queue.admit(submission("A", "a2"))).toBe("queued");
    expect(queue.next("B")?.receiptId).toBe("b1");
    expect(queue.next("A")?.receiptId).toBe("a1");
    expect(queue.next("A")?.receiptId).toBe("a2");
    expect(queue.next("A")).toBeUndefined();
    expect(queue.next("C")).toBeUndefined();
  });

  test("one delivery at a time; a submission id is admitted once, even after delivery", async () => {
    const queue = new LearnerDeliveryQueue();
    queue.admit(submission("A", "r1"));
    queue.admit(submission("A", "r2"));
    expect(queue.admit(submission("A", "r1"))).toBe("duplicate");
    const first = queue.next("A")!;
    let release!: () => void;
    const delivering = queue.deliver(first, () => new Promise<boolean>((resolve) => { release = () => resolve(true); }), () => {});
    expect(queue.next("A")).toBeUndefined();
    release();
    expect(await delivering).toBe("delivered");
    expect(queue.admit(submission("A", "r1"))).toBe("duplicate");
    expect(queue.next("A")?.receiptId).toBe("r2");
  });

  test("settles at admission and only once, even when the send also reports success", async () => {
    const queue = new LearnerDeliveryQueue();
    const events: string[] = [];
    await queue.deliver(submission("A", "m"), async (_, onAdmitted) => {
      onAdmitted();
      events.push("reply finished");
      return true;
    }, () => events.push("delivered"));
    expect(events).toEqual(["delivered", "reply finished"]);
  });

  test("a refused send never settles and returns to the front of its session's queue", async () => {
    const queue = new LearnerDeliveryQueue();
    let settled = 0;
    queue.admit(submission("A", "later"));
    expect(await queue.deliver(submission("A", "k"), async () => false, () => settled++)).toBe("refused");
    expect(settled).toBe(0);
    expect(queue.next("A")?.receiptId).toBe("k");
  });

  test("submissions carry their session and a stable, ordered identity", () => {
    const first = learnerSubmission({ sessionId: "A", serialized: "x", now: () => 1000 });
    const second = learnerSubmission({ sessionId: "A", serialized: (identity) => identity.sessionMessageId, now: () => 1000 });
    expect(first).toMatchObject({ version: 1, sessionId: "A", serialized: "x" });
    expect(first.uiActionId).toBe(first.receiptId);
    expect(second.createdAt > first.createdAt).toBe(true);
    expect(second.serialized).toBe(`learner:${second.receiptId}`);
    expect(learnerSubmission({ sessionId: "A", serialized: "q", submissionId: quizSubmissionId("r") }).receiptId).toBe("quiz-result:r");
  });

  test("delivery holds nest and release independently per session", () => {
    const releaseOuter = pauseLearnerDelivery("A");
    const releaseInner = pauseLearnerDelivery("A");
    expect(learnerDeliveryPaused("A")).toBe(true);
    expect(learnerDeliveryPaused("B")).toBe(false);
    releaseInner();
    releaseInner();
    expect(learnerDeliveryPaused("A")).toBe(true);
    releaseOuter();
    expect(learnerDeliveryPaused("A")).toBe(false);
  });

  test("recognises responses already in the transcript by their visible text", () => {
    const sent = transcriptUserTexts([
      { role: "user", content: "plain" },
      { role: "assistant", content: [{ type: "text", text: "ignored" }] },
      { role: "user", content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] },
    ]);
    expect([...sent]).toEqual(["plain", "a\nb"]);
    expect(canonicalActionReceiptId({ documentId: "doc", idempotencyKey: "key" })).toBe("doc-key");
  });
});

describe("composer attachments", () => {
  const audioMessage = () => makeUserMessageFromAppend({
    role: "user",
    content: [{ type: "text", text: "listen" }, { type: "file", mimeType: "audio/webm", data: "data:audio/webm;base64,QQ==", filename: "a.webm" }],
  } as unknown as AppendMessage)!;

  test("audio for a model that cannot listen is kept and explained", () => {
    const message = audioMessage();
    expect(prepareAttachmentsForModel(message, { name: "Text Only", input: ["text"] })).toBe(audioCapabilityError({ name: "Text Only" }));
  });

  test("audio for a listening model is marked for delivery", () => {
    const message = audioMessage();
    expect(prepareAttachmentsForModel(message, { input: ["text", "audio"] })).toBeNull();
    expect((message as any).content[1].sendToModel).toBe(true);
  });

  test("images need a vision model", () => {
    const message = makeUserMessageFromAppend({
      role: "user",
      content: [{ type: "image", image: "data:image/png;base64,AAAA" }],
    } as unknown as AppendMessage)!;
    expect((message as any).content[0]).toEqual({ type: "image", mimeType: "image/png", data: "AAAA" });
    expect(prepareAttachmentsForModel(message, { id: "m", input: ["text"] })).toBe(visionCapabilityError({ id: "m" }));
    expect(prepareAttachmentsForModel(message, { input: ["text", "image"] })).toBeNull();
  });

  test("an empty composer produces no turn", () => {
    expect(makeUserMessageFromAppend({ role: "user", content: [{ type: "text", text: "  " }] } as unknown as AppendMessage)).toBeNull();
  });
});

describe("quiz conversation text", () => {
  const detail: QuizSubmissionDetail = {
    resultId: "r-1",
    quizId: "q",
    topic: "Fractions",
    total: 3,
    score: 1,
    partialCreditPoints: 1.5,
    partialCredits: { b: 0.5 },
    flagged: ["c"],
    timedOutQuestionIds: ["c"],
    timing: { totalMs: 65_000, perQuestionMs: { a: 4_000, b: 20_000, c: 41_000 } },
    questions: [
      { id: "a", question: "1/2 + 1/2?", correctAnswer: "1" },
      { id: "b", question: "1/3 + 1/3?", correctAnswer: "2/3" },
      { id: "c", question: "Explain halves", correctAnswer: "two equal parts", type: "short_answer" },
    ],
    answers: { a: " 1 ", b: "1/3", c: "" },
  };

  test("reports objective score, per-question marks, grading request and the result tag", () => {
    const text = quizSubmissionText(detail, () => 42)!;
    const [body, tag] = text.split("\n\n");
    const lines = body!.split("\n");
    expect(lines[0]).toBe('I finished the quiz on "Fractions".');
    expect(lines[1]).toStartWith("Objective score: 1/2 (1 open-ended pending your review) in ");
    expect(lines[2]).toBe("Partial-credit points: 1.50/2.");
    expect(lines[3]).toStartWith('- 1/2 + 1/2? → my answer: "1" ✓');
    expect(lines[4]).toStartWith('- 1/3 + 1/3? → my answer: "1/3" ✗ (partial credit: 50%)');
    expect(lines[5]).toStartWith('- [open-ended id=c] Explain halves → my answer: "(blank)" (reference: "two equal parts")');
    expect(lines[5]).toEndWith("[timed out]");
    expect(lines[6]).toContain('result_id "r-1"');
    expect(lines[7]).toBe("Bookmarked 1 question for review.");
    expect(lines.at(-1)).toBe("Please review my answers and timing, then guide what to work on next.");
    const payload = JSON.parse(JSON.parse(tag!.slice("<keating-quiz-result json=".length, -" />".length)));
    expect(payload).toMatchObject({ id: "r-1", timestamp: 42, quiz: { slug: "q", topic: "Fractions" }, result: { score: 1, flagged: ["c"] } });
  });

  test("a detail without a numeric score sends nothing; a missing result id is derived", () => {
    expect(quizSubmissionText(undefined)).toBeNull();
    expect(quizSubmissionText({ topic: "x" })).toBeNull();
    expect(quizSubmissionText({ score: 0, quizId: "z" }, () => 7)).toContain('\\"id\\":\\"z-7\\"');
  });

  test("remediation and reframe requests keep their wording", () => {
    expect(quizRemediationText({ level: "Apply", slug: "s" })).toBe(
      'I need help with "Apply" level questions on "s". Please generate targeted review material for this area.',
    );
    expect(quizRemediationText({})).toBeNull();
    expect(quizReframeText({ questionId: "q1", mode: "visual" })).toBe('Please reframe question "q1" in "visual" mode for "this topic".');
    expect(quizReframeText({ mode: "visual" })).toBeNull();
  });
});

describe("learner submission routing", () => {
  // Delivery through the real hooks (streaming, session switches, unmount) is
  // covered in chat-learner-delivery-lifecycle.test.tsx.
  test("every learner submission is submitted for the active session; quiz runs keep their result id", () => {
    const submitted: Array<{ text: string; id?: string }> = [];
    const captured: string[] = [];
    const handlers = createQuizConversationHandlers({
      hasAgent: () => true,
      submit: (serialized, id) => {
        submitted.push({ text: typeof serialized === "string" ? serialized : serialized({ sessionMessageId: "learner:x", submittedAt: "2026-01-01T00:00:00.000Z" }), id });
      },
      capture: (event) => { captured.push(event); },
      now: () => 7,
    });
    handlers.quizSubmitted(new CustomEvent("x", { detail: { resultId: "run-1", score: 1, total: 1 } }));
    handlers.quizSubmitted(new CustomEvent("x", { detail: { quizId: "sets", score: 1, total: 1 } }));
    handlers.questionAnswered(new CustomEvent("x", { detail: { answers: [{ question: "Q", answer: "A", grading: "pending" }] } }));
    handlers.questionAnswered(new CustomEvent("x", { detail: { answers: [] } }));
    handlers.remediationRequested(new CustomEvent("x", { detail: { level: "Recall" } }));
    handlers.reframeRequested(new CustomEvent("x", { detail: { questionId: "q", mode: "simpler" } }));
    expect(submitted.map((entry) => entry.id)).toEqual(["quiz-result:run-1", "quiz-result:sets-7", undefined, undefined, undefined]);
    expect(submitted[1]!.text).toContain('\\"id\\":\\"sets-7\\"');
    expect(submitted[2]!.text).toContain('"id":"learner:x"');
    expect(captured).toEqual(["quiz_remediation_requested", "quiz_reframe_requested"]);
    expect(textOf(userTextMessage("hi"))).toBe("hi");
  });

  test("without an agent nothing is submitted", () => {
    const submitted: unknown[] = [];
    const handlers = createQuizConversationHandlers({ hasAgent: () => false, submit: (text) => { submitted.push(text); }, capture: () => {} });
    handlers.quizSubmitted(new CustomEvent("x", { detail: { score: 1 } }));
    handlers.questionAnswered(new CustomEvent("x", { detail: { answers: [{ question: "Q", answer: "A" }] } }));
    expect(submitted).toEqual([]);
  });
});
