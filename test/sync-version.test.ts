import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

test("version check reports drift without writing, while sync repairs all targets", () => {
  const directory = mkdtempSync(join(tmpdir(), "keating-version-check-"));
  const fixtures: Record<string, string> = {
    "web/package.json": '{"version": "1.0.0"}\n',
    "mobile/package.json": '{"version": "1.0.0"}\n',
    "mobile/app.json": '{"expo": {"version": "1.0.0"}}\n',
    "desktop/package.json": '{"version": "1.0.0"}\n',
    "packages/design-contract/package.json": '{"version": "1.0.0"}\n',
    "packages/browser-agent-runtime/package.json": '{"version": "1.0.0"}\n',
    "src/core/version.ts": 'export function version() { return "1.0.0"; }\n',
    "bin/keating.js": 'const KEATING_VERSION = "1.0.0";\n',
    "web/index.html": '{"softwareVersion": "1.0.0"}\n',
    "web/src/components/ChatIntro.tsx": 'const banner = "INIT SEQUENCE v1.0.0";\n',
    "web/src/og-image.tsx": 'const badge = <span>v1.0.0</span>;\n',
  };
  const run = (...args: string[]) => spawnSync(process.execPath, [join(import.meta.dir, "../scripts/sync-version.ts"), ...args], {
    cwd: directory, encoding: "utf8", timeout: 10_000,
  });
  try {
    writeFileSync(join(directory, "package.json"), '{"version": "4.0.0"}\n');
    for (const [path, content] of Object.entries(fixtures)) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), content);
    }
    const check = run("--check");
    expect(check.error).toBeUndefined();
    expect(check.status).toBe(1);
    expect(check.stdout).toContain("11 file(s) out of sync");
    for (const [path, content] of Object.entries(fixtures)) expect(readFileSync(join(directory, path), "utf8")).toBe(content);
    const sync = run();
    expect(sync.error).toBeUndefined();
    expect(sync.status).toBe(0);
    for (const [path, content] of Object.entries(fixtures)) expect(readFileSync(join(directory, path), "utf8")).toBe(content.replace("1.0.0", "4.0.0"));
    expect(run("--check").status).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
