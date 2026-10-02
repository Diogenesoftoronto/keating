import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ThreadMessageLike,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { ChatMascotMenu } from "../components/ChatMascotMenu";

test("installed assistant API renders scoped message selectors and composer controls", () => {
  let composer: ReturnType<ReturnType<typeof useAui>["composer"]> | undefined;
  let sends = 0;
  let selected: unknown;
  const createdAt = new Date("2026-10-01T00:00:00Z");

  function MessageProbe() {
    selected = useAuiState(({ message }) => ({
      id: message.id,
      createdAt: message.createdAt,
      retryable: message.metadata.custom?.keatingRetryable,
      text: message.content.filter(part => part.type === "text").map(part => part.type === "text" ? part.text : "").join("\n\n"),
    }));
    return <MessagePrimitive.Root />;
  }
  function ComposerProbe() {
    composer = useAui().composer();
    return <ChatMascotMenu state="idle" busy={false} />;
  }
  function Harness() {
    const runtime = useExternalStoreRuntime<ThreadMessageLike>({
      messages: [{ id: "reply", role: "assistant", createdAt, status: { type: "complete", reason: "stop" }, content: [{ type: "text", text: "Visible answer" }], metadata: { custom: { keatingRetryable: true } } }],
      convertMessage: message => message,
      isRunning: false,
      onNew: async () => { sends++; },
    });
    return <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Messages components={{ AssistantMessage: MessageProbe, UserMessage: MessageProbe }} />
      <ComposerPrimitive.Root><ComposerProbe /></ComposerPrimitive.Root>
    </AssistantRuntimeProvider>;
  }

  const markup = renderToStaticMarkup(<Harness />);
  expect(selected).toEqual({ id: "reply", createdAt, retryable: true, text: "Visible answer" });
  expect(composer).toBeDefined();
  expect(typeof composer!.getState).toBe("function");
  expect(typeof composer!.setText).toBe("function");
  expect(typeof composer!.addAttachment).toBe("function");
  expect(markup).toContain("chat-mascot-perch");
  expect(sends).toBe(0);
});
