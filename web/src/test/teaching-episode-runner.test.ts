import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { BROWSER_EPISODE_TOOLS, createBrowserEpisodeAdapters } from "../keating/teaching-episode-runner";
import { KeatingStorage } from "../keating/storage";

beforeEach(() => { (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory(); });

const model: Model<Api> = {
  id: "fixture-model", name: "Fixture", provider: "openai", api: "openai-completions", baseUrl: "https://unused.invalid",
  reasoning: false, input: ["text"], contextWindow: 128_000, maxTokens: 4_096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function streamMessage(content: AssistantMessage["content"], stopReason: "stop" | "toolUse" | "error" | "aborted" = "stop") {
  const message: AssistantMessage = {
    role: "assistant", content, stopReason, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const stream = createAssistantMessageEventStream();
  if (stopReason === "error" || stopReason === "aborted") stream.push({ type: "error", reason: stopReason, error: message });
  else stream.push({ type: "done", reason: stopReason, message });
  stream.end(message);
  return stream;
}

const input = () => ({
  caseId: "fractions", systemPrompt: "Frozen teaching prompt.",
  messages: [{ role: "user" as const, content: "Why are eighths smaller?" }], signal: new AbortController().signal,
});

const questions = [
  { question: "Which is larger: 1/4 or 1/8 of the same whole?", correctAnswer: "1/4", explanation: "Four equal pieces are larger than eight equal pieces of the same whole." },
  { question: "Which is larger: 1/3 or 1/6 of the same whole?", correctAnswer: "1/3", explanation: "Each third includes two sixths." },
];

describe("browser teaching episode adapters", () => {
  test("executes the real authored-quiz tool in disposable storage and keeps learner records unchanged", async () => {
    const learner = new KeatingStorage();
    await learner.saveLessonPlan("Existing lesson", "Keep this learner record.");
    const source = await learner.listArtifacts();
    const contexts: any[] = [];
    const providerNames: string[] = [];
    let temporaryNames: string[] = [];
    const streamFn: StreamFn = async (_model, context, options) => {
      contexts.push(JSON.parse(JSON.stringify(context)));
      expect(options?.maxTokens).toBe(2_048);
      temporaryNames = (await indexedDB.databases()).flatMap((database) => database.name?.startsWith("keating-eval-") ? [database.name] : []);
      return context.messages.some((message) => message.role === "toolResult")
        ? streamMessage([{ type: "text", text: "Quiz ready." }])
        : streamMessage([{ type: "toolCall", id: "quiz-call", name: "quiz", arguments: { topic: "fractions", questions } }], "toolUse");
    };
    const { runner } = createBrowserEpisodeAdapters({ model, streamFn, getApiKey: (provider) => { providerNames.push(provider); return "synthetic-fixture-key"; } });
    const episode = await runner(input());
    expect(contexts).toHaveLength(2);
    expect(contexts[0].systemPrompt).toBe(input().systemPrompt);
    expect(contexts[0].tools.map((tool: any) => tool.name).sort()).toEqual([...BROWSER_EPISODE_TOOLS].sort());
    expect(providerNames).toEqual(["openai", "openai"]);
    expect(episode.toolCalls[0]).toMatchObject({ name: "quiz", arguments: { topic: "fractions", questions } });
    expect(episode.toolCalls[0].result).toContain("<keating-quiz");
    expect(episode.messages.at(-1)?.content).toBe("Quiz ready.");
    expect(episode.model).toBe("openai/fixture-model");
    expect(episode.runtime).toContain("browser-headless");
    expect(temporaryNames).toHaveLength(1);
    expect((await indexedDB.databases()).some((database) => temporaryNames.includes(database.name ?? ""))).toBe(false);
    expect(await learner.listArtifacts()).toEqual(source);
  });

  test("preserves the supplied prefix and uses a new Agent for every run", async () => {
    const contexts: any[] = [];
    const { runner } = createBrowserEpisodeAdapters({ model, getApiKey: () => "fixture", streamFn: (_model, context) => {
      contexts.push(JSON.parse(JSON.stringify(context)));
      return streamMessage([{ type: "text", text: "Compare the same whole." }]);
    } });
    const prefix = [{ role: "user" as const, content: "I think eight is bigger." }, { role: "assistant" as const, content: "Tell me why." }, ...input().messages];
    const first = await runner({ ...input(), messages: prefix });
    await runner(input());
    expect(first.messages.slice(0, -1)).toEqual(prefix);
    expect(contexts[0].messages).toHaveLength(3);
    expect(contexts[1].messages).toHaveLength(1);
    expect(await indexedDB.databases()).toEqual([]);
  });

  test("completion has zero tools and accepts command-like text as ordinary input", async () => {
    const { complete } = createBrowserEpisodeAdapters({ model, getApiKey: () => "fixture", streamFn: (_model, context) => {
      expect(context.tools ?? []).toHaveLength(0);
      expect(context.systemPrompt).toBe("Independent judge.");
      expect(context.messages.at(-1)?.content).toEqual([{ type: "text", text: "/auto-improve" }]);
      return streamMessage([{ type: "text", text: '{"passed":true}' }]);
    } });
    expect(await complete({ systemPrompt: "Independent judge.", prompt: "/auto-improve", signal: input().signal })).toBe('{"passed":true}');
    expect(await indexedDB.databases()).toEqual([]);
  });

  test("aborts the actual provider signal and removes its database", async () => {
    let providerSignal: AbortSignal | undefined;
    const abort = new AbortController();
    const { runner } = createBrowserEpisodeAdapters({ model, getApiKey: () => "fixture", streamFn: async (_model, _context, options) => {
      providerSignal = options?.signal;
      setTimeout(() => abort.abort(), 10);
      await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
      return streamMessage([], "aborted");
    } });
    await expect(runner({ ...input(), signal: abort.signal })).rejects.toMatchObject({ code: "episode_aborted" });
    expect(providerSignal?.aborted).toBe(true);
    expect(await indexedDB.databases()).toEqual([]);
  });

  test("stops a tool loop at the fixed provider-call budget", async () => {
    let requests = 0;
    const { runner } = createBrowserEpisodeAdapters({ model, getApiKey: () => "fixture", limits: { maxProviderCalls: 1 }, streamFn: () => {
      requests += 1;
      return streamMessage([{ type: "toolCall", id: "quiz-call", name: "quiz", arguments: { topic: "fractions", questions } }], "toolUse");
    } });
    await expect(runner(input())).rejects.toMatchObject({ code: "episode_provider_call_limit" });
    expect(requests).toBe(1);
    expect(await indexedDB.databases()).toEqual([]);
  });

  test("reports model failures without returning provider text and cleans up", async () => {
    const { runner } = createBrowserEpisodeAdapters({ model, getApiKey: () => "fixture", streamFn: () => { throw new Error("Authorization: private-fixture-token"); } });
    const error = await runner(input()).catch((failure) => failure);
    expect(String(error)).not.toContain("private-fixture-token");
    expect(error.code).toBe("episode_provider_failure");
    expect(await indexedDB.databases()).toEqual([]);
  });
});
