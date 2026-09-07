import { FlueConversation } from "../../keating/flue/conversation";
import runtimeUrl from "virtual:keating-flue-runtime";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
import { createKeatingTools } from "../../keating/browser-tools";
import { KeatingStorage } from "../../keating/storage";
import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { AssistantChatPanel } from "../../components/AssistantChatPanel";
import type { ChatPanelHandle } from "../../types/chat-panel";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const model: Model<Api> = {
  id: "fixture",
  name: "Fixture",
  provider: "openai",
  api: "openai-completions",
  baseUrl: "https://unused.invalid",
  reasoning: false,
  input: ["text"],
  contextWindow: 128_000,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
function response(
  content: AssistantMessage["content"],
  stopReason: "stop" | "toolUse" | "aborted" = "stop",
) {
  const message: AssistantMessage = {
    role: "assistant",
    content,
    stopReason,
    api: model.api,
    model: model.id,
    provider: model.provider,
    timestamp: Date.now(),
    usage,
  };
  const stream = createAssistantMessageEventStream();
  if (stopReason === "aborted")
    stream.push({ type: "error", reason: "aborted", error: message });
  else {
    stream.push({ type: "start", partial: { ...message, content: [] } });
    for (const [contentIndex, part] of content.entries()) {
      if (part.type === "text") {
        stream.push({ type: "text_start", contentIndex, partial: message });
        stream.push({
          type: "text_delta",
          contentIndex,
          delta: part.text,
          partial: message,
        });
        stream.push({
          type: "text_end",
          contentIndex,
          content: part.text,
          partial: message,
        });
      } else if (part.type === "toolCall") {
        stream.push({ type: "toolcall_start", contentIndex, partial: message });
        stream.push({
          type: "toolcall_delta",
          contentIndex,
          delta: JSON.stringify(part.arguments),
          partial: message,
        });
        stream.push({
          type: "toolcall_end",
          contentIndex,
          toolCall: part,
          partial: message,
        });
      }
    }
    stream.push({ type: "done", reason: stopReason, message });
  }
  stream.end(message);
  return stream;
}
export async function runFlueChatFixture() {
  const element = document.body.appendChild(document.createElement("main"));
  const panel = createRef<ChatPanelHandle>();
  createRoot(element).render(createElement(AssistantChatPanel, { ref: panel }));
  for (let tries = 0; !panel.current && tries < 100; tries++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  check(panel.current, "Chat panel did not mount");
  const storage = new KeatingStorage("keating-eval-flue-ui");
  const tools = (await createKeatingTools(storage)).filter(
    (tool) => tool.name === "quiz",
  );
  const sessionId = "flue-browser-fixture";
  let calls = 0;
  let observed = 0;
  let quizCalls = 0;
  let holdResponse = false;
  let responseStarted: (() => void) | undefined;
  const original = tools[0].execute;
  tools[0].execute = async (...args) => {
    quizCalls++;
    return original(...args);
  };
  const create = (messages: any[] = []) =>
    new FlueConversation(
      {
        initialState: {
          model,
          tools,
          messages,
          systemPrompt: "Use the existing Keating quiz tool.",
        },
        sessionId,
        getApiKey: () => "fixture-secret-stays-in-browser",
        streamFn: (_model, context, options) => {
          calls++;
          check(
            options?.apiKey === "fixture-secret-stays-in-browser",
            "Browser credential resolver not used",
          );
          check(
            context.systemPrompt === "Use the existing Keating quiz tool.",
            "System prompt changed",
          );
          if (holdResponse) {
            const stream = createAssistantMessageEventStream();
            const abort = () => {
              const message: AssistantMessage = {
                role: "assistant",
                content: [],
                stopReason: "aborted",
                api: model.api,
                model: model.id,
                provider: model.provider,
                timestamp: Date.now(),
                usage,
              };
              stream.push({ type: "error", reason: "aborted", error: message });
              stream.end(message);
            };
            options?.signal?.addEventListener("abort", abort, { once: true });
            if (options?.signal?.aborted) abort();
            responseStarted?.();
            return stream;
          }
          if (
            !context.messages.some((message) => message.role === "toolResult")
          )
            return response(
              [
                {
                  type: "toolCall",
                  id: "quiz-call",
                  name: "quiz",
                  arguments: {
                    topic: "fractions",
                    questions: [
                      {
                        question: "Which is larger: 1/4 or 1/8?",
                        correctAnswer: "1/4",
                        explanation: "A fourth is larger.",
                      },
                      {
                        question: "Which is larger: 1/3 or 1/6?",
                        correctAnswer: "1/3",
                        explanation: "A third contains two sixths.",
                      },
                    ],
                  },
                },
              ],
              "toolUse",
            );
          check(
            JSON.stringify(context.messages).includes("keating-quiz"),
            "Real quiz output missing from next model turn",
          );
          return response([
            {
              type: "text",
              text:
                calls > 2
                  ? "Your earlier quiz is still here."
                  : "Quiz ready. Explain your reasoning.",
            },
          ]);
        },
      },
      runtimeUrl,
    );
  let chat = create();
  try {
    await panel.current.setConversation(chat);
    chat.subscribe(() => {
      if (chat.getSnapshot().conversation?.messages.length) observed++;
    });
    await chat.send("Make a fractions quiz.", [
      { type: "image", data: pixel, mimeType: "image/png" },
    ]);
    check(
      !chat.context.errorMessage,
      `${chat.context.errorMessage} (model=${calls}, quiz=${quizCalls})`,
    );
    check(
      calls === 2 && quizCalls === 1,
      `Unexpected calls: model=${calls}, quiz=${quizCalls}`,
    );
    check(observed > 0, "Native SDK observation did not reach the UI");
    const native = chat.getSnapshot().conversation!;
    for (
      let tries = 0;
      tries < 100 &&
      !chat
        .getSnapshot()
        .conversation?.messages.some((message) =>
          message.parts.some(
            (part) => part.type === "file" && part.url?.startsWith("blob:"),
          ),
        );
      tries++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    check(
      chat
        .getSnapshot()
        .conversation?.messages.some((message) =>
          message.parts.some(
            (part) => part.type === "file" && part.url?.startsWith("blob:"),
          ),
        ),
      "Attachment bytes were not resolved through the local bridge",
    );
    check(
      native.messages.some((message) =>
        message.parts.some(
          (part) =>
            part.type === "dynamic-tool" && part.state === "output-available",
        ),
      ),
      "Native tool result missing",
    );
    await new Promise<void>((resolve) => {
      (window as any).flueChatContinue = resolve;
      (window as any).flueChatQuizReady = true;
    });
    const messages = structuredClone(chat.context.messages);
    await chat.dispose();
    chat = create(messages);
    await panel.current.setConversation(chat);
    await chat.send("Continue from my earlier quiz.");
    check(
      !chat.context.errorMessage,
      chat.context.errorMessage ?? "Reopen failed",
    );
    check(quizCalls === 1, "Reopening replayed the quiz tool");
    check(
      chat
        .getSnapshot()
        .conversation!.messages.filter((message) => message.role === "user")
        .length === 2,
      "Native conversation history not restored",
    );
    const competing = create(messages);
    await competing.send("Competing tab");
    check(
      competing.context.errorMessage?.includes("another tab"),
      "Concurrent runtime ownership was not rejected",
    );
    await competing.dispose();
    holdResponse = true;
    const started = new Promise<void>((resolve) => {
      responseStarted = resolve;
    });
    const pending = chat.send("Wait for me to stop this response.");
    await started;
    chat.cancel();
    await pending;
    check(
      chat.context.errorMessage === "Response stopped",
      "Stop did not settle the active response",
    );
    holdResponse = false;
    await chat.send("Try again after stopping.");
    check(!chat.context.errorMessage, "Could not continue after cancellation");
    check(
      quizCalls === 1,
      "Cancellation or retry replayed a completed quiz tool",
    );
    return {
      calls,
      quizCalls,
      observed,
      native: true,
      restored: true,
      cancelled: true,
      exclusive: true,
    };
  } finally {
    await chat.dispose();
    await storage.destroyIsolatedDatabase();
  }
}
