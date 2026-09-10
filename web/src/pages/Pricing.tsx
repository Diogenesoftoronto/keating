import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, RefreshCw } from "lucide-react";
import { usePostHog } from "@posthog/react";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { useSeo } from "../hooks/useSeo";
import {
	CreditWaitlistDialog,
	promptCreditWaitlist,
	type PricingWaitlistVariant,
} from "../components/CreditWaitlistDialog";
import {
	NOTORGANIC_PACKS,
	type NotOrganicPack,
} from "../notorganic-provider/packs";
import { NotOrganicPublicClient, publicClientConfig } from "../notorganic-provider/public-client";
import { createNotOrganicCheckout, createNotOrganicSubscriptionCheckout } from "../notorganic-provider";
import { availableCreditPacks, formatCreditBalance, normalizeCreditWallet, type CreditWallet } from "../notorganic-provider/credit-wallet";
import { KEATING_PERSONAL_PLAN, subscriptionAvailable, subscriptionCheckoutEnabled } from "../notorganic-provider/plans";
import "./pricing-page.css";

const FAQ_ITEMS = [
	{ q: "What does the free option include?", a: "Keating’s teaching tools, practice, and review. Connect your own model provider; that provider bills any AI usage separately." },
	{ q: "How are credits used?", a: "Credits buy hosted services at Not Organic’s published retail rates, not raw model-provider cost. Usage depends on the model and conversation length. Extra usage requires a top-up." },
	{ q: "Can I buy credits without a subscription?", a: "Yes. Buy $10, $25, or $50 of hosted AI credit with a free account. No subscription is required, and purchased credit does not expire." },
	{ q: "Is this a subscription?", a: "Personal is $25 USD per month and includes $5 in monthly hosted credit. Unused monthly credit rolls forward one billing cycle. Credit packs are separate, one-time top-ups that do not expire." },
	{ q: "Can I use credits on another device?", a: "Your credit balance belongs to your account. Connect that same account on each device to use it." },
];

export const PRICING_WAITLIST_EXPERIMENT_KEY = "pricing-waitlist-cta-copy";

export function pricingWaitlistCta(
	pack: NotOrganicPack,
	variant: PricingWaitlistVariant,
): string {
	return variant === "test" ? `Continue with ${pack.label}` : `Choose ${pack.label}`;
}

export type PricingAvailability = "waitlist" | "checkout_connect_required" | "checkout";

const REQUIRED_PUBLIC_SCOPES = [
	"wallet:read",
	"usage:read",
	"billing:checkout",
	"infer:balanced",
] as const;

export function isPublicCheckoutConfigured(
	env: Record<string, string | undefined>,
	origin = typeof window !== "undefined" ? window.location.origin : undefined,
): boolean {
	const config = publicClientConfig(env, origin);
	const scopes = new Set(config?.scope?.trim().split(/\s+/) ?? []);
	return env.VITE_NOTORGANIC_ENABLED === "true"
		&& env.VITE_NOTORGANIC_CHECKOUT_ENABLED === "true"
		&& !!config
		&& REQUIRED_PUBLIC_SCOPES.every((scope) => scopes.has(scope));
}

export function pricingAvailability(
	checkoutConfigured: boolean,
	providerConnected: boolean,
): PricingAvailability {
	if (!checkoutConfigured) return "waitlist";
	return providerConnected ? "checkout" : "checkout_connect_required";
}

export function Pricing() {
	const posthog = usePostHog();
	const [pricingVariant, setPricingVariant] = useState<PricingWaitlistVariant>("control");
	const checkoutConfigured = isPublicCheckoutConfigured(import.meta.env);
	const [publicClient] = useState(() => {
		const config = publicClientConfig();
		return config ? new NotOrganicPublicClient(config) : null;
	});
	const [providerSession] = useState(() => {
		return publicClient?.getSession() ?? null;
	});
	const [billingError, setBillingError] = useState<string | null>(null);
	const [walletSummary, setWalletSummary] = useState<string | null>(null);
	const [wallet, setWallet] = useState<CreditWallet>();
	const [walletLoading, setWalletLoading] = useState(false);
	const [pendingPack, setPendingPack] = useState<string | null>(null);
	const checkoutPending = useRef(false);
	const availability = pricingAvailability(checkoutConfigured && (!providerSession || availableCreditPacks(wallet, true).length > 0), Boolean(providerSession));
	useEffect(() => {
		const selected = new URLSearchParams(window.location.search).get("pack");
		const pack = NOTORGANIC_PACKS.find(item => item.id === selected);
		if (pack && !checkoutConfigured) promptCreditWaitlist(pack.id);
	}, [checkoutConfigured]);
	useSeo({
		title: "Pricing — Keating",
		description: "Keating is free with your own API keys. Personal is $25 per month with $5 hosted credit. One-time top-ups start at $10.",
		canonical: "https://keating.help/pricing",
	});

	useEffect(() => {
		if (!posthog) return;
		const syncVariant = () => {
			setPricingVariant(
				posthog.getFeatureFlag(PRICING_WAITLIST_EXPERIMENT_KEY) === "test"
					? "test"
					: "control",
			);
		};
		syncVariant();
		return posthog.onFeatureFlags(syncVariant);
	}, [posthog]);

	const refreshWallet = async () => {
		if (!publicClient || !providerSession) return;
		setWalletLoading(true);
		try {
			const response = await publicClient.request("/v1/wallet");
			const result = await response.json().catch(() => null);
			if (!response.ok) {
				throw new Error("We couldn’t load your credit balance. Try refreshing it.");
			}
			const verified = normalizeCreditWallet(result);
			setWallet(verified);
			setWalletSummary(`${formatCreditBalance(verified.availableMicros)} available`);
			setBillingError(null);
		} catch (cause) {
			setWallet(undefined);
			setBillingError("We couldn’t load your credit balance. Try refreshing it.");
		} finally {
			setWalletLoading(false);
		}
	};
	const checkoutReturned =
		typeof window !== "undefined" &&
		new URLSearchParams(window.location.search).get("checkout") === "returned";

	useEffect(() => {
		if (providerSession) void refreshWallet();
		// The client and session are fixed for this page lifetime. Reauthorization
		// returns through a fresh mount, so polling is neither needed nor desirable.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [providerSession]);


	const buyPack = async (pack: NotOrganicPack) => {
		if (checkoutPending.current) return;
		// Keep the established event name stable: selecting a pack is purchase
		// intent, not a completed checkout. The availability property makes that
		// distinction explicit without breaking historical funnels.
		posthog?.capture("pricing_pack_selected", {
			pack_id: pack.id,
			price_usd: pack.priceUsd,
			availability,
			pricing_cta_variant: pricingVariant,
		});
		if (!publicClient || availability === "waitlist") {
			promptCreditWaitlist(pack.id, pricingVariant);
			return;
		}
		checkoutPending.current = true;
		setPendingPack(pack.id);
		try {
			setBillingError(null);
			if (!providerSession) {
				window.location.assign(await publicClient.authorizationUrl(`/pricing?pack=${pack.id}`));
				return;
			}
			const result = await createNotOrganicCheckout(pack.id, "https://keating.help/pricing?checkout=returned");
			const checkoutUrl = typeof result?.url === "string" ? result.url : typeof result?.checkout_url === "string" ? result.checkout_url : null;
			if (!checkoutUrl || new URL(checkoutUrl).protocol !== "https:") throw new Error("Checkout unavailable");
			window.location.assign(checkoutUrl);
		} catch {
			setBillingError(providerSession
				? "We couldn’t open checkout. Your selection is still here; please try again."
				: "We couldn’t open account sign-in. Please try choosing your pack again.");
		} finally {
			checkoutPending.current = false;
			setPendingPack(null);
		}
	};

	const plansEnabled = checkoutConfigured && subscriptionCheckoutEnabled(import.meta.env);
	const planAvailable = subscriptionAvailable(wallet, plansEnabled);
	const buySubscription = async () => {
		if (checkoutPending.current || !plansEnabled || !publicClient) return;
		checkoutPending.current = true;
		setPendingPack(KEATING_PERSONAL_PLAN.id);
		try {
			setBillingError(null);
			if (!providerSession) {
				window.location.assign(await publicClient.authorizationUrl("/pricing?plan=keating_personal_v2"));
				return;
			}
			if (!planAvailable) throw new Error("Subscription checkout is not available yet.");
			const result = await createNotOrganicSubscriptionCheckout(KEATING_PERSONAL_PLAN.id, "https://keating.help/pricing?checkout=returned");
			const url = result.url ?? result.checkout_url;
			if (!url || new URL(url).protocol !== "https:") throw new Error("Checkout unavailable");
			window.location.assign(url);
		} catch {
			setBillingError("We couldn’t open your subscription checkout. Your current plan and balance have not changed.");
		} finally {
			checkoutPending.current = false;
			setPendingPack(null);
		}
	};

	return (
		<div className="retro-layout retro-page pricing-page">
			<Nav primaryAction="download" />
			<main className="pricing-main">
				<header className="pricing-heading">
					<p className="pricing-eyebrow">Simple pricing</p>
					<h1>Keating is free.<br /><span>Choose how you use AI.</span></h1>
					<p>Bring your own keys, choose Personal, or add prepaid credits.</p>
				</header>

				<section className="pricing-own-key" aria-labelledby="own-key-title">
					<div className="pricing-own-key-copy"><p className="pricing-eyebrow">Your keys. Your choice.</p><h2 id="own-key-title">Use your own model</h2><p>Connect a model provider and start learning.<br />Your provider bills AI usage separately.</p></div>
					<div className="pricing-free-price"><span>$0</span><span>for Keating</span></div>
					<Link to="/chat" className="pricing-button pricing-button--outline">Start learning <ArrowRight size={17} aria-hidden="true" /></Link>
				</section>

				<section className="pricing-own-key" aria-labelledby="personal-title">
					<div className="pricing-own-key-copy"><p className="pricing-eyebrow">Monthly subscription</p><h2 id="personal-title">Keating {KEATING_PERSONAL_PLAN.name}</h2><p>${KEATING_PERSONAL_PLAN.monthlyCreditUsd} in hosted AI credit each month.<br />Unused monthly credit rolls forward one billing cycle. Top up when you need more.</p></div>
					<div className="pricing-free-price"><span>${KEATING_PERSONAL_PLAN.priceUsdMonthly}</span><span>USD / month, before tax</span></div>
					<button type="button" className="pricing-button" disabled={!plansEnabled || (Boolean(providerSession) && !planAvailable) || pendingPack !== null} onClick={() => void buySubscription()}>{pendingPack === KEATING_PERSONAL_PLAN.id ? "Opening…" : !plansEnabled || (providerSession && !planAvailable) ? "Subscription unavailable" : providerSession ? "Choose Personal" : "Connect for Personal"}<ArrowRight size={17} aria-hidden="true" /></button>
				</section>
				<p className="pricing-notice">Existing subscriptions keep their current terms. Personal includes metered hosted usage; custom model training and premium voice are not included.</p>

				<section className="pricing-credits" aria-labelledby="credits-title">
					<div className="pricing-section-heading"><div><p className="pricing-eyebrow">Prepaid credits</p><h2 id="credits-title">A balance that fits you.</h2></div><p>No subscription required. Buy credit with a free account and pay for the AI you use.</p></div>
					{providerSession && <div className="pricing-wallet" aria-live="polite"><div><span className="pricing-wallet-label">Your credit balance</span><strong>{walletSummary ?? (walletLoading ? "Loading…" : "Balance unavailable")}</strong></div><button type="button" className="pricing-text-button" disabled={walletLoading} onClick={() => void refreshWallet()}><RefreshCw size={15} aria-hidden="true" />{walletLoading ? "Refreshing…" : "Refresh balance"}</button></div>}
					{checkoutReturned && <p className="pricing-notice" role="status">You’re back from checkout. Your balance updates once payment is confirmed. Refresh your balance if it hasn’t changed yet.</p>}
					{billingError && <p className="pricing-error" role="alert">{billingError}</p>}
					<div className="pricing-packs" aria-busy={pendingPack !== null}>
						{NOTORGANIC_PACKS.map(pack => <article key={pack.id} className={`pricing-pack${pack.popular ? " pricing-pack--featured" : ""}`}>
							<h3>{pack.label}</h3>
							<p className="pricing-pack-amount"><span>$</span>{pack.priceUsd}</p>
							<p className="pricing-pack-value">${pack.priceUsd} in AI credits</p>
							<button type="button" className={`pricing-button${pack.popular ? "" : " pricing-button--outline"}`} disabled={pendingPack !== null} onClick={() => void buyPack(pack)}>{pendingPack === pack.id ? (providerSession ? "Opening checkout…" : "Opening sign-in…") : pricingWaitlistCta(pack, pricingVariant)}<ArrowRight size={17} aria-hidden="true" /></button>
						</article>)}
					</div>
					<div className="pricing-pack-notes"><span><Check size={15} aria-hidden="true" /> One-time payment, no subscription</span><span><Check size={15} aria-hidden="true" /> Same teaching tools</span><span>Prices in USD</span></div>
				</section>

				<section className="pricing-faq" aria-labelledby="pricing-faq-title"><h2 id="pricing-faq-title">A few things to know.</h2><div>{FAQ_ITEMS.map(item => <details key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>)}</div></section>
			</main>
			<Footer />
			<CreditWaitlistDialog />
		</div>
	);
}
