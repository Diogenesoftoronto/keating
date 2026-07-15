import { describe, expect, test } from "bun:test";

import { webHelpText } from "../src/cli/web-help.js";

describe("web CLI help", () => {
  test("explains every execution mode with actionable commands", () => {
    const help = webHelpText();

    expect(help).toContain("--browser-only-agent");
    expect(help).toContain("--host --allow-local-exec");
    expect(help).toContain("--remote-endpoint=https://sandbox.example.com");
    expect(help).toContain("--cloud-endpoint=https://keating.help");
  });

  test("documents the external protocol and host trust boundary", () => {
    const help = webHelpText();

    expect(help).toContain("<endpoint>/api/agent-runtime/execute");
    expect(help).toContain("KEATING_WEB_REMOTE_AUTH_TOKEN");
    expect(help).toContain("Host mode is intentionally not a sandbox");
  });
});
