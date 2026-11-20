import { compileWat } from "../compile-wat";
import type { SystemsLessonResult } from "../systems-lessons";

const registers = [
  { address: 16, bytes: [0xd2, 0x04], expected: 1234 },
  { address: 31, bytes: [0x01, 0x01], expected: 257 },
];

function hex(value: number, digits: number): string {
  return "0x" + value.toString(16).toUpperCase().padStart(digits, "0");
}

/** Run inside a disposable worker. A learner's own module can loop indefinitely. */
export async function checkWasmRegister(source: string): Promise<SystemsLessonResult> {
  let module: WebAssembly.Module;
  try {
    module = await compileWat("register.wat", source);
  } catch (error) {
    if (error instanceof Error && error.name === "LessonEnvironmentError") {
      return { status: "unavailable", output: error.message, feedback: "Try reloading the compiler." };
    }
    throw error;
  }
  const instance = await WebAssembly.instantiate(module);
  const { memory, read } = instance.exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof read !== "function") {
    return { status: "failed", output: "Expected exports: memory, read(address)", feedback: "Export a memory and a function named read for the harness to call." };
  }
  let passed = true;
  const rows = [];
  for (const register of registers) {
    new Uint8Array(memory.buffer).set(register.bytes, register.address);
    const result: unknown = read(register.address);
    const actual = typeof result === "number" && Number.isInteger(result) && result >= 0
      ? `${hex(result, 4)} (${result})` : String(result);
    rows.push(`memory[${register.address}..\u200b${register.address + 1}]  ${register.bytes.map(byte => hex(byte, 2)).join(" ")}\n  read → ${actual}   expected ${register.expected}`);
    if (result !== register.expected) passed = false;
  }
  return {
    status: passed ? "passed" : "failed", output: rows.join("\n\n"),
    feedback: passed ? "Both calls included the high byte, including the read from an odd address."
      : "The first byte has weight 1 and the second has weight 256. How many bits does the current load read?",
  };
}
