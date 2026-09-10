import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { createNotOrganicCheckout, getNotOrganicWallet } from "../notorganic-provider";
import { publicClientMaxCostMicrousd } from "../notorganic-provider/public-client";
import type { NotOrganicPackId } from "../notorganic-provider/packs";
import { availableCreditPacks, canRetryWithWallet, formatCreditBalance, normalizeCreditWallet, type CreditWallet } from "../notorganic-provider/credit-wallet";
import { KeatingCreditSprite } from "./KeatingCreditSprite";

export interface CreditRecoveryCardProps {
  wallet?: CreditWallet;
  refreshing?: boolean;
  checkingOut?: boolean;
  retrying?: boolean;
  error?: string;
  checkoutUrl?: string;
  requiredMicros?: number;
  checkoutEnabled?: boolean;
  details?: string;
  initialPackId?: NotOrganicPackId;
  preserveMessage?: boolean;
  onRefresh(): void;
  onRetry?(): void;
  onCheckout(packId: NotOrganicPackId): void;
  onModelSelect?(): void;
}

export function CreditRecoveryCard({ wallet, refreshing = false, checkingOut = false, retrying = false, error,
  checkoutUrl, requiredMicros = 100_000, checkoutEnabled = false, details, initialPackId, preserveMessage = true,
  onRefresh, onRetry, onCheckout, onModelSelect }: CreditRecoveryCardProps) {
  const [showPacks, setShowPacks] = useState(!!initialPackId);
  const [selected, setSelected] = useState<NotOrganicPackId>(initialPackId ?? "keating_pack_10");
  const titleId = useId();
  const packGroup = useId();
  const ready = canRetryWithWallet(wallet, requiredMicros);
  const packs = availableCreditPacks(wallet, checkoutEnabled);
  const chosen = packs.find(pack => pack.id === selected) ?? packs[0];
  const starter = wallet?.welcomeCredit;
  const hasStarter = !!starter?.granted && starter.remainingMicros > 0;
  const busy = refreshing || checkingOut || retrying;
  return <section className="keating-credit-recovery" aria-labelledby={titleId} aria-busy={busy}>
    <KeatingCreditSprite refreshing={refreshing} ready={ready} balanceMicros={wallet?.availableMicros} />
    <div className="keating-credit-recovery__body">
      <h3 id={titleId}>{ready ? hasStarter ? "Your starter credit is ready" : "Ready to keep learning" : preserveMessage ? "Your message is safe" : "Your Keating credits"}</h3>
      <p>{ready ? "Your wallet has enough credit. You can retry your saved message."
        : preserveMessage ? "Keating needs a little more credit to answer. You won’t need to type your message again." : "Choose a one-time balance for Inkling Small, or check your current credits."}</p>
      <div aria-live="polite" role="status">
        {refreshing ? <p>Checking your wallet…</p> : wallet
          ? <div className="keating-credit-recovery__balance"><p><strong>{formatCreditBalance(wallet.availableMicros)}</strong> available</p>
            {ready && <button type="button" disabled={busy} onClick={() => setShowPacks(value => !value)} aria-expanded={showPacks}>Top up</button>}</div>
          : <p className="keating-credit-recovery__muted">Your balance hasn’t been verified yet.</p>}
        {hasStarter && <p className="keating-credit-recovery__muted">Your account received {formatCreditBalance(starter!.amountMicros)} in one-time free starter credit.</p>}
        {wallet?.blocked && <p>Your account needs attention before hosted responses can continue. Adding credits may not resolve an account restriction.</p>}
        {checkoutUrl && !ready && !refreshing && <p>Come back after checkout and refresh your balance. Payment is confirmed by your wallet, not this page.</p>}
      </div>
      {error && <p className="keating-credit-recovery__error" role="alert">{error}</p>}
      <div className="keating-credit-recovery__actions">
        {ready && onRetry ? <button type="button" data-primary="true" disabled={busy} onClick={onRetry}>{retrying ? "Resuming…" : preserveMessage ? "Retry response" : "Continue"}</button>
          : <button type="button" data-primary="true" disabled={busy} onClick={() => setShowPacks(value => !value)} aria-expanded={showPacks}>Add credits</button>}
        <button type="button" disabled={busy} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" />{refreshing ? "Refreshing…" : "Refresh balance"}</button>
        {onModelSelect && <button type="button" disabled={busy} onClick={onModelSelect}>Choose another model</button>}
      </div>
      {showPacks && <fieldset disabled={busy}>
        <legend>One-time credit packs · USD</legend>
        {packs.length ? <>
          <div className="keating-credit-recovery__packs">{packs.map(pack => <label key={pack.id} className="keating-credit-recovery__pack">
            <input type="radio" name={packGroup} value={pack.id} checked={chosen?.id === pack.id} onChange={() => setSelected(pack.id)} />
            ${pack.priceUsd}
          </label>)}</div>
          <p className="keating-credit-recovery__muted">The amount you choose becomes AI credit. No subscription.</p>
          <div className="keating-credit-recovery__actions"><button type="button" data-primary="true" disabled={busy || !chosen} onClick={() => chosen && onCheckout(chosen.id)}>{checkingOut ? "Preparing checkout…" : `Continue to checkout · $${chosen?.priceUsd}`}</button></div>
        </> : <>
          <p>Credit purchases aren’t available right now.{preserveMessage ? " Your saved message will stay here." : ""}</p>
          <p className="keating-credit-recovery__muted">Refresh to check your balance and any starter credit, or use another model.</p>
        </>}
      </fieldset>}
      {checkoutUrl && <div className="keating-credit-recovery__actions"><a className="keating-credit-recovery__link" href={checkoutUrl} target="_blank" rel="noopener noreferrer">Open secure checkout <ArrowUpRight size={14} aria-hidden="true" /></a></div>}
      {details && <details><summary>Technical details</summary><p>{details}</p></details>}
    </div>
  </section>;
}

export function NotOrganicCreditRecovery({ onRetry, onModelSelect, details, initialPackId, preserveMessage = true }: {
  onRetry?: () => void | Promise<void>;
  onModelSelect?: () => void;
  details?: string;
  initialPackId?: NotOrganicPackId;
  preserveMessage?: boolean;
}) {
  const [wallet, setWallet] = useState<CreditWallet>();
  const [refreshing, setRefreshing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string>();
  const [checkoutUrl, setCheckoutUrl] = useState<string>();
  const mounted = useRef(true);
  const pending = useRef(false);
  const checkoutEnabled = import.meta.env?.VITE_NOTORGANIC_CHECKOUT_ENABLED === "true";
  const requiredMicros = publicClientMaxCostMicrousd();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const readWallet = useCallback(async () => {
    setRefreshing(true);
    try {
      const verified = normalizeCreditWallet(await getNotOrganicWallet());
      if (mounted.current) { setWallet(verified); setError(undefined); }
      return verified;
    } catch {
      if (mounted.current) { setWallet(undefined); setError("We couldn’t verify your balance. Check your connection and refresh again."); }
      return undefined;
    } finally { if (mounted.current) setRefreshing(false); }
  }, []);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    try { await readWallet(); } finally { pending.current = false; }
  }, [readWallet]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!checkoutUrl) return;
    const check = () => { if (document.visibilityState !== "hidden") void refresh(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [checkoutUrl, refresh]);
  const retry = async () => {
    if (pending.current || !onRetry) return;
    pending.current = true;
    setRetrying(true);
    try {
      const verified = await readWallet();
      if (mounted.current && canRetryWithWallet(verified, requiredMicros)) await onRetry();
    } finally { pending.current = false; if (mounted.current) setRetrying(false); }
  };
  const checkout = async (packId: NotOrganicPackId) => {
    if (pending.current) return;
    pending.current = true;
    setCheckingOut(true);
    setError(undefined);
    try {
      const verified = await readWallet();
      if (!availableCreditPacks(verified, checkoutEnabled).some(pack => pack.id === packId)) throw new Error("Credit purchases aren’t available right now. Your message is still saved.");
      // The hosted gateway requires HTTPS. Keep the chat open, including in
      // desktop, and verify the authenticated wallet when focus returns.
      const result = await createNotOrganicCheckout(packId, "https://keating.help/pricing?checkout=returned");
      const url = new URL(result.url ?? result.checkout_url ?? "");
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Checkout could not be opened. Please try again.");
      if (mounted.current) {
        setCheckoutUrl(url.href);
        window.open(url.href, "_blank", "noopener,noreferrer");
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Checkout could not be opened. Your message is still saved.");
    } finally { pending.current = false; if (mounted.current) setCheckingOut(false); }
  };
  return <CreditRecoveryCard wallet={wallet} refreshing={refreshing} checkingOut={checkingOut} retrying={retrying}
    requiredMicros={requiredMicros} checkoutEnabled={checkoutEnabled} error={error} checkoutUrl={checkoutUrl} details={details}
    initialPackId={initialPackId} preserveMessage={preserveMessage} onRefresh={() => void refresh()} onRetry={onRetry ? () => void retry() : undefined}
    onCheckout={packId => void checkout(packId)} onModelSelect={onModelSelect} />;
}
