import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { H3Event } from "h3";

import {
  requireLocalExec,
  resolveCwdWithinRoot,
  resolveWritePathWithinRoot,
  runCommand,
} from "../../server/utils/local-exec";

function fakeLocalExecEvent({
  method = "POST",
  url = "http://127.0.0.1:3000/api/local-exec/exec",
  remoteAddress = "127.0.0.1",
  headers = {
    "content-type": "application/json",
    host: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    "sec-fetch-site": "same-origin",
  },
}: {
  method?: string;
  url?: string;
  remoteAddress?: string;
  headers?: Record<string, string | undefined>;
} = {}): H3Event {
  return {
    url: new URL(url),
    method,
    req: {
      method,
      url,
      headers: new Headers(
        Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    },
    node: {
      req: {
        headers,
        socket: { remoteAddress },
        url,
      },
    },
  } as unknown as H3Event;
}

describe("local exec utilities", () => {
  it("keeps cwd resolution inside the project root", async () => {
    const temp = await mkdtemp(join(tmpdir(), "keating-local-exec-"));
    const root = join(temp, "project");
    const outside = join(temp, "outside");

    try {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(outside);
      await symlink(outside, join(root, "escape"));

      await expect(resolveCwdWithinRoot(root, "src")).resolves.toBe(join(root, "src"));
      await expect(resolveCwdWithinRoot(root, "../outside")).rejects.toMatchObject({
        statusCode: 400,
      });
      await expect(resolveCwdWithinRoot(root, "escape")).rejects.toMatchObject({
        statusCode: 400,
      });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("keeps write paths inside existing project directories", async () => {
    const temp = await mkdtemp(join(tmpdir(), "keating-local-exec-write-"));
    const root = join(temp, "project");

    try {
      await mkdir(join(root, "src"), { recursive: true });
      await expect(resolveWritePathWithinRoot(root, "src/new-file.txt")).resolves.toBe(join(root, "src", "new-file.txt"));
      await expect(resolveWritePathWithinRoot(root, "../outside.txt")).rejects.toMatchObject({
        statusCode: 400,
      });
      await expect(resolveWritePathWithinRoot(root, "missing/new-file.txt")).rejects.toMatchObject({
        statusCode: 404,
      });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects existing symlink write targets even when the parent is inside root", async () => {
    const temp = await mkdtemp(join(tmpdir(), "keating-local-exec-write-symlink-"));
    const root = join(temp, "project");
    const outside = join(temp, "outside.txt");

    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(outside, "outside\n");
      await symlink(outside, join(root, "src", "link.txt"));

      await expect(resolveWritePathWithinRoot(root, "src/link.txt")).rejects.toMatchObject({
        statusCode: 400,
      });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("requires JSON same-origin localhost requests before enabling local exec", async () => {
    const previousEnabled = process.env.KEATING_WEB_LOCAL_EXEC;
    const previousRoot = process.env.KEATING_WEB_PROJECT_ROOT;
    const temp = await mkdtemp(join(tmpdir(), "keating-local-exec-guard-"));
    const root = join(temp, "project");

    try {
      await mkdir(root, { recursive: true });
      process.env.KEATING_WEB_LOCAL_EXEC = "1";
      process.env.KEATING_WEB_PROJECT_ROOT = root;

      const allowedRoot = await requireLocalExec(fakeLocalExecEvent()).catch((err) => {
        console.log("allowed local exec rejection", {
          statusCode: (err as { statusCode?: number }).statusCode,
          statusMessage: (err as { statusMessage?: string }).statusMessage,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      });
      expect(allowedRoot).toBe(root);
      await expect(
        requireLocalExec(fakeLocalExecEvent({
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
            "sec-fetch-site": "same-origin",
          },
        })),
      ).rejects.toMatchObject({ statusCode: 415 });
      await expect(
        requireLocalExec(fakeLocalExecEvent({
          headers: {
            "content-type": "application/json",
            host: "127.0.0.1:3000",
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
          },
        })),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        requireLocalExec(fakeLocalExecEvent({ remoteAddress: "192.168.1.5" })),
      ).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      if (previousEnabled === undefined) delete process.env.KEATING_WEB_LOCAL_EXEC;
      else process.env.KEATING_WEB_LOCAL_EXEC = previousEnabled;
      if (previousRoot === undefined) delete process.env.KEATING_WEB_PROJECT_ROOT;
      else process.env.KEATING_WEB_PROJECT_ROOT = previousRoot;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("runs commands without a shell and captures output", async () => {
    const temp = await mkdtemp(join(tmpdir(), "keating-local-exec-run-"));
    try {
      await writeFile(join(temp, "hello.txt"), "hello\n");
      const result = await runCommand({
        command: "node",
        args: ["-e", "const fs=require('fs'); process.stdout.write(fs.readFileSync('hello.txt','utf8'))"],
        cwd: temp,
        timeoutMs: 5_000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello\n");
      expect(result.stderr).toBe("");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
