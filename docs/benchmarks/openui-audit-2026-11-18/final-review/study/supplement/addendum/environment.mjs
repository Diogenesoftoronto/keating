import assert from "node:assert/strict";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { cohort as primary, read, sha } from "../../common.mjs";
export { root, read, sha, fileSha, usd, total, save, credential, stableContext, sanitizeMessage } from "../../common.mjs";

export const here = import.meta.dir;
const prior = read(join(here, "..", "prediction", "summary.json"));
export const cohort = { ...primary, priorBoundUsd: prior.totalBoundUsd, matrixAndClassroomTotalCeilingUsd: primary.allStudyLimitUsd };

export function inputBytes(wire) {
  const bytes = Buffer.from(wire);
  const digest = sha(bytes);
  const path = join(here, "wire", digest + ".json.gz");
  mkdirSync(join(here, "wire"), { recursive: true });
  if (!existsSync(path)) {
    const fd = openSync(path + ".tmp", "wx", 0o600);
    try { writeFileSync(fd, gzipSync(bytes)); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(path + ".tmp", path);
  }
  assert.equal(sha(gunzipSync(readFileSync(path))), digest);
  return digest;
}
