import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { NotOrganicAccountSnapshot, NotOrganicDeviceSession } from "@/lib/notorganic-account/contracts";
import { beginNotOrganicLogin, completeAuthorizationFromUrl } from "@/lib/notorganic-account/auth";
import { loadAccountSnapshot, revokeDeviceSession } from "@/lib/notorganic-account/client";
import { clearDeviceSession, clearPendingAuthorization, loadDeviceSession } from "@/lib/notorganic-account/credentials";
import { deleteDeviceKey } from "@/lib/notorganic-account/dpop";
import {
  fetchPedagogyArtifactBytes,
  loadActiveMobilePedagogyRevision,
} from "@/lib/notorganic-account/evolution";

const ACCOUNT_PEDAGOGY_PROJECT_ID = "keating-account";
const MOBILE_PEDAGOGY_SUPPORT = Object.freeze({
  agentApi: "keating-agent-hooks-v1",
  learnerContract: 1,
  mobileSdk: "56",
  capabilities: ["prompt-set", "teacher-policy"] as const,
});

export interface ActiveAccountPedagogy {
  revisionId: string;
  systemPrompt: string | null;
  teacherPolicy: string | null;
}

type AccountStatus = "loading" | "signed-out" | "authorizing" | "signed-in" | "error";

interface NotOrganicAccountContextValue {
  status: AccountStatus;
  session: NotOrganicDeviceSession | null;
  account: NotOrganicAccountSnapshot | null;
  activePedagogy: ActiveAccountPedagogy | null;
  evolutionError: string | null;
  error: string | null;
  login(): Promise<void>;
  completeLogin(callbackUrl: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const Context = createContext<NotOrganicAccountContextValue | null>(null);

export function NotOrganicAccountProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AccountStatus>("loading");
  const [session, setSession] = useState<NotOrganicDeviceSession | null>(null);
  const [account, setAccount] = useState<NotOrganicAccountSnapshot | null>(null);
  const [activePedagogy, setActivePedagogy] = useState<ActiveAccountPedagogy | null>(null);
  const [evolutionError, setEvolutionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hydratePedagogy = useCallback(async () => {
    try {
      const active = await loadActiveMobilePedagogyRevision({
        projectId: ACCOUNT_PEDAGOGY_PROJECT_ID,
        support: MOBILE_PEDAGOGY_SUPPORT,
      });
      if (!active) {
        setActivePedagogy(null);
        setEvolutionError(null);
        return;
      }
      let systemPrompt: string | null = null;
      let teacherPolicy: string | null = null;
      for (const artifact of active.revision.artifacts) {
        if (artifact.kind !== "prompt-set" && artifact.kind !== "teacher-policy") continue;
        const bytes = await fetchPedagogyArtifactBytes(artifact);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (artifact.kind === "prompt-set") {
          if (artifact.mediaType === "text/markdown" || artifact.mediaType === "text/plain") {
            systemPrompt = text.trim() && text.length <= 1_000_000 ? text : null;
          } else if (artifact.mediaType === "application/json") {
            const value = JSON.parse(text) as { schemaVersion?: unknown; prompts?: { system?: unknown } };
            const candidate = value?.schemaVersion === 1 ? value.prompts?.system : null;
            systemPrompt = typeof candidate === "string" && candidate.trim() && candidate.length <= 1_000_000
              ? candidate
              : null;
          }
        } else if (artifact.mediaType === "application/json" && text.length <= 64_000) {
          const value = JSON.parse(text) as unknown;
          if (value && typeof value === "object" && !Array.isArray(value)) teacherPolicy = JSON.stringify(value);
        }
      }
      setActivePedagogy({ revisionId: active.revision.id, systemPrompt, teacherPolicy });
      setEvolutionError(null);
    } catch (cause) {
      setActivePedagogy(null);
      setEvolutionError(cause instanceof Error ? cause.message : "Could not load account pedagogy evolution.");
    }
  }, []);

  const hydrateAccount = useCallback(async (nextSession: NotOrganicDeviceSession) => {
    setSession(nextSession);
    setStatus("signed-in");
    try {
      setAccount(await loadAccountSnapshot());
      setError(null);
    } catch (cause) {
      // Keep the durable login through transient network failures. A rejected
      // refresh will surface on the next explicit account action.
      setError(cause instanceof Error ? cause.message : "Could not load the Not Organic account.");
    }
    await hydratePedagogy();
  }, [hydratePedagogy]);

  useEffect(() => {
    void loadDeviceSession().then((stored) => {
      if (!stored) { setStatus("signed-out"); return; }
      return hydrateAccount(stored);
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Could not restore the Not Organic login.");
      setStatus("error");
    });
  }, [hydrateAccount]);

  const login = useCallback(async () => {
    setStatus("authorizing");
    setError(null);
    try {
      const next = await beginNotOrganicLogin();
      if (!next) { setStatus(session ? "signed-in" : "signed-out"); return; }
      await hydrateAccount(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not Organic sign-in failed.");
      setStatus(session ? "signed-in" : "error");
    }
  }, [hydrateAccount, session]);

  const completeLogin = useCallback(async (callbackUrl: string) => {
    setStatus("authorizing");
    setError(null);
    try { await hydrateAccount(await completeAuthorizationFromUrl(callbackUrl)); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not Organic sign-in failed.");
      setStatus(session ? "signed-in" : "error");
      throw cause;
    }
  }, [hydrateAccount, session]);

  const logout = useCallback(async () => {
    await revokeDeviceSession().catch(() => undefined);
    await Promise.all([clearDeviceSession(), clearPendingAuthorization(), deleteDeviceKey().catch(() => undefined)]);
    setSession(null);
    setAccount(null);
    setActivePedagogy(null);
    setEvolutionError(null);
    setError(null);
    setStatus("signed-out");
  }, []);

  const refresh = useCallback(async () => {
    const stored = await loadDeviceSession();
    if (!stored) { setStatus("signed-out"); return; }
    await hydrateAccount(stored);
  }, [hydrateAccount]);

  const value = useMemo(
    () => ({ status, session, account, activePedagogy, evolutionError, error, login, completeLogin, logout, refresh }),
    [status, session, account, activePedagogy, evolutionError, error, login, completeLogin, logout, refresh],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNotOrganicAccount(): NotOrganicAccountContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("useNotOrganicAccount must be used within NotOrganicAccountProvider.");
  return value;
}
