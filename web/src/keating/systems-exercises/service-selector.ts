import type { SystemsLessonResult } from "../systems-lessons";

export interface SelectorPod { name: string; namespace: string; labels: Record<string, string> }

export const samplePods: SelectorPod[] = [
  { name: "api-a", labels: { app: "api", track: "stable" } },
  { name: "api-b", labels: { app: "api", track: "stable" } },
  { name: "api-next", labels: { app: "api", track: "canary" } },
  { name: "batch-0", labels: { app: "batch", track: "stable" } },
].map(pod => ({ ...pod, namespace: "lab" }));

export function matchesServiceSelector(namespace: string, selector: Record<string, unknown>, pod: SelectorPod) {
  const entries = Object.entries(selector);
  return pod.namespace === namespace && entries.length > 0 &&
    entries.every(([key, value]) => Object.hasOwn(pod.labels, key) && pod.labels[key] === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkServiceSelector(source: string): SystemsLessonResult {
  let service: unknown;
  try {
    service = JSON.parse(source);
  } catch (error) {
    return { status: "failed", output: error instanceof Error ? error.message : String(error), feedback: "The manifest must be valid JSON before the selector can be read." };
  }
  if (!isRecord(service) || service.kind !== "Service" || service.apiVersion !== "v1" || !isRecord(service.spec)) {
    return { status: "failed", output: "Expected a v1 Service with a spec.", feedback: "Keep the Service manifest and edit the entries in spec.selector." };
  }
  const selector = service.spec.selector;
  if (selector != null && (!isRecord(selector) || !Object.values(selector).every(value => typeof value === "string"))) {
    return { status: "failed", output: "spec.selector expects label names with string values.", feedback: "Use a JSON object such as { \"app\": \"api\" }." };
  }
  const namespace = isRecord(service.metadata) ? service.metadata.namespace ?? "default" : "default";
  const labels = Object.entries(selector ?? {});
  const matches: string[] = [];
  const rows = samplePods.map(pod => {
    const matched = typeof namespace === "string" && matchesServiceSelector(namespace, selector ?? {}, pod);
    if (matched) matches.push(pod.name);
    return `${matched ? "match" : "skip "}  ${pod.name.padEnd(8)} app=${pod.labels.app},track=${pod.labels.track}`;
  });
  const passed = matches.join(", ") === "api-a, api-b";
  let feedback = "Inspect the app and track columns. A pod must satisfy both entries to match.";
  if (namespace !== "lab") feedback = "The sample Pods live in the lab namespace. A Service selects Pods in its own namespace.";
  else if (!labels.length) feedback = "A Service with no selector does not select Pods automatically.";
  else if (passed) feedback = "Both stable API replicas match. The canary and batch pods are excluded.";
  return { status: passed ? "passed" : "failed", output: `Pods in lab\n${rows.join("\n")}\n\nSelected: ${matches.join(", ") || "(none)"}`, feedback };
}
