import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("chat rerenders keep its conversation observers until the host unmounts", async () => {
  // The mounted hook uses real storage exports and a virtual Vite module. Isolate it
  // from other Bun suites' process-wide module mocks as it would be on the chat page.
  const fixture = fileURLToPath(new URL("./fixtures/agent-host-lifecycle.tsx", import.meta.url));
  const child = Bun.spawn([process.execPath, fixture], { stdout: "inherit", stderr: "pipe" });
  const [exitCode, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(exitCode, errors).toBe(0);
});
