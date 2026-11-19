import { useEffect, useRef, useState } from "react";
import { Button, Loading } from "../../../design-system/kit";
import { connectLearningIntelligence, learningIntelligenceAccount, subscribeLearningIntelligence } from "../../../keating/learning-intelligence/account";

export function ExtractionAccount() {
  const [account, setAccount] = useState(learningIntelligenceAccount);
  const [connection, setConnection] = useState("");
  const [connecting, setConnecting] = useState(false);
  const connectPending = useRef(false);
  useEffect(() => subscribeLearningIntelligence(() => setAccount(learningIntelligenceAccount())), []);
  return <>
      {account.authorized && <p>Extraction account connected.</p>}
      {!account.authorized && <Button variant="ghost" aria-busy={connecting} aria-disabled={connecting || !account.configured} onClick={async () => {
        if (connectPending.current || !account.configured) return;
        connectPending.current = true;
        setConnecting(true); setConnection("");
        try { window.location.assign(await connectLearningIntelligence(window.location.href)); }
        catch { setConnection("The extraction account could not be connected. Try again when the account service is available."); setConnecting(false); connectPending.current = false; }
      }}>{connecting ? <Loading label="Connecting account" size="inline"/> : "Connect extraction account"}</Button>}
      <p role="status" aria-live="polite" className="sd-footnote">{connection}</p>
      {!account.configured && <p className="sd-footnote">Account connection is unavailable in this build.</p>}
  </>;
}

