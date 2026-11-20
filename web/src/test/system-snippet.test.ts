import { expect, test } from "bun:test";
import { runSystemSnippet, systemSnippetEnvironment } from "../keating/system-snippet";

test("recognizes environment aliases and Kubernetes resources while keeping ordinary data fences unchanged", () => {
  expect(systemSnippetEnvironment("BASH", "pwd")).toBe("linux");
  expect(systemSnippetEnvironment("wat", "(module)")).toBe("wasm");
  expect(systemSnippetEnvironment("js", "1 + 2")).toBeNull();
  expect(systemSnippetEnvironment("yaml", "kind: idea\nname: test")).toBeNull();
  expect(systemSnippetEnvironment("json", '{"kind":"Pod","apiVersion":"v1"}')).toBe("kubernetes");
});

test("selector diagnostics identify local sample Pods and isolate authored Pod namespaces", async () => {
  const signal = new AbortController().signal;
  const run = (source: string) => runSystemSnippet("kubernetes", source, signal);
  const service = { kind: "Service", apiVersion: "v1", metadata: { name: "test", namespace: "lab" }, spec: { selector: { app: "batch" } } };
  const sampled = await run(JSON.stringify(service));
  expect(sampled.exitCode).toBe(0);
  expect(sampled.stdout).toContain("Sample Pods · namespace lab");
  expect(sampled.stdout).toContain("Selected: batch-0");
  const pod = { kind: "Pod", apiVersion: "v1", metadata: { name: "p", namespace: "other", labels: { app: "batch" } } };
  const supplied = await run(JSON.stringify({ kind: "List", apiVersion: "v1", items: [service, pod] }));
  expect(supplied.stdout).toContain("Pods from this snippet");
  expect(supplied.stdout).toContain("Selected: (none)");
  expect((await run("kind: [")).exitCode).toBe(1);
  await expect(runSystemSnippet("kubernetes", "", AbortSignal.abort())).rejects.toHaveProperty("name", "AbortError");
});
