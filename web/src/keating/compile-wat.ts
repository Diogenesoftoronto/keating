import wabt from "wabt";

/** Compile inside a worker so the caller can terminate validation or guest execution. */
export async function compileWat(filename: string, source: string): Promise<WebAssembly.Module> {
  let compiler: Awaited<ReturnType<typeof wabt>>;
  try {
    compiler = await wabt();
  } catch (cause) {
    const error = new Error("The WebAssembly text compiler could not start.", { cause });
    error.name = "LessonEnvironmentError";
    throw error;
  }
  const parsed = compiler.parseWat(filename, source);
  try {
    parsed.resolveNames();
    parsed.validate();
    const binary = parsed.toBinary({ write_debug_names: true });
    return await WebAssembly.compile(new Uint8Array(binary.buffer));
  } finally {
    parsed.destroy();
  }
}
