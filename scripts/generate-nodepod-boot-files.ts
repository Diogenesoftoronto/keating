#!/usr/bin/env bun
/**
 * Bundles mutable source files into a Node.js module for NodePod boot.
 *
 * Usage:
 *   bun scripts/generate-nodepod-boot-files.ts
 *
 * For every .ts file we emit both the raw TS (for agent editing) and a
 * transpiled .js counterpart (for NodePod require()). Transpilation uses
 * Bun's built-in TS→JS transformer which handles types, generics, decorators,
 * and ESM/CJS correctly.
 */

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type * as TypeScript from "typescript";

const SOURCE_DIRS = ["src/core", "shared", "pi/prompts", "web/src/keating"];
// These modules are reached by teaching/review code, but their parent directories
// also contain account transports and evaluation authority. Keep an explicit list.
const REVIEW_SOURCE_FILES = [
  "packages/learner-contracts/src/judgement/contracts.ts",
  "packages/learner-contracts/src/judgement/calibration-artifact.ts",
  "packages/learner-contracts/src/judgement/projections.ts",
  "packages/learner-contracts/src/judgement/wire.ts",
  "packages/learner-contracts/src/judgement/router.ts",
  "packages/learner-contracts/src/judgement/assessment.ts",
  "src/judgement/cli-readiness.ts",
  "src/judgement/calibration-artifact.ts",
  "src/judgement/cli-lesson-plan.ts",
  "src/judgement/cli-prompt-evaluation.ts",
  "src/judgement/cli-prompt-evolution.ts",
  "src/observability/types.ts",
];
// Generated workspaces cannot acquire account capabilities or export telemetry.
// Stubs retain the importing modules' contract without bundling those services.
const REVIEW_OVERRIDES: Readonly<Record<string, string>> = {
  "src/core/teaching-evolution.ts": `/** NodePod-only boundary: sealed evaluation and activation remain with the host. */
export type TeachingEvolutionOptions = Readonly<Record<string, unknown>>;
export async function teachingEvolutionArtifact(_cwd: string, _options: TeachingEvolutionOptions = {}): Promise<never> {
  throw new Error("host-execution-unavailable");
}
export async function teachingBenchmarkArtifact(_cwd: string, _options: TeachingEvolutionOptions = {}): Promise<never> {
  throw new Error("host-execution-unavailable");
}
`,
  "src/core/pi-agent.ts": `/** NodePod-only boundary: model execution belongs to the host. */
export interface PiCompletionOptions {
  systemPrompt?: string;
  json?: boolean;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}
export async function piComplete(_cwd: string, _prompt: string, _options: PiCompletionOptions = {}): Promise<string> {
  throw new Error("host-execution-unavailable");
}
export async function piCompleteJson<T>(_cwd: string, _prompt: string, _options: PiCompletionOptions = {}): Promise<T> {
  throw new Error("host-execution-unavailable");
}
`,
  "src/judgement/transport.ts": `/** NodePod-only boundary: account judgement execution belongs to the host. */
import type { JudgementBackendKey, JudgementCaller } from "../../packages/learner-contracts/src/judgement/contracts.js";
export const JUDGEMENT_MODEL_ENV = "KEATING_JUDGEMENT_MODEL";
export const JUDGEMENT_CALIBRATION_ENV = "KEATING_JUDGEMENT_CALIBRATION_SHA256";
export interface CliJudgementOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly fetch?: unknown;
  readonly loadCredential?: (cwd: string) => unknown;
  readonly now?: () => number;
  readonly retry?: unknown;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}
export interface CliJudgementBackend { readonly key: JudgementBackendKey; readonly call: JudgementCaller }
export function createCliJudgementBackend(_options: CliJudgementOptions = {}): CliJudgementBackend | null { return null; }
`,
  "src/observability/arize.ts": `/** NodePod-only boundary: telemetry is exported by the host, never this mutable workspace. */
import type { EvaluationObservationV1 } from "./types.js";
export async function exportEvaluationObservation(_observation: EvaluationObservationV1): Promise<void> {}
export async function exportProviderCompletion(_observation: unknown): Promise<void> {}
export function classifyObservationError(error: unknown): string {
  if (error instanceof Error && /not ready|cooldown/i.test(error.message)) return "rejected";
  if (error instanceof Error && /parse|json/i.test(error.message)) return "parse";
  return "operation_failed";
}
`,
};
const OUTPUT_FILE = "web/src/keating/nodepod-boot-files.ts";
const INCLUDE_PATTERNS = [/\.ts$/, /\.md$/, /\.py$/, /\.sh$/, /\.txt$/];
const EXCLUDE_PATTERNS = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /node_modules/,
  /web\/src\/keating\/nodepod-boot-files\.ts$/,
  // Evaluation rules, sealed cases, assessment keys, and activation authority
  // stay in the host. Mutable agent workspaces receive teaching artifacts only.
  /^shared\/evolution\//,
  /^web\/src\/keating\/flue\//,
  /^src\/core\/(?:teaching-(?:evolution(?:-store)?|episode-runner)|learning-checks)\.ts$/,
  /^web\/src\/keating\/teaching-(?:evolution(?:-store)?|episode-runner)\.ts$/,
];

async function* walkDir(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".output") continue;
      yield* walkDir(fullPath);
    } else {
      yield fullPath;
    }
  }
}

let tsPromise: Promise<typeof TypeScript> | null = null;

async function loadTypeScript(): Promise<typeof TypeScript> {
  tsPromise ??= import(new URL("../web/node_modules/typescript/lib/typescript.js", import.meta.url).href) as Promise<typeof TypeScript>;
  return tsPromise;
}

/** Use TypeScript's compiler API for TS → CommonJS so NodePod require() works. */
async function transpileWithTypeScript(source: string, filename: string): Promise<string> {
  try {
    const ts = await loadTypeScript();
    return ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
      },
    }).outputText;
  } catch {
    return source; // fallback: return raw source
  }
}

async function main() {
  const files = new Map<string, string>();
  const rootDir = process.cwd();
  async function addSource(path: string, content: string) {
    files.set(path, content);
    if (path.endsWith(".ts") && !path.endsWith(".d.ts")) {
      files.set(path.replace(/\.ts$/, ".js"), await transpileWithTypeScript(content, path));
    }
  }

  for (const dir of SOURCE_DIRS) {
    try {
      for await (const filePath of walkDir(dir)) {
        const rel = relative(rootDir, filePath).replace(/\\/g, "/");
        const include = INCLUDE_PATTERNS.some((p) => p.test(rel));
        const exclude = EXCLUDE_PATTERNS.some((p) => p.test(rel));
        if (!include || exclude) continue;
        const content = await readFile(filePath, "utf8");
        await addSource(rel, content);
      }
    } catch (e: any) {
      console.warn(`Warning: could not read ${dir}: ${e.message}`);
    }
  }

  for (const path of REVIEW_SOURCE_FILES) await addSource(path, await readFile(path, "utf8"));
  for (const [path, content] of Object.entries(REVIEW_OVERRIDES)) await addSource(path, content);

  // Sort for deterministic output
  const sorted = Array.from(files.entries()).sort(([a], [b]) => a.localeCompare(b));

  const lines = [
    "// AUTO-GENERATED by scripts/generate-nodepod-boot-files.ts",
    "// Do not edit manually. Run the script to regenerate.",
    "",
    "export interface NodePodBootFile {",
    "  path: string;",
    "  content: string;",
    "}",
    "",
    "export const NODEPOD_BOOT_FILES: Record<string, string> = {",
  ];

  for (const [path, content] of sorted) {
    const escaped = JSON.stringify(content);
    lines.push(`  ${JSON.stringify(path)}: ${escaped},`);
  }

  lines.push("};");
  lines.push("");
  lines.push(`export const NODEPOD_BOOT_FILE_COUNT = ${sorted.length};`);
  lines.push("");

  // Helper: get JS counterpart for a TS path
  lines.push("/** For a given .ts path, return its transpiled .js counterpart if it exists. */");
  lines.push("export function getJsCounterpart(tsPath: string): string | null {");
  lines.push('  const jsPath = tsPath.replace(/\\.ts$/, ".js");');
  lines.push('  return NODEPOD_BOOT_FILES[jsPath] ? jsPath : null;');
  lines.push("}");
  lines.push("");

  // Helper: on-demand transpile (for agent-edited files not in boot bundle)
  lines.push(`export const TRANSPILER_BANNER = "// Transpiled by Bun.Transpiler\\n";`);
  lines.push("");

  await mkdir("web/src/keating", { recursive: true });
  await writeFile(OUTPUT_FILE, lines.join("\n"), "utf8");

  const totalBytes = sorted.reduce((sum, [, c]) => sum + c.length, 0);
  const jsCount = sorted.filter(([p]) => p.endsWith(".js")).length;
  console.log(`Generated ${OUTPUT_FILE} with ${sorted.length} files (${Math.round(totalBytes / 1024)} KB total, ${jsCount} JS transpiled via TypeScript)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
