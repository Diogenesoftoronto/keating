import { compileWat } from "./compile-wat";
import type { SystemSnippetOptions } from "./system-snippet";

self.onmessage = async ({ data }: MessageEvent<string>) => {
  try {
    const { source, exportName, args = [] }: SystemSnippetOptions & { source: string } = JSON.parse(data);
    const module = await compileWat("chat.wat", source);
    const imports = WebAssembly.Module.imports(module);
    if (imports.length) {
      throw new Error("This module requires host imports: " + imports.map(item => item.module + "." + item.name).join(", ")
        + ". This sandbox instantiates standalone modules.");
    }
    const instance = await WebAssembly.instantiate(module);
    const entries = WebAssembly.Module.exports(module);
    const rows = entries.map(({ kind, name }) => {
      const entry = instance.exports[name];
      if (typeof entry === "function") return `function ${name} (${entry.length} arguments)`;
      if (entry instanceof WebAssembly.Memory) return `memory ${name}: ${entry.buffer.byteLength} bytes`;
      if (entry instanceof WebAssembly.Global) return `global ${name}: ${String(entry.value)}`;
      return `${kind} ${name}`;
    });
    const output = ["Module instantiated.", ...rows];
    if (exportName?.trim()) {
      const name = exportName.trim();
      const fn = instance.exports[name];
      if (typeof fn !== "function") throw new Error(`No exported function named "${name}". Exports: ${entries.map(entry => entry.name).join(", ") || "(none)"}.`);
      if (args.length !== fn.length) throw new Error(`${name} expects ${fn.length} arguments, received ${args.length}.`);
      const values = args.map(arg => {
        if (typeof arg === "number" && Number.isFinite(arg)) return arg;
        if (typeof arg === "string" && /^-?\d+n$/.test(arg)) return BigInt(arg.slice(0, -1));
        throw new Error('Use a number or an i64 string such as "42n" for each argument.');
      });
      const result: unknown = fn(...values);
      output.push(`${name}(${args.join(", ")}) → ${result === undefined ? "(void)" : String(result)}`);
    }
    self.postMessage({ ok: true, value: output.join("\n") });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error),
      unavailable: error instanceof Error && error.name === "LessonEnvironmentError" });
  }
};
