"use agent";

import {
  init,
  setProvider,
  useModel,
  useTool,
  usePersistentState,
  useResponseStart,
  useResponseFinish,
  observe,
} from "@flue/runtime";
import { start } from "@flue/runtime/node";
import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";
import {
  fauxProvider,
  createAssistantMessageEventStream,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import * as v from "valibot";
import { nodepodPersistence } from "../nodepod-persistence.ts";

const PREFIX = "KEATING_FLUE_RPC:";
const send = (message: unknown) =>
  process.stdout.write(PREFIX + JSON.stringify(message) + "\n");
observe((event) => {
  if ("isError" in event && event.isError && "error" in event)
    send({ kind: "diagnostic", error: String(event.error) });
  if (event.type === "log" && event.level === "error")
    send({ kind: "diagnostic", error: event.message });
});
let serial = 0;
let config: {
  sessionId: string;
  systemPrompt: string;
  tools: { name: string; description: string }[];
};
const streams = new Map<string, AssistantMessageEventStream>();
const calls = new Map<
  string,
  { resolve(value: any): void; reject(error: Error): void }
>();
function call(
  method: string,
  value: unknown,
  signal?: AbortSignal,
): Promise<any> {
  const id = `host-${++serial}`;
  return new Promise((resolve, reject) => {
    const abort = () => {
      calls.delete(id);
      send({ kind: "cancel", id });
      reject(new Error("aborted"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    calls.set(id, {
      resolve: (value) => {
        signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      reject: (error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      },
    });
    send({ kind: "call", id, method, value });
  });
}
const base = fauxProvider({
  provider: "keating-browser",
  models: [
    {
      id: "teacher",
      name: "Browser model bridge",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_000_000,
      maxTokens: 64_000,
    },
  ],
}).provider;
const stream: typeof base.streamSimple = (_model, _context, options) => {
  const result = createAssistantMessageEventStream();
  const id = `model-${++serial}`;
  streams.set(id, result);
  const abort = () => send({ kind: "cancel", id });
  options?.signal?.addEventListener("abort", abort, { once: true });
  void result.result().finally(() => {
    streams.delete(id);
    options?.signal?.removeEventListener("abort", abort);
  });
  // The browser owns model credentials, authoritative multimodal context and schemas.
  // Flue owns when the next model turn and each tool execution occur.
  send({ kind: "call", id, method: "model", value: { context: _context } });
  return result;
};
const provider = { ...base, stream, streamSimple: stream };
setProvider(provider);

export function BrowserTeacher() {
  useModel("keating-browser/teacher", { compaction: false });
  useResponseStart(() => ({ timestamp: Date.now() }));
  useResponseFinish(() => ({ timestamp: Date.now() }));
  const [, refresh] = usePersistentState("capabilityRevision", 0);
  for (const tool of config.tools)
    useTool({
      name: tool.name,
      description: tool.description,
      // Original TypeBox validation and compatibility transforms run in the authorized browser executor.
      input: v.looseObject({}),
      output: v.any(),
      async run({ data, toolCallId, signal }) {
        const result = await call(
          "tool",
          { name: tool.name, args: data, toolCallId },
          signal,
        );
        refresh((previous) => previous + 1);
        if (result.isError)
          throw new Error(result.message || "Browser tool failed");
        return {
          output: result.result,
          ...(result.result?.terminate ? { terminate: true } : {}),
        };
      },
    });
  return config.systemPrompt;
}
BrowserTeacher.agentName = "keating-browser-teacher";
let runtime: Awaited<ReturnType<typeof start>> | undefined;
let teacher: ReturnType<typeof init> | undefined;
const app = new Hono().route(
  "/agents/teacher",
  createAgentRouter(BrowserTeacher),
);
const requests = new Map<string, AbortController>();
async function request(message: any) {
  if (message.kind === "cancel-http") {
    requests.get(message.id)?.abort();
    return;
  }
  if (message.kind === "http") {
    const controller = new AbortController();
    requests.set(message.id, controller);
    try {
      const response = await app.fetch(
        new Request(message.url, {
          method: message.method,
          headers: message.headers,
          ...(message.body ? { body: message.body } : {}),
          signal: controller.signal,
        }),
      );
      send({
        kind: "http-head",
        id: message.id,
        status: response.status,
        headers: [...response.headers],
      });
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            send({
              kind: "http-chunk",
              id: message.id,
              data: Buffer.from(value).toString("base64"),
            });
          }
        } finally {
          reader.releaseLock();
        }
      }
      send({ kind: "http-end", id: message.id });
    } catch (error) {
      send({ kind: "http-error", id: message.id, error: String(error) });
    } finally {
      requests.delete(message.id);
    }
    return;
  }
  if (message.kind === "stream") {
    const event = message.event;
    streams.get(message.id)?.push(event);
    return;
  }
  if (message.kind === "reply") {
    const pending = calls.get(message.id);
    calls.delete(message.id);
    if (message.error) pending?.reject(new Error(message.error));
    else pending?.resolve(message.value);
    return;
  }
  if (message.kind === "configure") {
    config = message.value;
    return;
  }
  try {
    let value: unknown;
    if (message.method === "start") {
      if (runtime) throw new Error("Runtime already started");
      config = message.value;
      runtime = await start({
        agents: [BrowserTeacher],
        providers: [provider],
        db: await nodepodPersistence("/workspace/flue.sqlite"),
      });
      teacher = init(BrowserTeacher, { id: config.sessionId });
      value = { runtime: "@flue/runtime", version: "2.0.3" };
    } else if (message.method === "stop") {
      await teacher?.abort();
      await runtime?.stop();
      runtime = undefined;
    } else throw new Error("Unknown runtime operation");
    send({ kind: "reply", id: message.id, value });
  } catch (error) {
    send({
      kind: "reply",
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let end; (end = buffer.indexOf("\n")) >= 0; ) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (line) {
      try {
        void request(JSON.parse(line)).catch((error) =>
          send({ kind: "fatal", error: String(error) }),
        );
      } catch {
        send({ kind: "fatal", error: "Invalid bridge message" });
      }
    }
  }
});
// Keep the worker alive while waiting for its first input.
setInterval(() => {}, 60_000);
send({ kind: "ready" });
