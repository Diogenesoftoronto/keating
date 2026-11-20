import { createEvaluator } from "nix-eval";

self.onmessage = async ({ data: source }: MessageEvent<string>) => {
  let initialized = false;
  try {
    const evaluator = await createEvaluator({ strict: true });
    initialized = true;
    const { errors, output } = await evaluator.eval(source, "/lesson.nix");
    if (errors.trim()) throw new Error(errors.trim().slice(0, 8192));
    self.postMessage({ ok: true, value: output.trim().slice(0, 8192) });
  } catch (error) {
    self.postMessage({ ok: false, unavailable: !initialized, error: error instanceof Error ? error.message : String(error) });
  }
};
