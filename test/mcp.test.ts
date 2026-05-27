import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { serveWebMcp } from "../src/mcp/server.js";

test("webmcp exposes Keating tools over streamable HTTP", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-webmcp-"));
  const running = await serveWebMcp({ cwd: workdir, port: 0 });
  const client = new Client({ name: "keating-webmcp-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(running.url));

  try {
    const health = await fetch(running.url.replace("/mcp", "/health"));
    expect(health.status).toBe(200);

    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "keating_teach_topic")).toBe(true);

    const result = await client.callTool({
      name: "keating_plan_topic",
      arguments: { topic: "derivative" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("derivative");
    }
  } finally {
    await client.close().catch(() => undefined);
    await running.close();
    await rm(workdir, { recursive: true, force: true });
  }
}, { timeout: 15000 });
