// Replays the recorded providers through the application sources used for this run.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { auditPath, hashFile, prepareTree, privatePath, read, restoreVersion21 } from "../replay-source/tree.mjs";

assert.equal(process.argv.length, 2);
const here = import.meta.dir;
const hashes = join(here, "evidence-sha256.json");
assert.equal(hashFile(hashes), "bb1166cb91a2d9a3299a3d3181285233aa30083ca33618b874159d12dede0ca4");
const files = read(hashes);
for (const [file, digest] of Object.entries(files)) assert.equal(hashFile(join(here, file)), digest, file);
const scratch = mkdtempSync(join(tmpdir(), "keating-interface-replay-"));
try {
  prepareTree(resolve(here, "../../../.."), scratch);
  // Pin the operator decoder, aggregator and observers too. The 85 archived
  // teaching sources below take precedence and the runner checks every original result.
  restoreVersion21(scratch);
  const study = join(auditPath, "policy-v2.2");
  for (const file of [...Object.keys(files), "replay-clock.mjs"]) {
    const dest = privatePath(scratch, join(study, file));
    mkdirSync(dirname(dest), {recursive:true});
    copyFileSync(join(here, file), dest);
  }
  const sources = JSON.parse(gunzipSync(readFileSync(join(here, "source.json.gz"))));
  for (const [file, source] of Object.entries(sources)) {
    const dest = privatePath(scratch, file);
    mkdirSync(dirname(dest), {recursive:true});
    writeFileSync(dest, source);
  }
  const result = Bun.spawnSync([process.execPath, "--preload", join(scratch, study, "replay-clock.mjs"),
    join(scratch, study, "run.mjs"), "--verify"], { cwd:scratch, stdout:"inherit", stderr:"inherit" });
  assert.equal(result.exitCode, 0);
} finally {
  rmSync(scratch, { recursive:true, force:true });
}
