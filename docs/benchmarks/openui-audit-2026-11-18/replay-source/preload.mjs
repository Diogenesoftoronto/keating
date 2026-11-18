// Original verifier entrypoints only. First-party imports resolve inside the private replay tree.
import { plugin } from "bun";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { hashFile, manifestDigest, privatePath, read, sha } from "./tree.mjs";

const audit = resolve(import.meta.dir, ".."), root = resolve(audit, "../../..");
const mode = process.argv.slice(2), entry = relative(audit, resolve(process.argv[1]));
const allowed = ["policy-holdout/run.mjs", "policy-holdout/resume.mjs", "gemini-decision/run.mjs", "gemini-decision/comparison.mjs",
  "gemini-decision/frozen/replay.mjs", "gemini-decision/frozen/perimeter.mjs", "policy-v2.1/run.mjs", "policy-v2/run-followup.mjs", "cue-paraphrases/run.mjs"];
const marker = process.env.KEATING_ARCHIVE_MODULE_RECEIPT;
if (mode.length !== 1 || mode[0] !== "--verify" || !allowed.includes(entry) || !marker || dirname(marker) !== root
  || !basename(root).startsWith("keating-historical-openui-") || !/^[a-z0-9.-]+-modules\.json$/.test(basename(marker))) {
  throw Error("The archived source is available only to verify-historical.mjs --verify children.");
}
const path = join(import.meta.dir,"source-manifest.json");
if (hashFile(path) !== manifestDigest) throw Error("Historical source manifest was modified");
const manifest = read(path);
const pins = {...manifest.sourceSha256, [manifest.diagnostic.path]:manifest.diagnostic.sha256};
if (entry === "policy-v2/run-followup.mjs") Object.assign(pins,read(join(audit,"policy-v2/evidence.json")).sourceHashes);
const loaded = {};
await plugin({name:"keating-historical-source",setup(builder) {
  builder.onResolve({filter:/^@keating\/(?:learner-contracts|runtime-config)$/}, ({path}) => ({
    path:privatePath(root,join("packages",path.slice("@keating/".length),"src/index.ts")),
  }));
  builder.onLoad({filter:/[\\/](?:openui-diagnostic-turn|draft-gate|teaching-policy)\.ts$/}, ({path}) => {
    const file = relative(root, realpathSync(path));
    if (!Object.hasOwn(pins,file)) throw Error("Historical source resolved outside the replay tree: " + file);
    const bytes = readFileSync(privatePath(root,file));
    const digest = sha(bytes);
    if (digest !== pins[file]) throw Error("Loaded source differs from its historical checksum: " + file);
    loaded[file] = digest;
    writeFileSync(privatePath(root,basename(marker)), JSON.stringify(loaded));
    return {contents:bytes, loader:"ts"};
  });
} });
globalThis.fetch = () => { throw Error("The historical verification process is offline."); };
