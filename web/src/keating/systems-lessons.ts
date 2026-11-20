import { checkServiceSelector } from "./systems-exercises/service-selector";
import { runLessonWorker } from "./run-lesson-worker";

export type SystemsLessonId = "kubernetes" | "nix" | "linux" | "kernel" | "wasm";

export interface SystemsLesson {
  id: SystemsLessonId;
  title: string;
  environment: string;
  language: string;
  filename: string;
  goal: string;
  prompt: string;
  starter: string;
  command: string;
  expectedOutput: string;
}

export interface SystemsLessonResult {
  status: "passed" | "failed" | "unavailable";
  output: string;
  feedback: string;
}

export const SYSTEMS_LESSONS: readonly SystemsLesson[] = [
  {
    id: "linux", title: "Follow an open descriptor", environment: "Linux · Unkernel guest",
    language: "sh", filename: "rotate.sh",
    goal: "Keep both build messages in the rotated log.",
    prompt: "Descriptor 3 is open when the log moves. Run the script to see which message survived. Change the second write so it follows the original file after the rename.",
    command: "sh rotate.sh", expectedOutput: "compiling\nlinked",
    starter: `exec 3>build.log
printf '%s\\n' compiling >&3
mv build.log build.old
: >build.log

printf '%s\\n' linked >>build.log
exec 3>&-
cat build.old`,
  },
  {
    id: "kubernetes", title: "Route to the stable pods", environment: "Kubernetes · local fixtures",
    language: "json", filename: "service.json",
    goal: "Select both stable API pods and leave the canary alone.",
    prompt: "Run the Service against four sample Pods. Inspect their labels, then edit spec.selector so only api-a and api-b match. Each key in a Service selector must match.",
    command: "Match Service selector", expectedOutput: "api-a, api-b",
    starter: `{
  "apiVersion": "v1",
  "kind": "Service",
  "metadata": { "name": "api", "namespace": "lab" },
  "spec": {
    "selector": { "app": "api", "track": "canary" },
    "ports": [{ "port": 80, "targetPort": 8080 }]
  }
}`,
  },
  {
    id: "nix", title: "Find the lost override", environment: "Nix · Tvix evaluator",
    language: "nix", filename: "ports.nix",
    goal: "Keep the default port until a caller supplies its own.",
    prompt: "This function receives three configurations. Inspect the evaluated ports, then change the merge so an empty set keeps 8080 and explicit ports win.",
    command: "Evaluate three configurations", expectedOutput: "[ 8080 3000 443 ]",
    starter: `overrides:
let
  defaults = { port = 8080; };
  settings = overrides // defaults;
in settings.port`,
  },
  {
    id: "kernel", title: "Cross a page boundary", environment: "Kernel model · Unkernel guest",
    language: "sh", filename: "page-table.sh",
    goal: "Translate virtual addresses on both sides of a page boundary.",
    prompt: "This two-entry page table maps virtual pages 0 and 1 to frames 7 and 3. Each page holds 4096 bytes. Inspect the four translations, then fix the offset calculation.",
    command: "Trace four virtual addresses", expectedOutput: "4094 32766\n4095 32767\n4096 12288\n8192 page fault",
    starter: `translate() {
  address=$1
  page=$((address / 4096))
  offset=$((address / 4096))
  case "$page" in
    0) frame=7 ;;
    1) frame=3 ;;
    *) echo "page fault"; return ;;
  esac
  echo $((frame * 4096 + offset))
}`,
  },
  {
    id: "wasm", title: "Read the whole register", environment: "WebAssembly · browser VM",
    language: "wat", filename: "register.wat",
    goal: "Read a two-byte, little-endian register from linear memory.",
    prompt: "The harness writes a pair of bytes at each address. Compare the returned integers with the bytes, then change the load instruction so it includes the high byte.",
    command: "Compile WAT and call read", expectedOutput: "0x04D2 (1234)\n0x0101 (257)",
    starter: `(module
  (memory (export "memory") 1 1)
  (func (export "read") (param $address i32) (result i32)
    (i32.load8_u (local.get $address))))`,
  },
];

function kernelScript(source: string): string {
  return `${source}
for address in 4094 4095 4096 8192; do
  printf '%s ' "$address"
  translate "$address" || exit 1
done`;
}

export async function runSystemsLesson(
  id: SystemsLessonId,
  source: string,
  signal: AbortSignal,
  options: { trace?: boolean } = {},
): Promise<SystemsLessonResult> {
  signal.throwIfAborted();
  if (!source.trim()) return { status: "failed", output: "", feedback: "Add some code before running the exercise." };
  if (new TextEncoder().encode(source).byteLength > 65_536) return { status: "failed", output: "", feedback: "Keep the exercise under 64 KiB." };
  if (id !== "kubernetes" && (typeof Worker === "undefined" || typeof WebAssembly === "undefined")) {
    return { status: "unavailable", output: "", feedback: "This exercise needs a browser with Web Workers and WebAssembly." };
  }
  try {
    switch (id) {
      case "kubernetes":
        return checkServiceSelector(source);
      case "wasm": {
        const worker = new Worker(new URL("./systems-exercises/register.worker.ts", import.meta.url), { type: "module" });
        return await runLessonWorker<SystemsLessonResult>(worker, source, signal);
      }
      case "nix": {
        const { runNixExpression } = await import("./nix-expression");
        const expression = `builtins.map (\n${source}\n) [ {} { port = 3000; } { port = 443; } ]`;
        const output = await runNixExpression(expression, signal);
        const passed = /^\[\s*8080\s+3000\s+443\s*\]$/.test(output.trim());
        return {
          status: passed ? "passed" : "failed", output,
          feedback: passed ? "The empty set kept the default. Both explicit ports survived the merge."
            : "The calls supply {}, { port = 3000; } and { port = 443; }. In a // merge, the right-hand set wins a shared key.",
        };
      }
      case "linux":
      case "kernel": {
        let run;
        try {
          const { runLinuxLesson } = await import("./unkernel/index");
          const script = id === "kernel" ? kernelScript(source) : source;
          run = await runLinuxLesson(options.trace ? `set -x\n${script}` : script, signal);
        } catch (error) {
          signal.throwIfAborted();
          return { status: "unavailable", output: error instanceof Error ? error.message : String(error), feedback: "The Linux guest could not complete this run." };
        }
        const stdout = run.stdout.trimEnd();
        const stderr = run.stderr.trimEnd();
        const output = options.trace
          ? `Standard output\n${stdout || "(empty)"}\n\nShell trace (stderr)\n${stderr || "(empty)"}`
          : [stdout, stderr].filter(Boolean).join("\n");
        if (run.exitCode !== 0) return { status: "failed", output, feedback: `The shell exited with status ${run.exitCode}. Inspect the last command and its output.` };
        if (id === "linux") {
          const passed = stdout === "compiling\nlinked";
          return { status: passed ? "passed" : "failed", output, feedback: passed
            ? "Both lines appear in build.old. The open descriptor followed the file across the rename."
            : "cat reads build.old at the end. The second write opens build.log again. Which open descriptor still refers to the moved file?" };
        }
        const passed = stdout === "4094 32766\n4095 32767\n4096 12288\n8192 page fault";
        return { status: passed ? "passed" : "failed", output, feedback: passed
          ? "The last two bytes of page 0 are adjacent. Page 1 starts at frame 3, and page 2 has no entry."
          : "Each row is a virtual address and its translation. The byte offset runs from 0 to 4095 and resets at the next page." };
      }
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "LessonEnvironmentError") {
      return { status: "unavailable", output: error.message, feedback: "The exercise runtime could not start. Try running it again." };
    }
    return { status: "failed", output: error instanceof Error ? error.message : String(error), feedback: "Use the diagnostic to locate the first failing expression, then run again." };
  }
}
