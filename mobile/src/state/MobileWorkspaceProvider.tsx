import type { MobileWorkspaceOverlayCommit } from "@keating/learner-contracts";
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { openExpoMobileWorkspace } from "@/lib/mobile-workspace/expo";
import type { MobileWorkspaceEngine } from "@/lib/mobile-workspace/engine";
import type { MobileWorkspaceState } from "@/lib/mobile-workspace/repository";
import { executeMobileTool, type MobileToolExecutionContext, type MobileToolExecutionResult } from "@/lib/mobile-tools";
import { MOBILE_PROGRAM_ENTRYPOINT } from "@/lib/mobile-workspace/program";

interface MobileWorkspaceContextValue {
  state: MobileWorkspaceState | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
  proposeSource: (path: string, source: string, intent: string) => Promise<MobileWorkspaceOverlayCommit>;
  activate: (overlayId: string) => Promise<void>;
  rollback: () => Promise<void>;
  clearError: () => void;
  executeAgentTool: (toolName: string, rawArguments: string | Readonly<Record<string, unknown>>, context: MobileToolExecutionContext) => Promise<MobileToolExecutionResult>;
  hasOverlay: (overlayId: string) => boolean;
}

const MobileWorkspaceContext = createContext<MobileWorkspaceContextValue | null>(null);

export function MobileWorkspaceProvider({ children }: PropsWithChildren) {
  const engineRef = useRef<MobileWorkspaceEngine | null>(null);
  const closeRef = useRef<(() => Promise<void>) | null>(null);
  const [state, setState] = useState<MobileWorkspaceState | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (engine = engineRef.current) => {
    if (engine) setState(await engine.read());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void openExpoMobileWorkspace().then(async ({ engine, repository }) => {
      if (cancelled) { await repository.close(); return; }
      engineRef.current = engine;
      closeRef.current = () => repository.close();
      setState(await engine.read());
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not open the mobile workspace.");
    }).finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; void closeRef.current?.(); };
  }, []);

  const run = useCallback(async <T,>(work: (engine: MobileWorkspaceEngine) => Promise<T>): Promise<T> => {
    const engine = engineRef.current;
    if (!engine) throw new Error("The mobile workspace is not ready yet.");
    setBusy(true); setError(null);
    try { const result = await work(engine); await refresh(engine); return result; }
    catch (cause) { const message = cause instanceof Error ? cause.message : "The workspace operation failed."; setError(message); throw cause; }
    finally { setBusy(false); }
  }, [refresh]);

  const value = useMemo<MobileWorkspaceContextValue>(() => ({
    state, ready, busy, error,
    proposeSource: (path, source, intent) => run((engine) => engine.propose({ intent, requiredCapabilities: ["ui.render"], changes: [{ path, source }] })),
    activate: async (overlayId) => { await run(async (engine) => {
      const receipt = await engine.activate(overlayId);
      if (receipt.status === "rejected") throw new Error(receipt.checks.filter((check) => check.status === "failed").map((check) => check.message).join(" "));
    }); },
    rollback: async () => { await run((engine) => engine.rollback()); },
    clearError: () => setError(null),
    hasOverlay: (overlayId) => state?.overlays.some((overlay) => overlay.id === overlayId) ?? false,
    executeAgentTool: async (toolName, rawArguments, context) => {
      if (toolName !== "inspect_mobile_workspace" && toolName !== "propose_mobile_workspace_change") {
        return executeMobileTool(toolName, rawArguments, context);
      }
      let parsed: unknown = rawArguments;
      try { if (typeof rawArguments === "string") parsed = JSON.parse(rawArguments); }
      catch { return { ok: false, toolName, idempotencyKey: context.idempotencyKey, code: "malformed_json", message: "Tool arguments are not valid JSON.", retryable: false, effects: [] }; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, toolName, idempotencyKey: context.idempotencyKey, code: "invalid_arguments", message: "Workspace tool arguments must be an object.", retryable: false, effects: [] };
      }
      if (toolName === "inspect_mobile_workspace") {
        if (Object.keys(parsed).length !== 0 || !state) return { ok: false, toolName, idempotencyKey: context.idempotencyKey, code: "invalid_arguments", message: state ? "Inspection takes no arguments." : "The workspace is not ready.", retryable: !state, effects: [] };
        return { ok: true, toolName, idempotencyKey: context.idempotencyKey, output: { baseId: state.base.id, activeOverlayId: state.activeOverlayId ?? null, files: state.files.map(({ path, language, source, sha256 }) => ({ path, language, source, sha256 })) }, effects: [] };
      }
      const input = parsed as Record<string, unknown>;
      if (Object.keys(input).sort().join(",") !== "intent,path,source" || input.path !== MOBILE_PROGRAM_ENTRYPOINT
        || typeof input.intent !== "string" || typeof input.source !== "string") {
        return { ok: false, toolName, idempotencyKey: context.idempotencyKey, code: "invalid_arguments", message: `A proposal requires only intent, path=${MOBILE_PROGRAM_ENTRYPOINT}, and complete source.`, retryable: false, effects: [] };
      }
      try {
        const overlay = await run((engine) => engine.propose(
          { intent: input.intent as string, requiredCapabilities: ["ui.render"], changes: [{ path: MOBILE_PROGRAM_ENTRYPOINT, source: input.source as string }] },
          `overlay-${context.idempotencyKey}`,
        ));
        return { ok: true, toolName, idempotencyKey: context.idempotencyKey, output: { overlayId: overlay.id, status: "pending-user-activation", intent: overlay.intent, changedPaths: overlay.changes.map((change) => change.path) }, effects: [] };
      } catch (cause) {
        return { ok: false, toolName, idempotencyKey: context.idempotencyKey, code: "execution_failed", message: cause instanceof Error ? cause.message : "Could not save workspace proposal.", retryable: true, effects: [] };
      }
    },
  }), [state, ready, busy, error, run]);

  return <MobileWorkspaceContext.Provider value={value}>{children}</MobileWorkspaceContext.Provider>;
}

export function useMobileWorkspace(): MobileWorkspaceContextValue {
  const context = useContext(MobileWorkspaceContext);
  if (!context) throw new Error("useMobileWorkspace must be used within MobileWorkspaceProvider.");
  return context;
}
