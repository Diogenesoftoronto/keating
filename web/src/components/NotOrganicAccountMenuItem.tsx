import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { css } from "../../styled-system/css";
import { NOTORGANIC_PROVIDER_ID, notOrganicPublicClient } from "../notorganic-provider";
import { notifyProviderCredentialsChanged, PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../keating/model-prefs";
import { promptNotOrganicAccess } from "./NotOrganicAccessPromptDialog";

export function NotOrganicAccountMenuItem({ className, onSignIn }: { className?: string; onSignIn(): void }) {
  const [client] = useState(notOrganicPublicClient);
  const readConnected = () => {
    try { return Boolean(client?.getSession()); } catch { return false; }
  };
  const [connected, setConnected] = useState(readConnected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const refresh = () => setConnected(readConnected());
    window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [client]);

  if (!client) return null;

  const logOut = async () => {
    setBusy(true);
    setError("");
    try {
      const completion = client.signOut();
      // signOut clears local access before attempting remote revocation.
      setConnected(readConnected());
      notifyProviderCredentialsChanged(NOTORGANIC_PROVIDER_ID);
      await completion;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Log out could not finish. Please try again.");
    } finally {
      setConnected(readConnected());
      setBusy(false);
      notifyProviderCredentialsChanged(NOTORGANIC_PROVIDER_ID);
    }
  };

  return <>
    <button type="button" className={className} disabled={busy} onClick={() => {
      if (connected) void logOut();
      else {
        onSignIn();
        void promptNotOrganicAccess({ allowSignIn: true });
      }
    }}>
      {connected || busy ? <LogOut size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}
      {busy ? "Logging out…" : connected ? "Log out" : "Sign in"}
    </button>
    {error && <p role="alert" className={css({ padding: "0.5rem 0.75rem", fontSize: "0.75rem", color: "var(--destructive)", overflowWrap: "anywhere" })}>{error}</p>}
  </>;
}
