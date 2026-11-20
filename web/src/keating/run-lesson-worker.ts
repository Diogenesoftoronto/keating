type LessonWorkerReply<T> = { ok: true; value: T } | { ok: false; error: string; unavailable?: boolean };

function environmentError(message: string) {
  const error = new Error(message);
  error.name = "LessonEnvironmentError";
  return error;
}

/** One editable exercise per worker. Even synchronous Wasm can be stopped by the UI. */
export function runLessonWorker<T>(
  worker: Worker, source: string, signal: AbortSignal, timeoutMs = 15_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const dispose = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
    };
    const fail = (reason: unknown) => { dispose(); reject(reason); };
    const cancel = () => fail(new DOMException("Run stopped.", "AbortError"));
    const timer = setTimeout(() => fail(new Error("Time limit reached. Check for an unbounded loop or recursion and try again.")), timeoutMs);
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }: MessageEvent<LessonWorkerReply<T>>) => {
      if (!data?.ok) {
        const message = data?.error || "The exercise worker returned an invalid result.";
        fail(data?.unavailable || !data ? environmentError(message) : new Error(message));
        return;
      }
      dispose();
      resolve(data.value);
    };
    worker.onerror = (event) => fail(environmentError(event.message || "Could not load the exercise worker."));
    worker.onmessageerror = () => fail(environmentError("Could not read the exercise result."));
    try { worker.postMessage(source); } catch (error) { fail(error); }
  });
}
