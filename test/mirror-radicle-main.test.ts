import { expect, test } from "bun:test";
import { mirrorRadicleMain } from "../scripts/mirror-radicle-main";

const sha = "a".repeat(40);
const main = { PRE_COMMIT_REMOTE_BRANCH: "refs/heads/main", PRE_COMMIT_TO_REF: sha };
function fixture(existing = false) {
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    if (args.join(" ") === "git remote") return existing ? "origin\nrad" : "origin";
    if (args.includes("get-url")) return "rad://example";
    if (args[1] === "tag") return "v3.14.0\nv3.14.1";
    return "";
  };
  return { calls, run };
}

test("ignores non-main pushes, deletion, manual runs, and Radicle pushes", () => {
  for (const env of [{}, { ...main, PRE_COMMIT_REMOTE_BRANCH: "refs/tags/v3.14.1" },
    { ...main, PRE_COMMIT_TO_REF: "0".repeat(40) }, { ...main, PRE_COMMIT_REMOTE_NAME: "rad" },
    { ...main, PRE_COMMIT_REMOTE_URL: "rad://example" }]) {
    const { calls, run } = fixture();
    expect(mirrorRadicleMain(env, run)).toBe(false);
    expect(calls).toEqual([]);
  }
});

test("initializes privately and mirrors the pushed object even from another local branch", () => {
  const { calls, run } = fixture();
  mirrorRadicleMain({ ...main, PRE_COMMIT_LOCAL_BRANCH: "refs/heads/feature" }, run);
  expect(calls.find(args => args[0] === "rad" && args[1] === "init")).toContain("--private");
  expect(calls.at(-1)).toEqual(["git", "-c", "core.hooksPath=/dev/null", "push", "rad",
    `${sha}:refs/heads/main`, "refs/tags/v3.14.0:refs/tags/v3.14.0", "refs/tags/v3.14.1:refs/tags/v3.14.1"]);
});

test("reuses an existing Radicle remote", () => {
  const { calls, run } = fixture(true);
  mirrorRadicleMain(main, run);
  expect(calls.some(args => args[1] === "init")).toBe(false);
});

test("rejects invalid commit IDs and propagates initialization failure", () => {
  expect(() => mirrorRadicleMain({ ...main, PRE_COMMIT_TO_REF: "HEAD" }, fixture().run)).toThrow();
  const { calls, run } = fixture();
  expect(() => mirrorRadicleMain(main, args => {
    if (args[1] === "init") throw new Error("Signing identity locked");
    return run(args);
  })).toThrow("Signing identity locked");
  expect(calls.some(args => args.includes("push"))).toBe(false);
});
