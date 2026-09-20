import { afterEach, expect, test } from "bun:test";
import { webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promptEvalArtifact } from "../src/core/project.js";
import { NOTORGANIC_AUTH_ENV } from "../src/core/notorganic-auth.js";
import type { CliPromptEvaluationOptions } from "../src/judgement/cli-prompt-evaluation.js";
import { setEvaluationObservationExporterForTests } from "../src/observability/arize.js";
import type { EvaluationObservationV1 } from "../src/observability/types.js";

const directories: string[] = [];
afterEach(async () => { setEvaluationObservationExporterForTests(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const prompt = "Ask for an independent explanation. Diagnose prerequisites. Verify sources. Require unaided retrieval. Test transfer. Adapt after a checkpoint.";
async function setup(unavailable = false) {
  const cwd = await mkdtemp(join(tmpdir(), "keating-prompt-eval-")); directories.push(cwd);
  const key = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const now = 1_800_000_000_000;
  const credential = { accessToken: "PRIVATE_ACCOUNT_TOKEN", env: {
    [NOTORGANIC_AUTH_ENV.issuer]: "https://account.example", [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(await webcrypto.subtle.exportKey("jwk", key.privateKey)),
    [NOTORGANIC_AUTH_ENV.scope]: "infer:balanced judgement:evaluate", [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP", [NOTORGANIC_AUTH_ENV.expiresAt]: String(now + 300_000),
  } };
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const options: CliPromptEvaluationOptions = { env: { KEATING_PROMPT_JUDGE: "notorganic", KEATING_JUDGEMENT_MODEL: "jev-concrete-prompt", TYPESAFE_API_KEY: "PRIVATE_DIRECT_KEY", KEATING_JUDGEMENT_ENDPOINT: "https://evil.example", KEATING_JUDGEMENT_DIRECT: "true" }, transport: {
    now: () => now, loadCredential: () => credential, retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); calls.push({ url, body, headers: init.headers });
      if (unavailable) return { ok: false, status: 503, json: async () => { throw new Error("PRIVATE_BODY"); } };
      const answers = Object.fromEntries(Object.entries(body.questions as Record<string, { type: string; criteria: string[] | Record<string, unknown> }>).map(([key, question]) => {
        const keys = Object.keys(question.criteria);
        if (question.type === "score") return [key, { type: "score", score: 3, confidence: 1, probabilities: Object.fromEntries(keys.map((key) => [key, key === "3" ? 1 : 0])), legend: Object.fromEntries(Object.entries(question.criteria)) }];
        return [key, { type: "choice", choice: keys[0], confidence: 1, probabilities: Object.fromEntries(keys.map((key, index) => [key, index === 0 ? 1 : 0])) }];
      }));
      return { ok: true, status: 200, json: async () => ({ model: "jev-concrete-prompt", answers }) };
    },
  } };
  return { cwd, options, calls };
}

test("actual CLI prompt artifact uses independent DPoP judge and saves private raw evidence separately", async () => {
  const { cwd, options, calls } = await setup();
  const events: EvaluationObservationV1[] = [];
  setEvaluationObservationExporterForTests(async (event) => { events.push(event); });
  const result = await promptEvalArtifact(cwd, prompt, "pi", options);
  expect(result.source).toBe("proxy"); expect(result.score).toBe(100);
  expect(calls).toHaveLength(1); expect(calls[0]!.url).toBe("https://account.example/v1/judgement");
  expect(calls[0]!.headers.authorization).toBe("DPoP PRIVATE_ACCOUNT_TOKEN"); expect(calls[0]!.headers.dpop).toBeTruthy();
  expect((typeof calls[0]!.body.state === "string" ? JSON.parse(calls[0]!.body.state) : calls[0]!.body.state).promptText).toBe(prompt); expect(Object.keys(calls[0]!.body.questions)).toHaveLength(12);
  const saved = JSON.parse(await readFile(result.receiptPath, "utf8"));
  expect(saved.judgement.backend.model).toBe("jev-concrete-prompt"); expect(saved.judgement.calibration).toBe("uncalibrated");
  expect(saved.judgement.outcome.response.answers["score:diagnosis"].probabilities).toEqual({ "0": 0, "1": 0, "2": 0, "3": 1 });
  expect((await stat(result.receiptPath)).mode & 0o777).toBe(0o600);
  expect(await readFile(result.reportPath, "utf8")).toContain("uncalibrated model estimate");
  expect(result.feedback[0]).toContain("Uncalibrated");
  expect(events[0]).toMatchObject({ engine: "typed-judgement", model: "jev-concrete-prompt", backend: "system-one", surface: "pi" });
  expect(JSON.stringify(events)).not.toContain(prompt); expect(JSON.stringify(saved)).not.toContain("PRIVATE_");
});

test("explicit prompt evaluator defaults to a labeled heuristic without invoking a tutor or provider", async () => {
  const { cwd, options, calls } = await setup();
  const result = await promptEvalArtifact(cwd, prompt, "cli", { ...options, env: {} });
  expect(result.source).toBe("heuristic"); expect(calls).toHaveLength(0);
  expect(result.judgement.status).toBe("not-requested");
  expect(await readFile(result.reportPath, "utf8")).toContain("heuristic keyword baseline");
});

test("provider outage and missing credentials retain heuristic artifacts without raw error text", async () => {
  const { cwd, options } = await setup(true);
  const unavailable = await promptEvalArtifact(cwd, prompt, "cli", options);
  expect(unavailable.source).toBe("heuristic"); expect(unavailable.judgement.status).toBe("unavailable");
  const missing = await promptEvalArtifact(cwd, prompt, "cli", { ...options, transport: { loadCredential: () => { throw new Error("PRIVATE_CREDENTIAL_ERROR"); } } });
  expect(missing.source).toBe("heuristic"); expect(missing.judgement.status).toBe("unavailable");
  expect(JSON.stringify(missing)).not.toContain("PRIVATE_CREDENTIAL_ERROR");
});
