import { runLessonWorker } from "./run-lesson-worker";

export function runNixExpression(source: string, signal: AbortSignal): Promise<string> {
  const worker = new Worker(new URL("./nix-expression.worker.ts", import.meta.url), { type: "module" });
  return runLessonWorker<string>(worker, source, signal);
}
