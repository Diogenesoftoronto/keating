import { runLessonWorker } from "./run-lesson-worker";

export type SystemEnvironment = "linux" | "nix" | "wasm" | "kubernetes";
export const SYSTEM_ENVIRONMENT_LABELS: Record<SystemEnvironment, string> = {
  linux: "Alpine Linux · sh", nix: "Nix · Tvix", wasm: "WebAssembly", kubernetes: "Kubernetes · local manifests",
};

export interface SystemSnippetOptions {
  trace?: boolean;
  exportName?: string;
  /** Use a string with an n suffix for an i64 argument, e.g. "42n". */
  args?: (number | string)[];
}

export interface SystemSnippetResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Keep Markdown detection inexpensive while the tutor is streaming. Parsing and toolchains load on Run. */
export function systemSnippetEnvironment(language: string, source: string): SystemEnvironment | null {
  switch (language.trim().toLowerCase()) {
    case "sh": case "bash": case "shell": case "linux": return "linux";
    case "nix": case "nixos": return "nix";
    case "wat": case "wasm": case "webassembly": return "wasm";
    case "k8s": case "kubernetes": return "kubernetes";
    case "json": case "yaml": case "yml": {
      const version = /(?:^apiVersion\s*:|[{,]\s*"apiVersion"\s*:)/m;
      const resource = /(?:^kind\s*:\s*["']?(?:Service|Pod|List)\b|[{,]\s*"kind"\s*:\s*"(?:Service|Pod|List)")/m;
      return version.test(source) && resource.test(source) ? "kubernetes" : null;
    }
    default: return null;
  }
}

export async function runSystemSnippet(
  environment: SystemEnvironment, source: string, signal: AbortSignal, options: SystemSnippetOptions = {},
): Promise<SystemSnippetResult> {
  signal.throwIfAborted();
  if (!source.trim()) return { stdout: "", stderr: "Enter some source before running.", exitCode: 1 };
  if (new TextEncoder().encode(source).length > 65_536) {
    return { stdout: "", stderr: "Keep the snippet under 64 KiB.", exitCode: 1 };
  }
  if (environment === "linux") {
    const { runLinuxLesson } = await import("./unkernel/index");
    return runLinuxLesson(options.trace ? "set -x\n" + source : source, signal);
  }
  try {
    let stdout: string;
    if (environment === "nix") {
      const { runNixExpression } = await import("./nix-expression");
      stdout = await runNixExpression(source, signal);
    } else if (environment === "kubernetes") {
      const { inspectManifest } = await import("./system-manifest");
      signal.throwIfAborted();
      stdout = inspectManifest(source);
    } else {
      const worker = new Worker(new URL("./system-wat.worker.ts", import.meta.url), { type: "module" });
      stdout = await runLessonWorker<string>(worker, JSON.stringify({ source, exportName: options.exportName, args: options.args }), signal);
    }
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "LessonEnvironmentError") throw error;
    return { stdout: "", stderr: error instanceof Error ? error.message : String(error), exitCode: 1 };
  }
}
