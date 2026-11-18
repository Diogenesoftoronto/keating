// Bun. Read-only release modules. All provider inputs are synthetic or published app instructions.
import { plugin } from "bun";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";

const here = import.meta.dir;
const release = process.env.KEATING_AUDIT_RELEASE;
const checkout = resolve(here, "../../..");
const scratch = join(checkout, ".keating/benchmarks/openui-audit-2026-11-18");
const dest = join(here, "evidence");
const scenarios = JSON.parse(readFileSync(join(here, "scenarios.json")));
const modelIds = ["MiniMax-M2.7-highspeed", "gemini-3.1-flash-lite"];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const save = (path, value) => {
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n");
  renameSync(path + ".tmp", path);
};
if (!release || !process.argv.includes("--execute")) {
  console.log(
    "Dry run. Two configured tutor models × ten synthetic prompts. Live execution requires KEATING_AUDIT_RELEASE, a verified release prompt export, and --execute.",
  );
  process.exit(0);
}
// Separate executions share a single budget journal, including calls whose final
// usage was unavailable. flock releases the lock if a worker exits unexpectedly.
if (!process.env.KEATING_AUDIT_LOCK_HELD) {
  const locked = Bun.spawnSync(
    [
      "rtk",
      "proxy",
      "flock",
      "-n",
      "-E",
      "75",
      join(scratch, ".budget.lock"),
      process.execPath,
      import.meta.path,
      ...process.argv.slice(2),
    ],
    {
      env: { ...process.env, KEATING_AUDIT_LOCK_HELD: "1" },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (locked.exitCode === 75)
    console.error("Another live audit is already using the shared budget.");
  process.exit(locked.exitCode ?? 1);
}
const revision = Bun.spawnSync([
  "rtk",
  "proxy",
  "git",
  "-C",
  release,
  "rev-parse",
  "HEAD",
]);
if (
  revision.stdout.toString().trim() !==
  "feb14a770371032619839271cfb3d1a4fe5079ff"
)
  throw Error("Wrong release");
await plugin({
  name: "keating-vite-raw",
  setup(build) {
    build.onLoad({ filter: /\.md(?:\?raw)?$/ }, async (args) => ({
      contents:
        "export default " +
        JSON.stringify(await Bun.file(args.path.replace(/\?raw$/, "")).text()),
      loader: "js",
    }));
  },
});
const fromRelease = (path) => import(join(release, path));
const { withTeachingDraftGate } = await fromRelease(
  "web/src/keating/judgement/draft-gate.ts",
);
const { composeKeatingSystemPrompt } = await fromRelease(
  "web/src/keating/browser-tools/prompt.ts",
);
const { DEFAULT_TEACHER_PERSONA } = await fromRelease(
  "web/src/keating/persona.ts",
);
const { createSystemOneCaller } = await fromRelease(
  "packages/learner-contracts/src/judgement/system-one.ts",
);
const { createBenchmarkRegistry } = await fromRelease(
  "scripts/prompt-adherence/providers.ts",
);
const { streamSimple } = await fromRelease(
  "node_modules/@earendil-works/pi-ai/dist/compat.js",
);
const registry = await createBenchmarkRegistry(
  join(checkout, ".keating/pi-config"),
);
const modelKey = Bun.spawnSync(
  ["rtk", "proxy", "skate", "get", "typesafe_api_key@secrets"],
  { stdout: "pipe", stderr: "pipe" },
);
const jevKey =
  process.env.TYPESAFE_API_KEY ||
  (modelKey.exitCode === 0 ? modelKey.stdout.toString().trim() : "");
if (!jevKey) throw Error("TypeSafe credential unavailable");
const systemPrompt = readFileSync(join(scratch, "system-prompt.txt"), "utf8");
const metadata = json(join(scratch, "system-prompt.txt.metadata.json"));
const schemas = readFileSync(join(scratch, "tool-schemas.json"), "utf8");
if (
  !metadata.verifiedEqualToOriginalWebBuilder ||
  sha(systemPrompt) !== metadata.promptSha256 ||
  sha(schemas) !== metadata.toolSchemas.sha256
)
  throw Error("Prompt export mismatch");
const tools = JSON.parse(schemas).map((tool) => tool.function);
const basePrompt = composeKeatingSystemPrompt(DEFAULT_TEACHER_PERSONA);
const ledgerFile = join(dest, "budget.json");
const ledger = existsSync(ledgerFile) ? json(ledgerFile) : [];
// Reserve list-price upper bounds synchronously before dispatch. Keep the whole reservation on missing usage.
function reserve(kind, label, upper) {
  if (ledger.reduce((sum, c) => sum + c.accountedUsd, 0) + upper > 2)
    throw Error("Budget exhausted");
  const call = {
    kind,
    label,
    reservedUsd: upper,
    accountedUsd: upper,
    measured: false,
  };
  ledger.push(call);
  save(ledgerFile, ledger);
  return (usage) => {
    if (Number.isFinite(usage) && usage >= 0) {
      call.accountedUsd = usage;
      call.measured = true;
      if (usage > upper) {
        save(ledgerFile, ledger);
        throw Error("Unexpected usage above reservation");
      }
    }
    save(ledgerFile, ledger);
  };
}
const shaObj = (obj) => sha(JSON.stringify(obj));
const publicText = (msg) =>
  msg.content
    .filter((x) => x.type === "text")
    .map((x) => x.text)
    .join("\n");
function actorRecord(msg) {
  const err = String(msg.errorMessage || "");
  return {
    text: publicText(msg),
    toolNames: msg.content
      .filter((x) => x.type === "toolCall")
      .map((x) => x.name),
    requestedModel: msg.model,
    responseModel: msg.responseModel || null,
    stop: msg.stopReason,
    errorClass:
      msg.stopReason !== "error"
        ? null
        : /balanc|credit|funds|paid|402/i.test(err)
          ? "billing"
          : /authori|key|401|403/i.test(err)
            ? "authorization"
            : /429|rate.limit/i.test(err)
              ? "rate-limit"
              : "provider",
    usage:
      msg.usage?.totalTokens > 0
        ? {
            input: msg.usage.input,
            output: msg.usage.output,
            cacheRead: msg.usage.cacheRead,
            cacheWrite: msg.usage.cacheWrite,
          }
        : null,
  };
}
let actorDisabled = new Set();
async function makeActor(model) {
  const auth = await registry.getApiKeyAndHeaders(model);
  const google = model.provider === "google";
  const endpoint = google
    ? "https://generativelanguage.googleapis.com/v1beta"
    : "https://api.minimax.io/anthropic";
  if (model.baseUrl !== endpoint) throw Error("Unexpected tutor endpoint");
  const saved = Bun.spawnSync(
    [
      "rtk",
      "proxy",
      "skate",
      "get",
      (google ? "gemini" : "minimax") + "@secrets",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const apiKey =
    auth.apiKey || (saved.exitCode === 0 ? saved.stdout.toString().trim() : "");
  if (!apiKey) throw Error("Tutor credential unavailable");
  return (context, options, label, completed) => {
    if (actorDisabled.has(model.id))
      throw Error("Model disabled after a provider refusal");
    const settle = reserve("actor", label, 0.12);
    const stream = streamSimple(model, context, {
      ...options,
      apiKey,
      headers: auth.headers,
      env: auth.env,
      maxTokens: 3072,
      temperature: 0,
      maxRetries: 0,
      maxRetryDelayMs: 0,
      timeoutMs: 60_000,
      cacheRetention: "none",
      onPayload: async (payload, m) => {
        const proposed = await options?.onPayload?.(payload, m);
        if (Buffer.byteLength(JSON.stringify(proposed ?? payload)) > 160000)
          throw Error("Payload exceeds cost envelope");
        return proposed ?? payload;
      },
    });
    stream.result().then((msg) => {
      const rec = actorRecord(msg);
      const u = rec.usage;
      // Max model-specific rate across uncached input and cache writes, with no cache discount.
      const inputRate = model.id.endsWith("highspeed") ? 0.6 : 0.25;
      const outputRate = model.id.endsWith("highspeed") ? 2.4 : 1.5;
      settle(
        u
          ? ((u.input + u.cacheRead + u.cacheWrite) * inputRate +
              u.output * outputRate) /
              1e6
          : null,
      );
      if (
        rec.errorClass &&
        ["billing", "authorization"].includes(rec.errorClass)
      )
        actorDisabled.add(model.id);
      completed(rec);
    });
    return stream;
  };
}
const repeat = process.env.KEATING_AUDIT_REPEAT;
if (repeat !== undefined && !["1", "2", "3"].includes(repeat))
  throw Error("Unknown repeat");
async function run(model, actor, scenario) {
  const id =
    model.id + "--" + scenario.id + (repeat ? "--repeat-" + repeat : "");
  const file = join(dest, id + ".json");
  if (existsSync(file)) return;
  const row = {
    id,
    cohort: repeat ? "default-repeat" : "primary",
    scenario: scenario.id,
    model: model.id,
    startedAt: new Date().toISOString(),
    judge: [],
    drafts: [],
    counterfactual: null,
    decision: null,
    offer: null,
    phase: null,
    selection: null,
    reason: null,
    release: null,
    publicText: null,
    checks: [],
  };
  const judgeCall = createSystemOneCaller({
    apiKey: jevKey,
    model: "jev-latest",
    requireResolvedModel: true,
    retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    fetch: async (url, opts) => {
      if (
        Buffer.byteLength(opts.body) > 150000 ||
        new URL(url).hostname !== "api.typesafe.ai"
      )
        throw Error("Unexpected judgement envelope");
      const settle = reserve("jev", id, 0.012);
      const resp = await fetch(url, opts);
      if (resp.ok) {
        const data = await resp.clone().json();
        const n = data.usage?.input_tokens ?? data.usage?.inputTokens;
        settle(Number.isFinite(n) ? (n * 0.042) / 1e6 : null);
      }
      return resp;
    },
  });
  let baseContext, baseOpts, last, published;
  const judge = async (req, signal) => {
    const res = await judgeCall(req, signal);
    const phase = Object.hasOwn(req.questions, "learning_task")
      ? "plan"
      : Object.hasOwn(req.questions, "draft_choice")
        ? "select"
        : "review";
    row.judge.push({
      phase,
      hash: shaObj(req),
      model: res.ok ? res.response.backend.model : null,
      error: res.ok ? null : res.error.code,
      usage: res.ok ? res.response.usage : null,
      answers: phase === "plan" && res.ok ? res.response.answers : undefined,
    });
    return res;
  };
  const gate = withTeachingDraftGate(
    (_model, ctx, opts) => {
      const n = row.drafts.length + 1;
      const d = {
        attempt: n,
        systemSha: sha(ctx.systemPrompt),
        messagesSha: shaObj(ctx.messages),
        toolsSha: shaObj(ctx.tools),
        response: null,
      };
      row.drafts.push(d);
      if (n === 1) {
        row.directives = ctx.systemPrompt
          .split("\n")
          .filter((line) => line.startsWith("- "))
          .filter(
            (line) =>
              ctx.systemPrompt.indexOf("\n" + line) <
              ctx.systemPrompt.indexOf("\n\nResponse scope:"),
          );
        const matches =
          ctx.systemPrompt.match(
            /^- At most one OpenUI activity may help this turn:.*$/gm,
          ) || [];
        if (matches.length > 1) throw Error("Ambiguous offer");
        row.offer = matches[0] ?? null;
        if (row.offer) {
          baseContext = structuredClone(ctx);
          baseContext.systemPrompt = ctx.systemPrompt.replace(
            row.offer + "\n",
            "",
          );
          baseOpts = { reasoning: opts?.reasoning };
        }
      }
      return actor(ctx, opts, id + " draft " + n, (r) => {
        d.response = r;
      });
    },
    {
      sessionId: id,
      basePrompt: () => basePrompt,
      makeCaller: () => judge,
      ...(repeat ? {} : { maxAttempts: 3 }),
      timeoutMs: 90_000,
      refinement: "ordinary",
      judgementModel: {
        id: "jev-latest",
        requestTokens: 64000,
        stateQuestionTokens: 32000,
      },
      onProgress: (s) => {
        last = s;
      },
      onReleasedReply: (r) => {
        published = { text: r.text, unverified: r.unverified };
      },
    },
  );
  const publicStream = await gate(
    model,
    {
      systemPrompt,
      messages: [{ role: "user", timestamp: 1, content: scenario.prompt }],
      tools,
    },
    {},
  );
  const message = await publicStream.result();
  row.phase = last?.phase;
  row.reason = last?.reason;
  row.selection = last?.selectedAttempt;
  row.decision = last?.interaction ?? null;
  row.checks =
    last?.attempts.map((x) => ({
      attempt: x.attempt,
      status: x.status,
      checks: x.checks
        .filter((c) => c.status !== "pass")
        .map((c) => ({
          id: c.id,
          status: c.status,
          probability: c.probability,
        })),
    })) ?? [];
  row.release = published ?? null;
  row.publicText = publicText(message);
  row.publicToolNames = message.content
    .filter((x) => x.type === "toolCall")
    .map((x) => x.name);
  if (!repeat && baseContext && !actorDisabled.has(model.id)) {
    const stream = actor(baseContext, baseOpts, id + " offer removed", (r) => {
      row.counterfactual = {
        systemSha: sha(baseContext.systemPrompt),
        messagesSha: shaObj(baseContext.messages),
        toolsSha: shaObj(baseContext.tools),
        response: r,
      };
    });
    await stream.result();
  }
  row.finishedAt = new Date().toISOString();
  save(file, row);
  console.log(
    JSON.stringify({
      id,
      judge: row.judge[0]?.model || row.judge[0]?.error,
      decision: row.decision?.action,
      attempts: row.drafts.length,
      selected: row.selection,
      phase: row.phase,
      first: row.drafts[0]?.response?.stop,
      wireModel: row.drafts[0]?.response?.responseModel,
      counter: row.counterfactual?.response?.stop,
      reason: row.reason,
    }),
  );
}
const actors = new Map();
for (const id of modelIds) {
  const m = registry.find(id.startsWith("gemini") ? "google" : "minimax", id);
  if (!m) throw Error("Model unavailable " + id);
  actors.set(id, { model: m, actor: await makeActor(m) });
}
const selected = repeat
  ? ["prediction"]
  : (process.env.KEATING_AUDIT_CASE?.split(",") ?? scenarios.map((s) => s.id));
for (const scenario of scenarios.filter((s) => selected.includes(s.id))) {
  await Promise.all(
    Array.from(actors.values())
      .filter(({ model }) => !actorDisabled.has(model.id))
      .map(({ model, actor }) => run(model, actor, scenario)),
  );
  if (actorDisabled.size === actors.size) break;
  const files = modelIds
    .map((m) => join(dest, m + "--" + scenario.id + ".json"))
    .filter(existsSync);
  if (
    files.length &&
    files.every(
      (f) => json(f).judge.length && json(f).judge.every((x) => x.error),
    )
  )
    break;
}
