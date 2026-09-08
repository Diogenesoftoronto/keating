import { useEffect, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import { DEFAULT_NOTORGANIC_PACK_ID, getNotOrganicPack, type NotOrganicPack, type NotOrganicPackId } from "../notorganic-provider/packs";
import "./credit-waitlist.css";

const CHANGE_EVENT = "keating:credit-waitlist-changed";


export type PricingWaitlistVariant = "control" | "test";
export type CreditWaitlistPanelState = "prompt" | "loading" | "success" | "error";

type CreditWaitlistRequest = {
	id: string;
	packId: NotOrganicPackId;
	pricingVariant: PricingWaitlistVariant;
};

let activeRequest: CreditWaitlistRequest | null = null;

export function getActiveCreditWaitlistRequest(): CreditWaitlistRequest | null {
	return activeRequest;
}

function emitChange() {
	window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Collect launch interest when hosted checkout is unavailable on this deployment. */
export function promptCreditWaitlist(
	packId: NotOrganicPackId = DEFAULT_NOTORGANIC_PACK_ID,
	pricingVariant: PricingWaitlistVariant = "control",
): void {
	if (typeof window === "undefined") return;
	activeRequest = { id: crypto.randomUUID(), packId, pricingVariant };
	emitChange();
}

export function closeCreditWaitlist(): void {
	if (!activeRequest) return;
	activeRequest = null;
	emitChange();
}

export function CreditWaitlistPanel({ pack, state, message, onJoin, onDismiss }: {
  pack: NotOrganicPack; state: CreditWaitlistPanelState; message?: string;
  onJoin(email: string, website: string): void; onDismiss(): void;
}) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLInputElement>("input[type=email]")?.focus();
    return () => prior?.focus();
  }, []);
  return <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="credit-waitlist-title" className="credit-waitlist" onKeyDown={event => {
    if (event.key === "Escape") onDismiss();
    if (event.key === "Tab") {
      const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([tabindex="-1"]), a[href]');
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}>
    <header><h2 id="credit-waitlist-title">{state === "success" ? "You're on the list" : "Get the launch email"}</h2><button type="button" onClick={onDismiss} aria-label="Close waitlist">×</button></header>
    {state === "success" ? <div className="credit-waitlist__content"><p role="status">{message || "Your email is saved. We'll let you know when hosted credits are ready."}</p><button type="button" onClick={onDismiss}>Done</button></div> :
      <form className="credit-waitlist__content" onSubmit={event => { event.preventDefault(); if (consent && state !== "loading") onJoin(email, website); }}>
        <p>The <strong>{pack.label}</strong> pack (${pack.priceUsd}) isn't available to buy yet. Leave your email to hear when hosted credits launch. Nothing will be charged.</p>
        <label>Email address<input type="email" name="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={state === "loading"} /></label>
        <label className="credit-waitlist__honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} /></label>
        <label className="credit-waitlist__consent"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} disabled={state === "loading"} /><span>Email me about the Keating hosted credits launch. You can unsubscribe from launch emails.</span></label>
        {state === "error" && <p role="alert" className="credit-waitlist__error">{message || "Your email couldn't be saved. Please try again."}</p>}
        <button type="submit" className="credit-waitlist__submit" disabled={!consent || state === "loading"}>{state === "loading" ? "Saving your email…" : "Join the email waitlist"}</button>
        <p className="credit-waitlist__note">Keating is free today with your own API keys.</p>
      </form>}
  </div>;
}

export function CreditWaitlistDialog() {
  const posthog = usePostHog();
  const [request, setRequest] = useState(activeRequest);
  const [state, setState] = useState<CreditWaitlistPanelState>("prompt");
  const [message, setMessage] = useState("");
  useEffect(() => { const sync = () => { setRequest(activeRequest); setState("prompt"); setMessage(""); }; window.addEventListener(CHANGE_EVENT, sync); return () => window.removeEventListener(CHANGE_EVENT, sync); }, []);
  const pack = request ? getNotOrganicPack(request.packId) : undefined;
  useEffect(() => { if (request && pack) posthog?.capture("credit_waitlist_prompt_shown", { pack_id: pack.id, pricing_cta_variant: request.pricingVariant }); }, [request?.id]);
  if (!request || !pack) return null;
  async function join(email: string, website: string) {
    if (!request || !pack) return;
    const id = request.id;
    setState("loading");
    try {
      const response = await fetch("/api/credit-waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, packId: pack.id, consent: true, website }), signal: AbortSignal.timeout(90_000) });
      const result = await response.json();
      if (!response.ok || result.joined !== true) throw new Error(response.status === 429 ? "Too many attempts. Please try again in 15 minutes." : response.status === 409 ? "This address has opted out of Keating emails. Use another address or update your email preferences." : "Your email couldn't be saved. Please try again shortly.");
      if (activeRequest?.id !== id) return;
      setState("success");
      setMessage(result.confirmation === "unavailable" ? "Your email is saved on the waitlist. The confirmation email couldn't be sent, but your launch notification registration is complete." : result.confirmation === "already_registered" ? "Your email is on the waitlist. We'll let you know when hosted credits are ready." : "Your email is saved. A confirmation email has been sent; we'll let you know when hosted credits are ready.");
      posthog?.capture("credit_waitlist_joined", { pack_id: pack.id, pricing_cta_variant: request.pricingVariant });
    } catch (error) { if (activeRequest?.id !== id) return; setState("error"); setMessage(error instanceof Error && error.name !== "TimeoutError" ? error.message : "The request timed out. Please try again; duplicate signups won't send another confirmation."); }
  }
  return <div className="credit-waitlist-overlay"><CreditWaitlistPanel key={request.id} pack={pack} state={state} message={message} onJoin={(email, website) => void join(email, website)} onDismiss={closeCreditWaitlist} /></div>;
}
