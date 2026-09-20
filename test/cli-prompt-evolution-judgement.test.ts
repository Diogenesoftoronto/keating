import { afterEach, expect, test } from "bun:test";
import { webcrypto } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureProjectScaffold, evolvePromptArtifact } from "../src/core/project.js";
import { NOTORGANIC_AUTH_ENV } from "../src/core/notorganic-auth.js";
import { promptEvolutionDir } from "../src/core/paths.js";
import type { CliPromptEvolutionOptions } from "../src/judgement/cli-prompt-evolution.js";
import { setEvaluationObservationExporterForTests } from "../src/observability/arize.js";
import type { EvaluationObservationV1 } from "../src/observability/types.js";

const directories: string[] = [];
afterEach(async () => { setEvaluationObservationExporterForTests(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const baseline = "Diagnose prerequisites before teaching. Require independent retrieval. Verify claims. Ask for transfer and an explanation in the learner's own words. Adapt after a checkpoint.";
async function fixture(mode: "good" | "regression" | "unavailable" | "late-failure" | "drift" = "good") {
  const cwd = await mkdtemp(join(tmpdir(), "keating-prompt-evolution-")); directories.push(cwd);
  await ensureProjectScaffold(cwd);
  const sourcePath = join(cwd, "pi/prompts/learn.md");
  await mkdir(join(cwd, "pi/prompts"), { recursive: true });
  await writeFile(sourcePath, baseline);
  const key = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const now = 1_800_000_000_000;
  const credential = { accessToken: "PRIVATE_TOKEN", env: {
    [NOTORGANIC_AUTH_ENV.issuer]: "https://account.example", [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(await webcrypto.subtle.exportKey("jwk", key.privateKey)),
    [NOTORGANIC_AUTH_ENV.scope]: "judgement:evaluate", [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP", [NOTORGANIC_AUTH_ENV.expiresAt]: String(now + 300_000),
  } };
  let calls = 0, generations = 0;
  const options: CliPromptEvolutionOptions = {
    env: { KEATING_PROMPT_JUDGE: "notorganic" }, iterations: 2,
    generator: async (_cwd, prompt, _evaluation, iteration) => { generations++; return `${prompt}\nCandidate ${iteration}.`; },
    transport: { now: () => now, loadCredential: () => credential, retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 }, fetch: async (_url, init) => {
      calls++;
      if (mode === "unavailable" || (mode === "late-failure" && calls > 1)) return { ok: false, status: 503, json: async () => ({ private: "PRIVATE_ERROR" }) };
      const request = JSON.parse(init.body);
      const state = typeof request.state === "string" ? JSON.parse(request.state) : request.state;
      const candidate = state.promptText.includes("Candidate");
      const level = mode === "regression" ? candidate ? 1 : 3 : candidate ? 3 : 2;
      const answers = Object.fromEntries(Object.entries(request.questions as Record<string, { type: string; criteria: string[] | Record<string, null> }>).map(([name, question]) => {
        const keys = Object.keys(question.criteria);
        return [name, question.type === "score" ? { type: "score", score: level, confidence: 1, legend: Object.fromEntries(Object.entries(question.criteria)), probabilities: Object.fromEntries(keys.map(key => [key, Number(key) === level ? 1 : 0])) }
          : { type: "choice", choice: keys[0], confidence: 1, probabilities: Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 1 : 0])) }];
      }));
      return { ok: true, status: 200, json: async () => ({ model: mode === "drift" && calls > 1 ? "jev-changed" : "jev-prompt-v1", answers }) };
    } },
  };
  return { cwd, sourcePath, options, calls: () => calls, generations: () => generations };
}

test("production prompt evolution uses one independent judge while preserving proposal generation, acceptance and source prompt", async () => {
  const f = await fixture();
  const events: EvaluationObservationV1[] = [];
  setEvaluationObservationExporterForTests(async event => { events.push(event); throw new Error("private exporter failure"); });
  const result = await evolvePromptArtifact(f.cwd, "learn", "cli", f.options);
  expect(result.source).toBe("proxy"); expect(result.accepted).toBe(true); expect(result.bestScore).toBe(100);
  expect(f.calls()).toBe(3); expect(f.generations()).toBe(2);
  expect(await readFile(f.sourcePath, "utf8")).toBe(baseline);
  expect(await readFile(result.evolvedPromptPath, "utf8")).toContain("Candidate 1");
  expect(await readFile(result.reportPath, "utf8")).toContain("Uncalibrated model estimates");
  const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
  expect(receipt.backend.model).toBe("jev-prompt-v1"); expect(receipt.evaluations).toHaveLength(3);
  expect(receipt.evaluations.every((value: any) => value.review.source === "proxy")).toBe(true);
  expect((await stat(result.receiptPath)).mode & 0o777).toBe(0o600);
  expect(JSON.stringify(receipt)).not.toContain("PRIVATE_");
  expect(events[0]).toMatchObject({ engine: "typed-judgement", backend: "system-one", model: "jev-prompt-v1", candidate_count: 2 });
  expect(JSON.stringify(events)).not.toContain(baseline);
});

test("typed regressive winner still fails the existing baseline gate", async () => {
  const f = await fixture("regression");
  const result = await evolvePromptArtifact(f.cwd, "learn", "cli", f.options);
  expect(result.accepted).toBe(false);
  expect(await readFile(result.evolvedPromptPath, "utf8")).toBe(baseline);
  expect(await readFile(f.sourcePath, "utf8")).toBe(baseline);
});

for (const disabled of [true, false]) test(`${disabled ? "off" : "unavailable baseline"} keeps the entire run on labeled heuristics`, async () => {
  const f = await fixture("unavailable");
  const result = await evolvePromptArtifact(f.cwd, "learn", "cli", { ...f.options, ...(disabled ? { env: {} } : {}) });
  expect(result.source).toBe("heuristic"); expect(f.calls()).toBe(disabled ? 0 : 1); expect(f.generations()).toBe(2);
  const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
  expect(receipt.evaluations.every((value: any) => value.review.source === "heuristic")).toBe(true);
  expect(await readFile(result.reportPath, "utf8")).toContain("Heuristic keyword baseline throughout this comparison");
});

for (const mode of ["late-failure", "drift"] as const) test(`${mode} persists raw attempts and cannot save a mixed-source winner`, async () => {
  const f = await fixture(mode);
  await expect(evolvePromptArtifact(f.cwd, "learn", "cli", f.options)).rejects.toThrow("Prompt evolution stopped");
  expect(f.generations()).toBe(1); expect(f.calls()).toBe(2);
  expect(await readFile(f.sourcePath, "utf8")).toBe(baseline);
  const directory = promptEvolutionDir(f.cwd);
  const files = await readdir(directory);
  const receiptFile = files.find(file => file.endsWith("-judgement.json"))!;
  expect(receiptFile).toBeDefined(); expect(files).not.toContain("learn.evolved.md");
  const receipt = JSON.parse(await readFile(join(directory, receiptFile), "utf8"));
  expect(receipt.aborted).toBe(true); expect(receipt.evaluations).toHaveLength(2);
  expect(receipt.evaluations[0].review.source).toBe("proxy");
});
