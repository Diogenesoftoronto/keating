import assert from "node:assert/strict";
import { it } from "node:test";
import { createAssistantMessageEventStream, fauxProvider, fauxAssistantMessage, fauxToolCall, type AssistantMessage, type AssistantMessageEvent } from "@earendil-works/pi-ai";
import { init, useModel, usePersistentState, useTool, useResponseStart, useResponseFinish } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import * as v from "valibot";
import { libsql } from "@flue/libsql";
import { openNodepodSqlRunner } from "../src/nodepod-persistence.ts";

function reviewedStream(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  const wire = (event: AssistantMessageEvent) => stream.push(JSON.parse(JSON.stringify(event)) as AssistantMessageEvent);
  let partial = { ...message, content: [] } as AssistantMessage;
  wire({ type: "start", partial });
  for (const part of message.content) {
    const contentIndex = partial.content.length;
    if (part.type === "text") {
      partial = { ...partial, content: [...partial.content, { ...part, text: "" }] };
      wire({ type: "text_start", contentIndex, partial });
      partial = { ...partial, content: [...partial.content.slice(0, -1), part] };
      wire({ type: "text_delta", contentIndex, delta: part.text, partial });
      wire({ type: "text_end", contentIndex, content: part.text, partial });
    } else if (part.type === "toolCall") {
      partial = { ...partial, content: [...partial.content, { ...part, arguments: {} }] };
      wire({ type: "toolcall_start", contentIndex, partial });
      partial = { ...partial, content: [...partial.content.slice(0, -1), part] };
      wire({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(part.arguments), partial });
      wire({ type: "toolcall_end", contentIndex, toolCall: part, partial });
    }
  }
  wire({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
  stream.end(message);
  return stream;
}

it("reviewed canonical stream commits an animation tool and subsequent assistant response", async () => {
  const base = fauxProvider({ provider: "reviewed-regression", models: [{ id: "teacher", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 4096 }] }).provider;
  let generations = 0;
  let executions = 0;
  const stream = () => reviewedStream(++generations === 1
    ? fauxAssistantMessage([{ type: "text", text: "I will build the simulation." }, fauxToolCall("animate", { topic: "Request rate versus server capacity", animationId: "queue-simulation" })], { stopReason: "toolUse" })
    : fauxAssistantMessage("The queue grows when request rate exceeds capacity."));
  const provider = { ...base, stream, streamSimple: stream };
  function ReviewedTeacher() {
    useModel("reviewed-regression/teacher", { compaction: false });
    useResponseStart(() => ({ timestamp: Date.now() }));
    useResponseFinish(() => ({ timestamp: Date.now() }));
    const [revision, refresh] = usePersistentState("capabilityRevision", 0);
    useTool({ name: "animate", description: "Build a queue simulation", input: v.looseObject({}), output: v.any(), run() {
      executions++;
      refresh(previous => previous + 1);
      return { output: { content: [{ type: "text", text: "Interactive queue simulation created." }], details: { id: "queue-simulation" } } };
    } });
    return `Teach using interactive simulations. Capability revision ${revision}`;
  }
  ReviewedTeacher.agentName = "reviewed-stream-regression";
  const db = libsql(await openNodepodSqlRunner());
  const runtime = await start({ agents: [ReviewedTeacher], providers: [provider], db });
  try {
    const teacher = init(ReviewedTeacher, { id: "reviewed-queue" });
    const receipt = await teacher.dispatch("Show me an interactive simulation of request rate versus server capacity in a queue.");
    const reply = await teacher.read(receipt);
    assert.match(reply.text, /queue grows/);
    assert.equal(executions, 1);
    assert.equal(generations, 2);
  } finally { await runtime.stop(); }
});
