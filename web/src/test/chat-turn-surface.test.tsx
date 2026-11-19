import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { TurnProgressCard, TurnTimeline } from "../components/TurnProgress";
import { FailedResponseRecovery } from "../components/FailedResponseRecovery";
import { ProviderAuthRecovery } from "../components/ProviderAuthRecovery";
import { WithheldReplyRecovery } from "../components/WithheldReplyRecovery";
import { RetryResponseButton } from "../components/RetryResponseButton";

function Thread({ running, Reply }: { running: boolean; Reply: () => React.JSX.Element | null }) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: [
      { id: "prompt", role: "user", content: "Question" },
      { id: "reply", role: "assistant", content: "Reply" },
    ],
    convertMessage: message => message,
    isRunning: running,
    onNew: async () => {},
  });
  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Messages components={{ AssistantMessage: Reply, UserMessage: () => null }} />
  </AssistantRuntimeProvider>;
}

test("ordinary thinking turns include a named three-stage rail without a draft receipt", () => {
  const html = renderToStaticMarkup(<Thread running Reply={() => <TurnProgressCard status={null} prefill="Preparing your reply" />} />);
  expect(html).toContain("Keating is thinking");
  expect(html).toContain('role="progressbar"');
  expect(html).toContain("Preparing your reply");
  expect(html).toContain('aria-current="step">Draft');
  expect(html).toContain(">Review");
  expect(html).toContain(">Reply");
});

test("the ordinal timeline retains measured time, failed queries and source counts", () => {
  const html = renderToStaticMarkup(<TurnTimeline steps={[
    { id: "research", state: "warn", title: "Searched the web", queries: [
      { id: "q1", query: "A query", state: "error", sources: 0 },
      { id: "q2", query: "Another query", state: "success", sources: 2 },
    ] },
    { id: "write", state: "done", title: "Wrote draft 1", durationMs: 800 },
  ]}/>);
  for (const text of ["Reply events in step order", "View as table", "A query", "failed", "2 sources", "0.8s"]) expect(html).toContain(text);
});

test("model failure can promote model selection while keeping retry available", () => {
  const make = (preferModel: boolean) => renderToStaticMarkup(<FailedResponseRecovery onRetry={() => {}} onModelSelect={() => {}} preferModel={preferModel}/>);
  for (const preferModel of [true, false]) {
    const html = make(preferModel);
    expect(html.match(/data-chat-recovery=/g)).toHaveLength(1);
    expect(html.match(/k-primary/g)).toHaveLength(1);
    expect(html.slice(html.indexOf("k-primary"))).toContain(preferModel ? ">Choose model<" : ">Retry response<");
  }
});

test("authentication keeps secondary retry in its single notice", () => {
  const html = renderToStaticMarkup(<ProviderAuthRecovery failedProvider="notorganic" onRecover={async () => false}
    secondaryActions={<RetryResponseButton onRetry={() => {}} />} />);
  expect(html.match(/data-chat-recovery=/g)).toHaveLength(1);
  expect(html.match(/k-primary/g)).toHaveLength(1);
  expect(html).toContain("Retry response");
  expect(html).toContain("Sign in / Sign up");
});

test("a withheld turn retains reload alongside its primary retry action", () => {
  const html = renderToStaticMarkup(<Thread running={false} Reply={WithheldReplyRecovery} />);
  expect(html).toContain("Reload Keating");
  expect(html.match(/k-primary/g)).toHaveLength(1);
  expect(html.slice(html.indexOf("k-primary"))).toContain("Try again");
});
