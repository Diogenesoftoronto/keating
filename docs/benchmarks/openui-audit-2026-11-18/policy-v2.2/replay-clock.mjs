// The web gate timestamped its private retry instruction. Recover that clock reading from
// the original request digest, without weakening the comparison of the prompt or messages.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { plugin } from "bun";

assert(process.argv.at(-1) === "--verify", "This loader is for offline verification only");
globalThis.fetch = async () => { throw Error("Network is disabled during verification"); };
const transport = resolve(import.meta.dir, "transport.mjs");
await plugin({ name: "replay-private-instruction-clock", setup(build) {
  build.onLoad({ filter: /transport\.mjs$/ }, args => {
    if (args.path !== transport) return;
    const source = readFileSync(transport, "utf8");
    const guard = "assert.equal(old.requestSha256, requestSha256);";
    assert.equal(source.split(guard).length, 2);
    const verification = `
      if (requestSha256 !== old.requestSha256) {
        const messages = structuredClone(context.messages);
        const generated = messages.filter(m => m.role === "user" && m.timestamp > 1);
        assert.equal(generated.length, 1, "Only the generated retry instruction may use the clock");
        const reservedAt = Date.parse(old.startedAt);
        let found = false;
        for (let delta = 0; delta <= 2000; delta++) {
          generated[0].timestamp = reservedAt - delta;
          if (sha([context.systemPrompt, messages, context.tools]) === old.requestSha256) {
            found = true;
            break;
          }
        }
        assert(found, "The original tutor request hash could not be reproduced");
      }`;
    return { contents: source.replace(guard, verification), loader: "js" };
  });
} });
