import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OfflineRuntime } from "../src/offline-runtime.js";
import { offlineLabelRequest, OFFLINE_JUDGEMENT_MODEL_ID } from "../src/offline-contract.js";

const directories: string[] = [];
const runtimes: OfflineRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.stop()));
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
const request = { requestId: "scoring-1", modelId: OFFLINE_JUDGEMENT_MODEL_ID, prompt: "Choose 0 or 1.", labelCount: 2 };
async function fixture(body: string, installed = true) {
  const directory = await mkdtemp(join(tmpdir(), "keating-scoring-"));
  directories.push(directory);
  const data = Buffer.from("test-weights");
  const model = { file: "test.litertlm", bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), url: "https://unused.invalid" };
  if (installed) await writeFile(join(directory, model.file), data);
  const executable = join(directory, "scorer");
  await writeFile(executable, `#!/usr/bin/env bun\n${body}\n`);
  await chmod(executable, 0o700);
  const runtime = new OfflineRuntime({ directory, executable, model, probe: async () => {} });
  runtimes.push(runtime);
  return runtime;
}

test("scoring contract bounds the native frame and refuses model substitution", () => {
  expect(offlineLabelRequest(request)).toEqual(request);
  for (const change of [{ modelId: "other-model" }, { labelCount: 1 }, { labelCount: 65 }, { labelCount: 2.5 },
    { prompt: "x".repeat(24001) }, { prompt: "hidden\0tail" }, { requestId: "../path" }, { file: "/tmp/model" }]) {
    expect(() => offlineLabelRequest({ ...request, ...change })).toThrow("Invalid offline scoring request");
  }
});

test("runtime returns ordered likelihoods with model identity", async () => {
  // This fixture tests process result validation; the Node smoke exercises stdin
  // with the real helper (Bun 1.3.13's spawn pipe writes are broken on this host).
  const runtime = await fixture("if (process.argv[2] !== '--score-labels') process.exit(2); console.log('[9,2]');");
  expect(await runtime.scoreLabels(request)).toEqual({ modelId: request.modelId, negativeLogLikelihoods: [9, 2] });
});

test("missing weights or an older/non-scoring helper abstains", async () => {
  expect(await (await fixture("process.exit(2)")).scoreLabels(request)).toBeNull();
  expect(await (await fixture("throw Error('must not execute')", false)).scoreLabels(request)).toBeNull();
});

test("malformed, negative and incomplete likelihood arrays cannot become confidence", async () => {
  for (const response of ["[1]", "[-1,2]", '["1",2]', "[1,null]", '{"score":1}']) {
    const runtime = await fixture(`console.log(${JSON.stringify(response)});`);
    expect(await runtime.scoreLabels(request)).toBeNull();
  }
});

test("request-scoped cancellation releases scoring without cancelling another request", async () => {
  const runtime = await fixture("await Bun.sleep(10000); console.log('[1,2]');");
  await runtime.status();
  const pending = runtime.scoreLabels(request);
  await runtime.cancelScoring("different-id");
  expect(await runtime.scoreLabels({ ...request, requestId: "second" })).toBeNull();
  await expect(runtime.generate({ prompt: "tutor" })).rejects.toThrow("busy");
  await runtime.cancelScoring(request.requestId);
  expect(await pending).toBeNull();
  await runtime.stop();
  expect(await runtime.scoreLabels(request)).toBeNull();
});
