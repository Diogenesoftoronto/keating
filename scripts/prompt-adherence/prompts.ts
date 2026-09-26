import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCompactTeachingPrompt } from "../../packages/learner-contracts/src/judgement/teaching-policy.js";
import type { TeachingPolicyPlan } from "../../packages/learner-contracts/src/judgement/teaching-policy-types.js";
import type { BenchmarkTool } from "./providers.js";

export type BenchmarkArm = "full" | "compact" | "governed" | "drafted";
export const BENCHMARK_ARMS: readonly BenchmarkArm[] = ["full", "compact", "governed", "drafted"];
export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
export interface PromptArtifacts {
  readonly full: string;
  readonly common: string;
  readonly tools: readonly BenchmarkTool[];
  readonly provenance: Readonly<Record<string, unknown>>;
}

/** Runs the existing byte-equality-checked web exporter, never any teaching tools. */
export async function exportPromptArtifacts(root: string, directory: string): Promise<PromptArtifacts> {
  const output = resolve(directory, "system-prompt.txt");
  const process = Bun.spawn(["rtk", "proxy", "bun", "scripts/training/export_system_prompt.ts", output], {
    cwd: root, stdout: "pipe", stderr: "pipe",
  });
  const [status] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  if (status !== 0) throw Error("benchmark_web_prompt_export_failed");
  const [full, metadataText, toolText, cli] = await Promise.all([
    readFile(output, "utf8"), readFile(`${output}.metadata.json`, "utf8"),
    readFile(resolve(directory, "tool-schemas.json"), "utf8"), readFile(resolve(root, "SYSTEM.md"), "utf8"),
  ]);
  const metadata = JSON.parse(metadataText);
  if (metadata.verifiedEqualToOriginalWebBuilder !== true || metadata.promptSha256 !== sha256(full)
    || metadata.toolSchemas.sha256 !== sha256(toolText) || metadata.state.runtime !== null
    || metadata.state.course !== null || metadata.state.speechEnabled !== false
    || metadata.state.learnerContext !== "" || metadata.state.sessionStartContext !== "") throw Error("benchmark_web_prompt_provenance_mismatch");
  const length: unknown = metadata.openUiCharacters;
  const start: unknown = metadata.openUiStart;
  if (typeof length !== "number" || !Number.isInteger(length) || length <= 0 || length >= full.length
    || typeof start !== "number" || !Number.isInteger(start) || start < 0) throw Error("benchmark_openui_boundary_invalid");
  const grammar = full.slice(start, start + length);
  const runtimeSuffix = full.slice(start + length);
  if (sha256(grammar) !== metadata.openUiSha256 || sha256(runtimeSuffix) !== metadata.runtimeSuffixSha256) throw Error("benchmark_openui_boundary_changed");
  const sharedRuntime = `${grammar}${runtimeSuffix}`;
  const domains = cli.split("\n").filter(line => /^(?:[89]|1[0-8])\. /.test(line));
  if (domains.length !== 11) throw Error("benchmark_domain_supplement_changed");
  const domainSupplement = `Shared CLI domain requirements for this experiment:\n${domains.join("\n")}`;
  const tools: BenchmarkTool[] = JSON.parse(toolText).map((entry: { function: BenchmarkTool }) => entry.function);
  if (!tools.length || new Set(tools.map(tool => tool.name)).size !== tools.length) throw Error("benchmark_tools_invalid");
  return { full, common: `${sharedRuntime}\n\n${domainSupplement}`, tools,
    provenance: { ...metadata, openUiSha256: sha256(grammar), domainSupplement, domainSupplementSha256: sha256(domainSupplement),
      commonSha256: sha256(`${sharedRuntime}\n\n${domainSupplement}`), runtimeSuffixSha256: sha256(runtimeSuffix), runtimeContext: "default-new-user-web; scenario observations added identically per arm",
      fullBasePreserved: true, toolExecution: false,
      supplementReason: "CLI domain policies evaluated in the same experiment are supplied verbatim to every arm." } };
}

export function promptForArm(artifacts: PromptArtifacts, arm: BenchmarkArm, plan?: TeachingPolicyPlan): string {
  if (arm === "full") {
    const supplement = artifacts.provenance.domainSupplement;
    return typeof supplement === "string" ? `${artifacts.full}\n\n${supplement}` : artifacts.full;
  }
  return `${buildCompactTeachingPrompt(arm === "governed" || arm === "drafted" ? plan : undefined)}\n\n${artifacts.common}`;
}
