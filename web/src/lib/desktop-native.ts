import { buildAgentRuntimeConfig, type KeatingAgentRuntimeConfig } from "../keating/agent-runtime-config";

/** A routing marker only. The local server's address and token stay in Electron. */
export const DESKTOP_NATIVE_ENDPOINT = "desktop://local";

export interface DesktopNativeBridge {
  getNativeRuntime(): Promise<{ projectRoot: string }>;
  executeNative(operation: string, payload: unknown): Promise<unknown>;
}

export function desktopNativeBridge(): DesktopNativeBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { keatingDesktop?: Partial<DesktopNativeBridge> }).keatingDesktop;
  return typeof bridge?.getNativeRuntime === "function" && typeof bridge.executeNative === "function"
    ? bridge as DesktopNativeBridge : null;
}

export function isDesktopNativeRuntime(config: { executionEndpoint?: string | null } | null | undefined): boolean {
  return config?.executionEndpoint === DESKTOP_NATIVE_ENDPOINT;
}

export async function loadDesktopNativeRuntime(bridge: DesktopNativeBridge): Promise<KeatingAgentRuntimeConfig> {
  const { projectRoot } = await bridge.getNativeRuntime();
  if (typeof projectRoot !== "string" || !projectRoot.trim()) throw new Error("Desktop workspace is unavailable.");
  const config = buildAgentRuntimeConfig({ mode: "host", projectRoot, localExecEnabled: true });
  return {
    ...config,
    label: "Desktop · native",
    executionEndpoint: DESKTOP_NATIVE_ENDPOINT,
    projectFilesEndpoint: `${DESKTOP_NATIVE_ENDPOINT}/files`,
    localExecEndpoint: DESKTOP_NATIVE_ENDPOINT,
    fallback: { ...config.fallback, message: "Commands run on this computer with your user permissions. Files are saved in your desktop workspace. This is not an isolated sandbox." },
  };
}

export async function executeDesktopNative(operation: string, payload: unknown): Promise<unknown> {
  const bridge = desktopNativeBridge();
  if (!bridge) throw new Error("Desktop execution is unavailable. Reopen Keating desktop to reconnect.");
  return bridge.executeNative(operation, payload);
}

/** Keep existing tool response handling identical across native and HTTP hosts. */
export async function desktopNativeResponse(operation: string, payload: unknown, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  try {
    const result = operation === "shell.exec" && signal
      ? await executeCancellableCommand(payload, signal)
      : await executeDesktopNative(operation, payload);
    signal?.throwIfAborted();
    return Response.json(result);
  } catch (error) {
    signal?.throwIfAborted();
    return Response.json({ error: error instanceof Error ? error.message : "Desktop operation failed." }, { status: 500 });
  }
}

async function executeCancellableCommand(payload: unknown, signal: AbortSignal): Promise<unknown> {
  const command = payload && typeof payload === "object" ? payload : {};
  const { processId } = await executeDesktopNative("process.start", { ...command, stdinClosed: true }) as { processId: string };
  let finished = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const result = await executeDesktopNative("process.poll", { processId }) as { running: boolean };
      if (!result.running) {
        finished = true;
        return result;
      }
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 100);
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    }
  } finally {
    if (!finished) await executeDesktopNative("process.stop", { processId });
  }
}
