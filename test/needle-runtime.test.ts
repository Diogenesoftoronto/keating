import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createNeedleCaller, loadNeedleConfig, needleModelIdentity, type NeedleRuntimeConfig } from "../src/retrieval/needle-runtime.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(body: string) {
  const cwd = await mkdtemp(join(tmpdir(), "needle-runtime-test-")); directories.push(cwd);
  const python = join(cwd, "fake-python");
  const receipt = join(cwd, "receipt.json");
  const config: NeedleRuntimeConfig = { python, engine: join(cwd, "engine"), weights: join(cwd, "weights"), engineSha256: "a".repeat(64), weightsSha256: "b".repeat(64) };
  await writeFile(python, `#!${process.execPath}\nimport {readFileSync,writeFileSync,fstatSync,readlinkSync} from 'node:fs';\nconst request=JSON.parse(readFileSync(0,'utf8'));\nconst model=${JSON.stringify(needleModelIdentity(config))};\nwriteFileSync(${JSON.stringify(receipt)},JSON.stringify({request,argv:process.argv,mode:fstatSync(0).mode & 511,path:readlinkSync('/proc/self/fd/0'),telemetry:process.env.NEEDLE_TELEMETRY,dnt:process.env.DO_NOT_TRACK,offline:process.env.HF_HUB_OFFLINE}));\n${body}\n`, { mode: 0o700 });
  await chmod(python, 0o700);
  return { cwd, config, receipt };
}

test.skipIf(process.platform !== "linux")("subprocess reads private stdin, excludes learner text from argv, opts out of telemetry and cleans up", async () => {
  const { config, receipt } = await fixture("console.log(JSON.stringify({model,vectors:request.input.texts.map(()=>[1,0,0]),selections:[]}));");
  const result = await createNeedleCaller(config)({ texts: ["PRIVATE learner evidence"] });
  expect(result?.vectors).toEqual([[1, 0, 0]]);
  const proof = JSON.parse(await readFile(receipt, "utf8"));
  expect(proof.request.input.texts).toEqual(["PRIVATE learner evidence"]);
  expect(JSON.stringify(proof.argv)).not.toContain("PRIVATE learner evidence");
  expect(proof).toMatchObject({ mode: 0o600, telemetry: "0", dnt: "1", offline: "1" });
  expect(await readFile(proof.path).catch(() => null)).toBeNull();
});

test.skipIf(process.platform !== "linux")("invalid identity, malformed vectors and process failures abstain", async () => {
  for (const body of [
    "console.log(JSON.stringify({model:'wrong',vectors:[[1]],selections:[]}));",
    "console.log(JSON.stringify({model,vectors:[[1],[1,2]],selections:[]}));",
    "console.log(JSON.stringify({model,vectors:[[null]],selections:[]}));",
    "console.log('private invalid output');",
    "process.exit(1);",
  ]) {
    const { config } = await fixture(body);
    expect(await createNeedleCaller(config)({ texts: ["one"] })).toBeNull();
  }
});

test.skipIf(process.platform !== "linux")("deadline kills the worker and removes its private request", async () => {
  const { config, receipt } = await fixture("setInterval(()=>{},1000);");
  expect(await createNeedleCaller(config, 300)({ texts: ["private"] })).toBeNull();
  const proof = JSON.parse(await readFile(receipt, "utf8"));
  expect(await readFile(proof.path).catch(() => null)).toBeNull();
});

test("missing executable and oversized requests abstain without exposing inputs", async () => {
  const config: NeedleRuntimeConfig = { python: "/missing/needle-python", engine: "/unused", weights: "/unused", engineSha256: "a".repeat(64), weightsSha256: "b".repeat(64) };
  const call = createNeedleCaller(config);
  expect(await call({ texts: ["input"] })).toBeNull();
  expect(await call({ texts: Array(161).fill("input") })).toBeNull();
  expect(await call({ texts: ["x".repeat(8193)] })).toBeNull();
});

test("production configuration requires absolute asset paths and full hashes", async () => {
  const { cwd, config } = await fixture("process.exit(0);");
  expect(await loadNeedleConfig(cwd)).toBeNull();
  await mkdir(join(cwd, ".keating/pi-config"), { recursive: true });
  const path = join(cwd, ".keating/pi-config/needle-runtime.json");
  await writeFile(path, JSON.stringify(config));
  expect(await loadNeedleConfig(cwd)).toEqual(config);
  await writeFile(path, JSON.stringify({ ...config, weights: "relative-path" }));
  expect(await loadNeedleConfig(cwd)).toBeNull();
  await writeFile(path, JSON.stringify({ ...config, engineSha256: "short" }));
  expect(await loadNeedleConfig(cwd)).toBeNull();
});
