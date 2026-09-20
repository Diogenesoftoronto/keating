import { afterEach, expect, test } from "bun:test";
import { webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planTopicArtifact } from "../src/core/project.js";
import { plansDir } from "../src/core/paths.js";
import { NOTORGANIC_AUTH_ENV } from "../src/core/notorganic-auth.js";
import type { CliLessonPlanReviewOptions } from "../src/judgement/cli-lesson-plan.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup(change = false) {
  const cwd = await mkdtemp(join(tmpdir(), "keating-plan-review-")); dirs.push(cwd);
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]), now = 1_800_000_000_000;
  const credential = { accessToken: "PRIVATE_FIXTURE_TOKEN", env: {
    [NOTORGANIC_AUTH_ENV.issuer]: "https://plan.example", [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(await webcrypto.subtle.exportKey("jwk", pair.privateKey)),
    [NOTORGANIC_AUTH_ENV.scope]: "judgement:evaluate", [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP", [NOTORGANIC_AUTH_ENV.expiresAt]: String(now + 300_000),
  } };
  let calls = 0; let saved = "";
  const options: CliLessonPlanReviewOptions = { env: { KEATING_LESSON_PLAN_JUDGE: "notorganic", KEATING_JUDGEMENT_MODEL: "jev-plan-test", TYPESAFE_API_KEY: "PRIVATE_DIRECT_KEY", KEATING_JUDGEMENT_ENDPOINT: "https://unwanted.example" }, transport: {
    now: () => now, loadCredential: () => credential, retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    fetch: async (url, init) => {
      calls++; expect(url).toBe("https://plan.example/v1/judgement"); expect(init.headers.authorization).toBe("DPoP PRIVATE_FIXTURE_TOKEN");
      const path = join(plansDir(cwd), "recursion.md");
      saved = await readFile(path, "utf8"); expect(saved).toContain("Recursion");
      const body = JSON.parse(init.body);
      const answers = Object.fromEntries(Object.entries(body.questions as Record<string, { criteria: Record<string, string> }>).map(([id, question]) => {
        const keys = Object.keys(question.criteria); return [id, { type: "choice", choice: keys[0], confidence: 1, probabilities: Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 1 : 0])) }];
      }));
      if (change && calls === 2) await writeFile(path, `${saved}\nChanged by author.`, "utf8");
      return { ok: true, status: 200, json: async () => ({ model: "jev-plan-test", answers, usage: { input_tokens: 10 } }) };
    },
  } };
  return { cwd, options, calls: () => calls, saved: () => saved };
}
test("actual CLI plan artifact saves first and writes separate private review receipt using account opt-in", async () => {
  const f = await setup(), result = await planTopicArtifact(f.cwd, "recursion", f.options);
  expect(result.reviewStatus).toBe("estimated"); expect(f.calls()).toBe(2);
  expect(await readFile(result.planPath, "utf8")).toBe(f.saved());
  const receipt = JSON.parse(await readFile(result.reviewReceiptPath!, "utf8"));
  expect(receipt.backend.model).toBe("jev-plan-test"); expect(receipt.attempts).toHaveLength(2); expect(receipt.inputSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(receipt)).not.toContain("PRIVATE_"); expect((await stat(result.reviewReceiptPath!)).mode & 0o777).toBe(0o600);
  expect(await readFile(result.reviewPath!, "utf8")).toContain("Exact evidence plan:");
});
test("default plan creation makes no judgement request and source changes invalidate opt-in review", async () => {
  const off = await setup(), result = await planTopicArtifact(off.cwd, "recursion", { ...off.options, env: {} });
  expect(result.reviewStatus).toBe("not-requested"); expect(off.calls()).toBe(0); expect(result.reviewPath).toBeUndefined();
  const stale = await setup(true), reviewed = await planTopicArtifact(stale.cwd, "recursion", stale.options);
  expect(reviewed.reviewStatus).toBe("unavailable"); expect(JSON.parse(await readFile(reviewed.reviewReceiptPath!, "utf8"))).toMatchObject({ reason: "stale", findings: [] });
});
