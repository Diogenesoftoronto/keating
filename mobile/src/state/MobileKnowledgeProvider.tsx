import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useNotOrganicAccount } from "./NotOrganicAccountProvider";
import { defaultNotOrganicAccountConfig } from "@/lib/notorganic-account/contracts";
import { loadMobileKnowledgeSources, mobileKnowledgeRequest, type MobileKnowledgeSource } from "@/lib/notorganic-account/knowledge";
import { executeMobileKnowledgeTool, type MobileKnowledgeRuntime } from "@/lib/knowledge-tools";
import type { MobileToolExecutionContext, MobileToolExecutionResult } from "@/lib/mobile-tools";

interface KnowledgeValue {
  sources: MobileKnowledgeSource[]; selected: string[]; approved: string[]; busy: boolean; error: string | null; enabled: boolean;
  refresh(): Promise<void>; toggleSource(id: string): void; toggleTool(id: string, name: string): void;
  execute(name: string, args: string | Readonly<Record<string, unknown>>, context: MobileToolExecutionContext): Promise<MobileToolExecutionResult>;
}
const Context = createContext<KnowledgeValue | null>(null);
export const mobileKnowledgeToolKey = (id: string, name: string) => JSON.stringify([id, name]);

export function MobileKnowledgeProvider({ children }: PropsWithChildren) {
  const account = useNotOrganicAccount();
  const identity = account.status === "signed-in" && account.session?.issuer === defaultNotOrganicAccountConfig().issuer
    ? account.session.accountId ?? null : null;
  const enabled = !!identity && !!account.session?.scope.split(/\s+/).includes("knowledge:read");
  const boundary = useRef({ identity, enabled, epoch: 0 });
  if (boundary.current.identity !== identity || boundary.current.enabled !== enabled) boundary.current = { identity, enabled, epoch: boundary.current.epoch + 1 };
  const [sources, setSources] = useState<MobileKnowledgeSource[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [approved, setApproved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = useRef({ selected, approved, epoch: boundary.current.epoch });
  // A render detecting a changed account invalidates selection before any effect runs.
  if (selection.current.epoch !== boundary.current.epoch) selection.current = { selected: [], approved: [], epoch: boundary.current.epoch };
  else selection.current = { selected, approved, epoch: boundary.current.epoch };
  const attempts = useRef(new Set<string>());
  const renderBoundary = boundary.current;
  const refresh = useCallback(async () => {
    const captured = boundary.current;
    if (!captured.enabled) return;
    const current = () => boundary.current === captured;
    setBusy(true); setError(null);
    try {
      const next = await loadMobileKnowledgeSources(current);
      if (!current()) return;
      setSources(next);
      setSelected(previous => previous.filter(id => next.some(source => source.id === id)));
      setApproved(previous => previous.filter(key => next.some(source => source.tools.some(tool => mobileKnowledgeToolKey(source.id, tool.name) === key))));
    } catch (cause) {
      if (current()) { setSources([]); setError(cause instanceof Error ? cause.message : "Knowledge sources could not be loaded."); }
    } finally { if (current()) setBusy(false); }
  }, []);
  useEffect(() => { setSources([]); setSelected([]); setApproved([]); setError(null); setBusy(false); attempts.current = new Set(); void refresh(); }, [identity, enabled, refresh]);
  useEffect(() => { const listener = AppState.addEventListener("change", state => { if (state === "active") void refresh(); }); return () => listener.remove(); }, [refresh]);
  const execute = useCallback(async (name: string, args: string | Readonly<Record<string, unknown>>, context: MobileToolExecutionContext) => {
    const captured = boundary.current;
    const current = () => captured.enabled && boundary.current === captured;
    const runtime: MobileKnowledgeRuntime = {
      current, selected: id => current() && selection.current.selected.includes(id),
      approved: (id, tool) => current() && selection.current.approved.includes(mobileKnowledgeToolKey(id, tool)), attempted: attempts.current,
      sources: () => loadMobileKnowledgeSources(current), request: (path, init) => mobileKnowledgeRequest(path, init, current),
    };
    return executeMobileKnowledgeTool(name, args, context, runtime);
  }, []);
  const value = useMemo<KnowledgeValue>(() => ({ sources: enabled ? sources : [], selected: selection.current.selected, approved: selection.current.approved, busy, error, enabled, refresh, execute,
    toggleSource: id => {
      if (!enabled || boundary.current !== renderBoundary) return;
      const next = selection.current.selected.includes(id) ? selection.current.selected.filter(value => value !== id) : [...selection.current.selected, id];
      const approvedNext = selection.current.approved.filter(key => !key.startsWith(`[${JSON.stringify(id)},`));
      selection.current = { ...selection.current, selected: next, approved: approvedNext }; setSelected(next); setApproved(approvedNext);
    },
    toggleTool: (id, name) => {
      if (!enabled || boundary.current !== renderBoundary || !selection.current.selected.includes(id)) return;
      const key = mobileKnowledgeToolKey(id, name), next = selection.current.approved.includes(key) ? selection.current.approved.filter(value => value !== key) : [...selection.current.approved, key];
      selection.current = { ...selection.current, approved: next }; setApproved(next);
    },
  }), [sources, selected, approved, busy, error, enabled, renderBoundary, refresh, execute]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useMobileKnowledge(): KnowledgeValue { const value = useContext(Context); if (!value) throw Error("Knowledge provider is missing."); return value; }
