export interface LinuxLessonResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type LinuxLessonReply = { result: LinuxLessonResult } | { error: string };

/** One disposable guest per invocation. The UI owns cancellation, including navigation. */
export async function runLinuxLesson(script: string, signal: AbortSignal): Promise<LinuxLessonResult> {
  signal.throwIfAborted();
  if (new TextEncoder().encode(script).byteLength > 32_768) {
    throw new Error("This script exceeds the 32 KiB lesson limit.");
  }
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
    throw new Error("This browser needs Web Workers and WebAssembly to run the Linux lab.");
  }

  const worker = new Worker(new URL("./linux-lesson.worker.ts", import.meta.url), { type: "module" });
  let cleanup: (() => void) | undefined;
  try {
    return await new Promise<LinuxLessonResult>((resolve, reject) => {
      // Covers kernel download, boot and execution, even when the guest's CPU is busy.
      const timer = setTimeout(() => reject(new Error("The Linux lab reached its 60-second time limit.")), 60_000);
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      worker.onmessage = ({ data }: MessageEvent<LinuxLessonReply>) => {
        if ("error" in data) reject(new Error(data.error));
        else resolve(data.result);
      };
      worker.onerror = () => reject(new Error("The Linux lab worker could not start in this browser."));
      worker.onmessageerror = () => reject(new Error("The Linux lab could not return its output."));
      worker.postMessage(script);
    });
  } finally {
    cleanup?.();
    worker.terminate();
  }
}
