import { parseAllDocuments } from "yaml";
import { matchesServiceSelector, samplePods, type SelectorPod } from "./systems-exercises/service-selector";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readLabels(value: unknown, field: string): Record<string, string> {
  if (value == null) return {};
  if (!record(value) || !Object.values(value).every(label => typeof label === "string")) {
    throw new Error(field + " must be a mapping from label names to strings.");
  }
  return value as Record<string, string>;
}

/** Inspect the supplied resources without contacting a cluster. Empty namespaces default as in Kubernetes. */
export function inspectManifest(source: string): string {
  const services: { name: string; namespace: string; selector: Record<string, string> }[] = [];
  const pods: SelectorPod[] = [];
  const documents = parseAllDocuments(source);
  for (const document of documents) {
    if (document.errors.length) throw document.errors[0];
    if (!document.contents) continue;
    const value: unknown = document.toJS({ maxAliasCount: 0 });
    const resources = record(value) && value.kind === "List" && value.apiVersion === "v1" ? value.items : [value];
    if (!Array.isArray(resources)) throw new Error("A v1 List requires an items array.");
    for (const resource of resources) {
      if (!record(resource) || resource.apiVersion !== "v1" || !["Service", "Pod"].includes(String(resource.kind))) {
        throw new Error("This inspector accepts v1 Service and Pod manifests, including multi-document YAML and v1 List items.");
      }
      if (!record(resource.metadata) || typeof resource.metadata.name !== "string" || !resource.metadata.name) {
        throw new Error(`${resource.kind} requires metadata.name.`);
      }
      const { name, namespace = "default" } = resource.metadata;
      if (typeof namespace !== "string" || !namespace) throw new Error("metadata.namespace must be a non-empty string.");
      if (resource.kind === "Pod") {
        pods.push({ name, namespace, labels: readLabels(resource.metadata.labels, "metadata.labels") });
      } else {
        if (!record(resource.spec)) throw new Error("A Service requires a spec.");
        services.push({ name, namespace, selector: readLabels(resource.spec.selector, "spec.selector") });
      }
    }
  }
  if (!pods.length && !services.length) throw new Error("Enter a Service or Pod manifest.");
  const candidates = pods.length ? pods : samplePods;
  const lines = [pods.length ? "Pods from this snippet" : "Sample Pods · namespace lab"];
  for (const pod of candidates) {
    const labels = Object.entries(pod.labels).map(([key, value]) => key + "=" + value);
    lines.push(`${pod.namespace}/${pod.name}  ${labels.join(", ") || "(no labels)"}`);
  }
  for (const { name, namespace, selector } of services) {
    const selected = candidates.filter(pod => matchesServiceSelector(namespace, selector, pod));
    lines.push("", `Service ${namespace}/${name}`, "Selected: " + (selected.map(pod => pod.name).join(", ") || "(none)"));
  }
  return lines.join("\n");
}
