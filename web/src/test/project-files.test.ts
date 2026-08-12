import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ignore from "ignore";

import nitroConfig from "../../nitro.config";
import { pathIsIgnored, projectFilesPathFromUrlPathname, resolveProjectPath } from "../../server/api/project-files/[...path]";

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

  it("matches gitignored directory entries when listing the project root", () => {
    const ig = ignore().add(".keating/\ndist/\n.env*\n");

    expect(pathIsIgnored(".keating", ig, true)).toBe(true);
    expect(pathIsIgnored("dist", ig, true)).toBe(true);
    expect(pathIsIgnored(".keating", ig, false)).toBe(false);
    expect(pathIsIgnored("README.md", ig, false)).toBe(false);
    expect(pathIsIgnored(".env.local", ig, false)).toBe(true);
  });

  it("registers the project-files API route in Nitro", () => {
    expect(nitroConfig.handlers).toContainEqual({
      route: "/api/project-files/**",
      handler: "server/api/project-files/[...path].ts",
    });
    expect(nitroConfig.handlers).toContainEqual({
      route: "/api/local-exec/exec",
      handler: "server/api/local-exec/exec.ts",
    });
    expect(nitroConfig.handlers).toContainEqual({
      route: "/api/local-exec/write",
      handler: "server/api/local-exec/write.ts",
    });
    expect(nitroConfig.handlers).toContainEqual({
      route: "/brand/**",
      handler: "server/routes/assets/[...path].ts",
    });
    expect(nitroConfig.routeRules?.["/**"]?.headers).toMatchObject({
      "Cache-Control": "no-store, no-transform",
    });
    expect(nitroConfig.routeRules?.["/assets/**"]?.headers).toMatchObject({
      "Cache-Control": "public, max-age=31536000, immutable, no-transform",
    });
    expect(nitroConfig.routeRules?.["/brand/**"]?.headers).toMatchObject({
      "Cache-Control": "public, max-age=86400, no-transform",
    });
  });

  it("extracts file paths from the explicit Nitro wildcard route", () => {
    expect(projectFilesPathFromUrlPathname("/api/project-files")).toBe("");
    expect(projectFilesPathFromUrlPathname("/api/project-files/")).toBe("");
    expect(projectFilesPathFromUrlPathname("/api/project-files/package.json")).toBe("package.json");
    expect(projectFilesPathFromUrlPathname("/api/project-files/src/core/policy.ts")).toBe("src/core/policy.ts");
    expect(projectFilesPathFromUrlPathname("/api/project-files/docs/hello%20world.md")).toBe("docs/hello world.md");
  });
});
