import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { MINIMAX_M31_FLASH_PROFILE } from "../packages/runtime-config/src/index.js";
import { configPath } from "../src/core/config.js";
import { configDir } from "../src/core/paths.js";
import { piComplete } from "../src/core/pi-agent.js";
import { syncExtraProviders } from "../src/runtime/pi.js";

test("a first noninteractive completion prepares the selected MiniMax model before spawning Pi", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-minimax-command-"));
  const packageRoot = join(cwd, "fixture-runtime");
  const previousRoot = process.env.KEATING_PACKAGE_ROOT_OVERRIDE;
  try {
    const cli = join(packageRoot, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    const extension = join(packageRoot, "src/pi/notorganic-provider-extension.ts");
    await mkdir(dirname(cli), { recursive: true });
    await mkdir(dirname(extension), { recursive: true });
    await writeFile(extension, "");
    await writeFile(cli, `
      const { readFileSync } = require("node:fs");
      const models = JSON.parse(readFileSync(process.env.PI_CODING_AGENT_DIR + "/models.json", "utf8"));
      const arg = key => process.argv[process.argv.indexOf(key) + 1];
      const model = models.providers[arg("--provider")].models.find(row => row.id === arg("--model"));
      console.log(JSON.stringify({ id: model.id, api: model.api, baseUrl: model.baseUrl }));
    `);
    await writeFile(configPath(cwd), JSON.stringify({ pi: {
      defaultProvider: "minimax", defaultModel: MINIMAX_M31_FLASH_PROFILE.id, runtimePreference: "embedded-only",
    } }));
    AuthStorage.create(join(configDir(cwd), "auth.json")).set("minimax", { type: "api_key", key: "local-only" });
    process.env.KEATING_PACKAGE_ROOT_OVERRIDE = packageRoot;
    expect(JSON.parse(await piComplete(cwd, "Local command fixture", { json: true }))).toEqual({
      id: "MiniMax-M3.1-Flash", api: "openai-completions", baseUrl: "https://api.minimax.io/v1",
    });
  } finally {
    if (previousRoot === undefined) delete process.env.KEATING_PACKAGE_ROOT_OVERRIDE;
    else process.env.KEATING_PACKAGE_ROOT_OVERRIDE = previousRoot;
    await rm(cwd, { recursive: true, force: true });
  }
});

test("interactive Pi login and one-use keys can select Flash before an environment key is present", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-minimax-login-"));
  try {
    const directory = configDir(cwd);
    const modelsPath = join(directory, "models.json");
    await mkdir(directory, { recursive: true });
    const customModel = { id: "custom-lesson-model", api: "openai-completions", baseUrl: "https://local.example/v1" };
    await writeFile(modelsPath, JSON.stringify({ providers: { minimax: { models: [customModel] } } }));
    await Promise.all([syncExtraProviders(cwd, {}), syncExtraProviders(cwd, {})]);
    const saved = JSON.parse(await readFile(modelsPath, "utf8"));
    expect(saved.providers.minimax.models.map((row: { id: string }) => row.id)).toEqual([customModel.id, MINIMAX_M31_FLASH_PROFILE.id]);
    expect(saved.providers.minimax.models[0]).toEqual(customModel);
    expect(saved.providers.minimax.apiKey).toBeUndefined();

    const auth = AuthStorage.create(join(directory, "auth.json"));
    auth.set("minimax", { type: "api_key", key: "stored-test-key" });
    const registry = ModelRegistry.create(auth, modelsPath);
    const model = registry.find("minimax", MINIMAX_M31_FLASH_PROFILE.id)!;
    expect(registry.getAvailable().filter(row => row.provider === "minimax" && row.id === model.id)).toHaveLength(1);
    expect(await registry.getApiKeyAndHeaders(model)).toMatchObject({ ok: true, apiKey: "stored-test-key" });
    auth.setRuntimeApiKey("minimax", "one-use-test-key");
    expect(await registry.getApiKeyAndHeaders(model)).toMatchObject({ ok: true, apiKey: "one-use-test-key" });

    const privateRegistration = { api: "openai-completions", baseUrl: "https://private.example/v1", models: [customModel] };
    await writeFile(modelsPath, JSON.stringify({ providers: { minimax: privateRegistration } }));
    await syncExtraProviders(cwd, { MINIMAX_API_KEY: "offline-fixture" });
    expect(JSON.parse(await readFile(modelsPath, "utf8")).providers.minimax).toEqual(privateRegistration);
    await writeFile(modelsPath, "{invalid");
    await expect(syncExtraProviders(cwd, {})).rejects.toThrow("Invalid JSON");
    expect(await readFile(modelsPath, "utf8")).toBe("{invalid");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("the CLI's on-disk Pi registry loads the exact direct MiniMax model and speaks its Chat Completions protocol", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-minimax-registry-"));
  const requests: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 });
      requests.push(await request.json() as Record<string, unknown>);
      const chunk = { id: "local", model: MINIMAX_M31_FLASH_PROFILE.id, choices: [{ index: 0, delta: { content: "Checked." }, finish_reason: "stop" }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  try {
    await syncExtraProviders(cwd, { MINIMAX_API_KEY: "offline-fixture" });
    const registry = ModelRegistry.create(AuthStorage.inMemory(), join(configDir(cwd), "models.json"));
    expect(registry.getError()).toBeUndefined();
    const model = registry.find("minimax", "MiniMax-M3.1-Flash");
    expect(model).toMatchObject(MINIMAX_M31_FLASH_PROFILE);
    expect(registry.find("minimax", "MiniMax-M2.7-highspeed")).toBeDefined();
    expect(registry.find("minimax", "MiniMax-M3")).toBeDefined();
    for (const reasoning of [undefined, "minimal", "medium"] as const) {
      const response = await streamSimple({ ...model!, baseUrl: new URL("/v1", server.url).href }, {
        systemPrompt: "Local transport fixture.", messages: [{ role: "user", content: "Check.", timestamp: 1 }],
      }, { apiKey: "offline-fixture", maxTokens: 100, temperature: 0, reasoning, maxRetries: 0 }).result();
      expect(response.stopReason).toBe("stop");
    }
    expect(requests.map(request => request.reasoning_effort)).toEqual([undefined, "low", "medium"]);
    for (const request of requests) {
      expect(request).toMatchObject({ model: "MiniMax-M3.1-Flash", max_completion_tokens: 100,
        messages: [{ role: "system", content: "Local transport fixture." }, { role: "user", content: "Check." }],
        stream_options: { include_usage: true } });
      expect(request.thinking).toBeUndefined();
      expect(request.store).toBeUndefined();
    }
  } finally {
    server.stop(true);
    await rm(cwd, { recursive: true, force: true });
  }
});
