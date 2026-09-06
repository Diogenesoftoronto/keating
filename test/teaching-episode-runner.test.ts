import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPiCompletionRunner, createPiEpisodeRunner, DEFAULT_TEACHING_EPISODE_LIMITS,
  runTeachingEpisodeSubprocess, TEACHING_EPISODE_TOOLS, validateTeachingEpisodeRequest,
  type TeachingEpisodeRequest,
} from "../src/core/teaching-episode-runner.js";

let workspace: string;
let fixture: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "keating-episode-tests-"));
  fixture = join(workspace, "child.cjs");
  await writeFile(fixture, `let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => {
    const request = JSON.parse(input);
    if (request.caseId === 'hang') { setInterval(() => {}, 1000); return; }
    if (request.caseId === 'overflow') { process.stdout.write('x'.repeat(8192)); setInterval(() => {}, 1000); return; }
    if (request.caseId === 'private-error') { process.stderr.write('Bearer private-test-token'); process.stdout.write('private-test-token'); process.exit(1); }
    process.stdout.write(JSON.stringify({ok: true, execution: {messages: [...request.messages, {role:'assistant', content: request.systemPrompt}], toolCalls: [], model: request.provider + '/' + request.model, runtime: process.cwd()}}));
  });`);
});

afterAll(async () => { await rm(workspace, { recursive: true, force: true }); });

function request(caseId = "fixture"): TeachingEpisodeRequest {
  return {
    schemaVersion: 1, mode: "teaching", sourceCwd: workspace,
    provider: "fixture", model: "fixture-model", thinking: "off", caseId,
    systemPrompt: "Frozen prompt: `literal` $values stay intact.",
    messages: [{ role: "user", content: "Why is 1/8 smaller than 1/4?" }],
    limits: { ...DEFAULT_TEACHING_EPISODE_LIMITS, timeoutMs: 3_000 },
  };
}

function options(signal = new AbortController().signal) {
  return { signal, entryPath: fixture, executable: "node" };
}

describe("isolated teaching episode transport", () => {
  test("preserves the exact prompt and conversation, isolates each case, and removes temporary state", async () => {
    const input = request();
    input.messages.unshift({ role: "assistant", content: "What have you tried?" });
    const [first, second] = await Promise.all([
      runTeachingEpisodeSubprocess(input, options()), runTeachingEpisodeSubprocess(input, options()),
    ]);
    expect(first.messages.slice(0, -1)).toEqual(input.messages);
    expect(first.messages.at(-1)?.content).toBe(input.systemPrompt);
    expect(first.runtime).not.toBe(second.runtime);
    expect(first.runtime).not.toBe(workspace);
    expect(existsSync(first.runtime)).toBe(false);
    expect(existsSync(second.runtime)).toBe(false);
  });

  test("aborts an active child and reports a stable diagnostic", async () => {
    const abort = new AbortController();
    const pending = runTeachingEpisodeSubprocess(request("hang"), options(abort.signal));
    setTimeout(() => abort.abort(), 100);
    await expect(pending).rejects.toMatchObject({ code: "episode_aborted" });
  });

  test("rejects an already cancelled run before execution", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(runTeachingEpisodeSubprocess(request(), options(abort.signal))).rejects.toMatchObject({ code: "episode_aborted" });
  });

  test("kills hung and oversized children", async () => {
    const hanging = request("hang");
    hanging.limits.timeoutMs = 100;
    await expect(runTeachingEpisodeSubprocess(hanging, options())).rejects.toMatchObject({ code: "episode_timeout" });
    const oversized = request("overflow");
    oversized.limits.maxOutputBytes = 1_024;
    await expect(runTeachingEpisodeSubprocess(oversized, options())).rejects.toMatchObject({ code: "episode_output_limit" });
  });

  test("never returns provider diagnostics from stderr or malformed output", async () => {
    const failure = await runTeachingEpisodeSubprocess(request("private-error"), options()).catch((error) => error);
    expect(failure.code).toBe("episode_invalid_response");
    expect(String(failure)).not.toContain("private-test-token");
  });

  test("rejects invalid cases and unbounded execution limits", async () => {
    expect(validateTeachingEpisodeRequest({ ...request(), messages: [{ role: "assistant", content: "Answer" }] })).toBe(false);
    expect(validateTeachingEpisodeRequest({ ...request(), limits: { ...request().limits, timeoutMs: Infinity } })).toBe(false);
    const oversized = request();
    oversized.systemPrompt = "x".repeat(128_001);
    await expect(runTeachingEpisodeSubprocess(oversized, options())).rejects.toMatchObject({ code: "episode_invalid_request" });
  });
});

function completionStream(delta: Record<string, unknown>, finishReason = "stop"): Response {
  const chunk = (body: Record<string, unknown>, finish: string | null) => `data: ${JSON.stringify({
    id: "fixture-completion", object: "chat.completion.chunk", created: 1, model: "fixture-model",
    choices: [{ index: 0, delta: body, finish_reason: finish }],
  })}\n\n`;
  return new Response(`${chunk({ role: "assistant", ...delta }, null)}${chunk({}, finishReason)}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

async function withMockProvider<T>(respond: (body: any) => Response, run: (cwd: string, requests: any[]) => Promise<T>): Promise<T> {
  const requests: any[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const body = await req.json();
    requests.push(body);
    return respond(body);
  } });
  const source = await mkdtemp(join(workspace, "provider-"));
  await mkdir(join(source, ".keating", "pi-config"), { recursive: true });
  await writeFile(join(source, "keating.config.json"), JSON.stringify({ pi: { defaultProvider: "episode-fixture", defaultModel: "fixture-model", defaultThinking: "off" } }));
  await writeFile(join(source, ".keating", "pi-config", "auth.json"), JSON.stringify({ "episode-fixture": { type: "api_key", key: "synthetic-test-key" } }));
  await writeFile(join(source, ".keating", "pi-config", "models.json"), JSON.stringify({ providers: { "episode-fixture": {
    baseUrl: `http://127.0.0.1:${server.port}/v1`, api: "openai-completions",
    models: [{ id: "fixture-model", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 128_000, maxTokens: 4_096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  try { return await run(source, requests); }
  finally { server.stop(true); }
}

describe("production Pi SDK episode with deterministic local provider", () => {
  test("runs a real lesson-plan tool with the frozen prompt and preserves prefix messages", async () => {
    await withMockProvider((body) => body.messages.some((message: any) => message.role === "tool")
      ? completionStream({ content: "Compare the same whole split into four or eight equal parts." })
      : completionStream({ tool_calls: [{ index: 0, id: "call-plan", type: "function", function: { name: "plan", arguments: '{"topic":"fractions"}' } }] }, "tool_calls"),
    async (cwd, requests) => {
      const runner = await createPiEpisodeRunner(cwd, { timeoutMs: 20_000 });
      const input = request();
      input.messages = [{ role: "user", content: "I think eighths are bigger." }, { role: "assistant", content: "What makes you think that?" }, { role: "user", content: "Eight is bigger than four." }];
      const execution = await runner({ ...input, signal: new AbortController().signal });
      expect(requests).toHaveLength(2);
      expect(requests[0].messages[0].content).toBe(input.systemPrompt);
      expect(requests[0].messages.some((message: any) => message.content === input.messages[1].content)).toBe(true);
      expect(requests[0].tools.map((tool: any) => tool.function.name).sort()).toEqual([...TEACHING_EPISODE_TOOLS].sort());
      expect(execution.toolCalls).toHaveLength(1);
      expect(execution.toolCalls[0].name).toBe("plan");
      expect(execution.toolCalls[0].result).toContain("Wrote");
      expect(execution.messages.at(-1)?.content).toContain("same whole");
      expect(execution.model).toBe("episode-fixture/fixture-model");
      expect(execution.runtime).toContain("pedagogical-tools");
      expect(existsSync(join(cwd, ".keating", "outputs"))).toBe(false);
    });
  }, 30_000);

  test("blocks reads outside the episode workspace and does not expose credentials", async () => {
    await withMockProvider((body) => body.messages.some((message: any) => message.role === "tool")
      ? completionStream({ content: "I will continue with the provided example." })
      : completionStream({ tool_calls: [{ index: 0, id: "call-read", type: "function", function: { name: "read", arguments: JSON.stringify({ path: join(workspace, "private.txt") }) } }] }, "tool_calls"),
    async (cwd) => {
      await writeFile(join(workspace, "private.txt"), "private-synthetic-test-value");
      const runner = await createPiEpisodeRunner(cwd, { timeoutMs: 20_000 });
      const execution = await runner({ ...request(), signal: new AbortController().signal });
      expect(execution.toolCalls[0].result).toContain("episode_read_outside_workspace");
      expect(JSON.stringify(execution)).not.toContain("private-synthetic-test-value");
    });
  }, 30_000);

  test("judge/proposer completions have no tools and cannot dispatch evolution commands", async () => {
    await withMockProvider(() => completionStream({ content: '{"passed":true}' }), async (cwd, requests) => {
      const run = await createPiCompletionRunner(cwd, { timeoutMs: 20_000 });
      expect(await run({ systemPrompt: "Judge only the rubric.", prompt: "/auto-improve", signal: new AbortController().signal })).toBe('{"passed":true}');
      expect(requests).toHaveLength(1);
      expect(requests[0].tools ?? []).toHaveLength(0);
      expect(requests[0].messages[0].content).toBe("Judge only the rubric.");
    });
  }, 30_000);
});
