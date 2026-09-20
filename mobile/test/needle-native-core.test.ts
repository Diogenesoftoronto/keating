import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import manifest from "../modules/keating-needle/assets.json";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../modules/keating-needle");

test("the compiled C API header is exactly the independently pinned upstream header", async () => {
  const header = await readFile(join(root, "cpp/needle.h"));
  expect(header.length).toBe(manifest.header.bytes);
  expect(createHash("sha256").update(header).digest("hex")).toBe(manifest.header.sha256);
});

test("native core compiles against the real header and bounds outputs, reuses one model and serializes calls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "keating-needle-core-"));
  try {
    await writeFile(join(directory, "needle_assets.h"), `#define KEATING_NEEDLE_MODEL_BYTES ${manifest.weights.bytes}\n`);
    await writeFile(join(directory, "check.cpp"), `
#include "NeedleEngine.hpp"
#include <atomic>
#include <cassert>
#include <thread>
#include <chrono>
static int loads = 0, inits = 0, mode = 0;
static std::atomic<int> concurrent{0}, maximum{0};
extern "C" int needle_load(const unsigned char* bytes, unsigned long long count) { assert(bytes && count == KEATING_NEEDLE_MODEL_BYTES); ++loads; return 0; }
extern "C" int needle_init(const char* system, const char* tools, const char*) { assert(std::string(system).empty()); assert(std::string(tools) == "[]"); ++inits; return 0; }
extern "C" int needle_embed(const char*, float* out, int capacity) {
  if (!out) return mode == 1 ? 5000 : 2;
  int busy = ++concurrent; if (busy > maximum) maximum = busy;
  std::this_thread::sleep_for(std::chrono::milliseconds(1));
  assert(capacity == 2); out[0] = mode == 2 ? NAN : .25f; out[1] = .75f;
  --concurrent; return mode == 3 ? 1 : 2;
}
int main() {
  std::vector<unsigned char> weights(KEATING_NEEDLE_MODEL_BYTES);
  const auto run = [&](const std::vector<std::string>& inputs) { return keating_needle::embed(weights.data(), weights.size(), inputs); };
  const auto rejects = [&](const std::vector<std::string>& inputs) { try { run(inputs); assert(false); } catch (const std::runtime_error&) {} };
  rejects({}); rejects({std::string(4097, 'a')}); rejects(std::vector<std::string>(17, "a"));
  rejects(std::vector<std::string>(5, std::string(4096, 'a'))); rejects({std::string({'a', char(0), 'b'})});
  assert(loads == 0);
  auto result = run({"one", "two"}); assert(result.size() == 2 && result[0].size() == 2);
  std::thread first([&] { run({"first"}); }), second([&] { run({"second"}); }); first.join(); second.join();
  assert(loads == 1 && inits == 1 && maximum == 1);
  for (mode = 1; mode <= 3; ++mode) rejects({"malformed output"});
}
`);
    const compiler = process.env.CXX || "g++";
    // A workstation's global include paths must not mix incompatible libc headers.
    const compilerEnv = { ...process.env };
    for (const key of ["CPATH", "C_INCLUDE_PATH", "CPLUS_INCLUDE_PATH", "OBJC_INCLUDE_PATH", "LIBRARY_PATH"]) delete compilerEnv[key];
    const compiled = spawnSync(compiler, ["-std=c++17", "-pthread", "-I", join(root, "cpp"), "-I", directory, join(directory, "check.cpp"), "-o", join(directory, "check")], { encoding: "utf8", timeout: 30_000, env: compilerEnv });
    expect(compiled.error?.message ?? compiled.stderr).toBe("");
    expect(compiled.status).toBe(0);
    const run = spawnSync(join(directory, "check"), [], { encoding: "utf8", timeout: 10_000 });
    expect(run.error?.message ?? run.stderr).toBe(""); expect(run.status).toBe(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 40_000);
