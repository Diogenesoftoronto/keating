import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveProjectPath } from "../../server/api/project-files/[...path]";

describe("project files route", () => {
  it("rejects symlinks that resolve outside the project root", async () => {
    const temp = await mkdtemp(join(tmpdir(), "keating-project-files-"));
    const root = join(temp, "project");
    const outside = join(temp, "outside.txt");

    try {
      await mkdir(root);
      await writeFile(outside, "secret");
      await symlink(outside, join(root, "secret"));
      await expect(resolveProjectPath(root, "secret")).rejects.toMatchObject({
        statusCode: 400,
        statusMessage: "Path escapes project root",
      });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
