import { NOTORGANIC_CHAT_MODEL_IDS, hasNotOrganicInferenceScope } from "@keating/runtime-config";
import { useEffect, useRef, useState } from "react";
import { AppLink as Link } from "../components/AppLink";
import { KeatingGlyph } from "../design-system/glyphs";
import { usePostHog } from "@posthog/react";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { useSeo } from "../hooks/useSeo";
import {
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
import { KEATING_SUBSCRIBER_BENEFITS } from "../notorganic-provider/subscriber-benefits";
import { purchaseWaitlistUrl } from "../notorganic-provider/purchase-waitlist";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../keating/model-prefs";
import "./public-pages.css";
import "./pricing-page.css";

const FAQ_ITEMS = [
	{ q: "What does the free option include?", a: "Keating’s teaching tools, practice, review, local data, and export/import backups. Local sandbox execution is available where supported. Connect your own model provider; that provider bills any AI usage separately." },
	{ q: "Does Personal include sync and a cloud sandbox?", a: "Encrypted cross-device sync, hosted recovery, and a cloud sandbox are planned subscriber benefits. They are not available yet. Cloud execution will have an explicit compute allowance; it will not be unlimited." },
	{ q: "How are credits used?", a: "Credits buy hosted services at Not Organic’s published retail rates, not raw model-provider cost. Usage depends on the model and conversation length. Extra usage requires a top-up." },
	{ q: "Can I buy credits without a subscription?", a: "Yes. A free account can use any of the three credit packs. The Prepaid credits section shows which packs are available for checkout. Purchased credit never expires." },
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
] as const;

export function isPublicCheckoutConfigured(
	env: Record<string, string | undefined>,
	origin = typeof window !== "undefined" ? window.location?.origin : undefined,
): boolean {
	const config = publicClientConfig(env, origin);
	const scopes = new Set(config?.scope?.trim().split(/\s+/) ?? []);
	return env.VITE_NOTORGANIC_ENABLED === "true"
		&& env.VITE_NOTORGANIC_CHECKOUT_ENABLED === "true"
		&& !!config
		&& REQUIRED_PUBLIC_SCOPES.every((scope) => scopes.has(scope))
		&& NOTORGANIC_CHAT_MODEL_IDS.some((model) => hasNotOrganicInferenceScope(scopes, model));
}

export function pricingAvailability(
	checkoutConfigured: boolean,
	providerConnected: boolean,
): PricingAvailability {
	if (!checkoutConfigured) return "waitlist";
	return providerConnected ? "checkout" : "checkout_connect_required";
}

/** `balance_error` = the wallet request failed (retry); `unavailable` = the product itself is not offered (waitlist). */
export type PricingAction = "waitlist" | "connect" | "loading" | "unavailable" | "checkout" | "balance_error";

export function pricingPackAction(checkoutConfigured: boolean, providerConnected: boolean, wallet: CreditWallet | undefined, walletLoading: boolean, packId: string, walletFailed = false): PricingAction {
	if (!checkoutConfigured) return "waitlist";
	if (!providerConnected) return "connect";
	if (walletLoading) return "loading";
	if (!wallet && walletFailed) return "balance_error";
	return availableCreditPacks(wallet, true).some(pack => pack.id === packId) ? "checkout" : "unavailable";
}

/**
 * One line above the packs saying what choosing a pack does right now, so the
 * state is not left to three button labels. `open` is false while nothing can
 * be bought here. A failed balance request returns null: its own alert, with
 * Retry, already says so.
 */
export function pricingPackStatus(actions: readonly PricingAction[]): { open: boolean; text: string } | null {
	if (actions.length === 0 || actions.includes("balance_error")) return null;
	if (actions.includes("loading")) return { open: false, text: "Checking which packs your account can buy…" };
	if (actions.every(action => action === "waitlist")) return { open: false, text: "Checkout isn’t open yet. Each pack links to its waitlist." };
	if (actions.every(action => action === "unavailable")) return { open: false, text: "Checkout isn’t open for this account yet. Each pack links to its waitlist." };
	if (actions.every(action => action === "connect")) return { open: true, text: "Choosing a pack opens sign-in first." };
	if (actions.every(action => action === "checkout")) return { open: true, text: "Choosing a pack opens checkout." };
	return { open: true, text: "Some packs open checkout. The others link to a waitlist." };
}

function readPricingSession(client: NotOrganicPublicClient | null) {
	try { return client?.getSession() ?? null; } catch { return null; }
}

export function pricingPlanAction(plansEnabled: boolean, providerConnected: boolean, wallet: CreditWallet | undefined, walletLoading: boolean, walletFailed = false): PricingAction {
	if (!plansEnabled) return "waitlist";
	if (!providerConnected) return "connect";
	if (walletLoading) return "loading";
	if (!wallet && walletFailed) return "balance_error";
	if (!wallet) return "unavailable";
	return subscriptionAvailable(wallet, true) ? "checkout" : "waitlist";
}

export function Pricing() {
	const posthog = usePostHog();
	const [pricingVariant, setPricingVariant] = useState<PricingWaitlistVariant>("control");
	const checkoutConfigured = isPublicCheckoutConfigured(import.meta.env);
	const [publicClient] = useState(() => {
		const config = publicClientConfig();
		return config ? new NotOrganicPublicClient(config) : null;
	});
	const [providerSession, setProviderSession] = useState(() => readPricingSession(publicClient));
	const [billingError, setBillingError] = useState<{ offerId: string | null; message: string } | null>(null);
	const [walletSummary, setWalletSummary] = useState<string | null>(null);
	const [wallet, setWallet] = useState<CreditWallet>();
	const [walletLoading, setWalletLoading] = useState(Boolean(providerSession));
	const [walletFailed, setWalletFailed] = useState(false);
	const [pendingPack, setPendingPack] = useState<string | null>(null);
	const checkoutPending = useRef(false);
	const walletRequest = useRef(0);
	const availability = pricingAvailability(checkoutConfigured, Boolean(providerSession));
	useEffect(() => {
		const syncSession = () => {
			const next = readPricingSession(publicClient);
			walletRequest.current += 1;
			setProviderSession(next);
			setWallet(undefined);
			setWalletSummary(null);
			setWalletLoading(Boolean(next));
			setWalletFailed(false);
			setBillingError(null);
		};
		window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, syncSession);
		window.addEventListener("storage", syncSession);
		window.addEventListener("focus", syncSession);
		return () => {
			walletRequest.current += 1;
			window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, syncSession);
			window.removeEventListener("storage", syncSession);
			window.removeEventListener("focus", syncSession);
		};
	}, [publicClient]);
	useEffect(() => {
		const selected = new URLSearchParams(window.location.search).get("pack");
		const pack = NOTORGANIC_PACKS.find(item => item.id === selected);
		if (pack && !checkoutConfigured) window.location.assign(purchaseWaitlistUrl("credits", pack.id));
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
		const request = ++walletRequest.current;
		setWalletLoading(true);
		setWalletFailed(false);
		setWallet(undefined);
		setWalletSummary(null);
		try {
			const response = await publicClient.request("/v1/wallet");
			const result = await response.json().catch(() => null);
			if (!response.ok) {
				throw new Error("We couldn’t load your credit balance. Try refreshing it.");
			}
			const verified = normalizeCreditWallet(result);
			if (request !== walletRequest.current) return;
			setWallet(verified);
			setWalletFailed(false);
			setWalletSummary(`${formatCreditBalance(verified.availableMicros)} available`);
			setBillingError(null);
		} catch (cause) {
			if (request !== walletRequest.current) return;
			setWallet(undefined);
			setWalletFailed(true);
			setWalletSummary(null);
			if (!readPricingSession(publicClient)) setProviderSession(null);
			setBillingError({ offerId: null, message: "We couldn’t load your credit balance. Try refreshing it." });
		} finally {
			if (request === walletRequest.current) setWalletLoading(false);
		}
	};
	const checkoutReturned =
		typeof window !== "undefined" &&
		new URLSearchParams(window.location.search).get("checkout") === "returned";

	useEffect(() => {
		if (providerSession) void refreshWallet();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [providerSession]);


	const recordPackIntent = (pack: NotOrganicPack) => {
		// Keep the established event name stable: selecting a pack is purchase
		// intent, not a completed checkout. The availability property makes that
		// distinction explicit without breaking historical funnels.
		posthog?.capture("pricing_pack_selected", {
			pack_id: pack.id,
			price_usd: pack.priceUsd,
			availability,
			pricing_cta_variant: pricingVariant,
		});
	};
	const buyPack = async (pack: NotOrganicPack) => {
		if (checkoutPending.current) return;
		const connected = Boolean(readPricingSession(publicClient));
		const action = pricingPackAction(checkoutConfigured, connected, wallet, walletLoading, pack.id, walletFailed);
		if (action === "loading") return;
		if (action === "balance_error") { void refreshWallet(); return; }
		recordPackIntent(pack);
		if (!publicClient || action === "waitlist" || action === "unavailable") {
			window.location.assign(purchaseWaitlistUrl("credits", pack.id));
			return;
		}
		checkoutPending.current = true;
		setPendingPack(pack.id);
		try {
			setBillingError(null);
			if (!connected) {
				setProviderSession(null);
				window.location.assign(await publicClient.authorizationUrl(`/pricing?pack=${pack.id}`));
				return;
			}
			const result = await createNotOrganicCheckout(pack.id, `${window.location.origin}/pricing?checkout=returned`);
			const checkoutUrl = typeof result?.url === "string" ? result.url : typeof result?.checkout_url === "string" ? result.checkout_url : null;
			if (!checkoutUrl || new URL(checkoutUrl).protocol !== "https:") throw new Error("Checkout unavailable");
			window.location.assign(checkoutUrl);
		} catch {
			setBillingError({
				offerId: pack.id,
				message: connected ? "We couldn’t open checkout. Choose this pack to try again." : "We couldn’t open sign-in. Choose this pack to try again.",
			});
		} finally {
			checkoutPending.current = false;
			setPendingPack(null);
		}
	};

	const plansEnabled = checkoutConfigured && subscriptionCheckoutEnabled(import.meta.env);
	const planAvailable = subscriptionAvailable(wallet, plansEnabled);
	const planAction = pricingPlanAction(plansEnabled, Boolean(providerSession), wallet, walletLoading, walletFailed);
	const buySubscription = async () => {
		if (checkoutPending.current || !plansEnabled || !publicClient) return;
		const connected = Boolean(readPricingSession(publicClient));
		checkoutPending.current = true;
		setPendingPack(KEATING_PERSONAL_PLAN.id);
		try {
			setBillingError(null);
			if (!connected) {
				setProviderSession(null);
				window.location.assign(await publicClient.authorizationUrl("/pricing?plan=keating_personal_v2"));
				return;
			}
			if (!planAvailable) throw new Error("Subscription checkout is not available yet.");
			const result = await createNotOrganicSubscriptionCheckout(KEATING_PERSONAL_PLAN.id, `${window.location.origin}/pricing?checkout=returned`);
			const url = result.url ?? result.checkout_url;
			if (!url || new URL(url).protocol !== "https:") throw new Error("Checkout unavailable");
			window.location.assign(url);
		} catch {
			setBillingError({
				offerId: KEATING_PERSONAL_PLAN.id,
				message: connected ? "We couldn’t open subscription checkout. Choose Personal to try again." : "We couldn’t open sign-in. Select Connect for Personal to try again.",
			});
		} finally {
			checkoutPending.current = false;
			setPendingPack(null);
		}
	};

	const packActions = NOTORGANIC_PACKS.map(pack => pricingPackAction(checkoutConfigured, Boolean(providerSession), wallet, walletLoading, pack.id, walletFailed));
	const packStatus = pricingPackStatus(packActions);
	const lowestPackUsd = Math.min(...NOTORGANIC_PACKS.map(pack => pack.priceUsd));

	return (
		<div className="retro-layout retro-page public-page pricing-page">
			<Nav publication primaryAction="download" />
			<main className="pricing-main">
				<header className="pricing-heading public-enter">
					<h1>Plans <span>&amp;</span> credits.</h1>
					<p className="pricing-lede">Keating’s teaching tools are free. Connect a model you already use, or pay for hosted AI as you go.</p>
					<nav className="pricing-index" aria-label="On this page">
						<a href="#credits-title">
							<span className="pricing-index-label"><span className="pricing-index-full">Prepaid credits</span><span className="pricing-index-short">Credits</span></span>
							<KeatingGlyph name="down" size={13} />
							<span className="pricing-index-hint">from ${lowestPackUsd}</span>
						</a>
						<a href="#subscriber-benefits-title">
							<span className="pricing-index-label"><span className="pricing-index-full">Personal benefits</span><span className="pricing-index-short">Planned</span></span>
							<KeatingGlyph name="down" size={13} />
							<span className="pricing-index-hint">{KEATING_SUBSCRIBER_BENEFITS.length} benefits</span>
						</a>
						<a href="#pricing-faq-title">
							<span className="pricing-index-label">Questions</span>
							<KeatingGlyph name="down" size={13} />
							<span className="pricing-index-hint">{FAQ_ITEMS.length} answers</span>
						</a>
					</nav>
				</header>

				<div className="pricing-comparison public-enter">
					<section className="pricing-plan pricing-plan-own" aria-labelledby="own-key-title">
						<span aria-hidden="true" className="pricing-print public-texture-doodles" />
						<div className="pricing-plan-heading">
							<p className="pricing-eyebrow">Bring your own key</p>
							<h2 id="own-key-title" data-glyph-host><KeatingGlyph name="key" size={23} />Free</h2>
						</div>
						<p className="pricing-price"><strong>$0</strong> <span>for Keating</span></p>
						<ul className="pricing-plan-facts">
							<li>Use your own model for lessons, practice, and review.</li>
							<li>Your provider bills AI usage separately.</li>
						</ul>
						<Link to="/chat" className="pricing-button">Start learning <KeatingGlyph name="right" size={17} /></Link>
					</section>
					<section className="pricing-plan pricing-plan-personal" aria-labelledby="personal-title">
						<span aria-hidden="true" className="pricing-print public-texture-marble" />
						<div className="pricing-plan-heading">
							<p className="pricing-eyebrow">Monthly subscription</p>
							<h2 id="personal-title" data-glyph-host><KeatingGlyph name="book" size={23} />{KEATING_PERSONAL_PLAN.name}</h2>
						</div>
						<p className="pricing-price"><strong>${KEATING_PERSONAL_PLAN.priceUsdMonthly}</strong> <span>USD / month, before tax</span></p>
						<ul className="pricing-plan-facts">
							<li>Includes ${KEATING_PERSONAL_PLAN.monthlyCreditUsd} in hosted AI credit each month.</li>
							<li>Unused monthly credit rolls forward one billing cycle.</li>
						</ul>
						{planAction === "waitlist" ? <a className="pricing-button pricing-button--outline" href={purchaseWaitlistUrl("subscription", KEATING_PERSONAL_PLAN.id)}>Join the Personal waitlist<KeatingGlyph name="ext" size={17} /></a> : <button type="button" className="pricing-button" disabled={pendingPack !== null || planAction === "loading" || planAction === "unavailable"} onClick={() => void (planAction === "balance_error" ? refreshWallet() : buySubscription())}>{planAction === "loading" ? "Checking availability…" : planAction === "balance_error" ? "Retry checking availability" : planAction === "unavailable" ? "Couldn't check availability" : pendingPack === KEATING_PERSONAL_PLAN.id ? "Opening…" : providerSession ? "Choose Personal" : "Connect for Personal"}<KeatingGlyph name="right" size={17} /></button>}
						{billingError?.offerId === KEATING_PERSONAL_PLAN.id && <p className="pricing-error" role="alert">{billingError.message}</p>}
					</section>
				</div>

				<section className="pricing-credits" aria-labelledby="credits-title">
					<div className="pricing-section-heading"><h2 id="credits-title">Prepaid credits</h2><p>Top up a free or Personal account. Purchased credit never expires.</p></div>
					{providerSession && <div className="pricing-wallet" aria-live="polite"><div><span className="pricing-wallet-label">Your credit balance</span><strong>{walletSummary ?? (walletLoading ? "Loading…" : "Balance unavailable")}</strong></div><button type="button" className="pricing-text-button" disabled={walletLoading} onClick={() => void refreshWallet()}><KeatingGlyph name="refresh" size={15} />{walletLoading ? "Refreshing…" : "Refresh balance"}</button></div>}
					{checkoutReturned && <p className="pricing-notice" role="status">You’re back from checkout. Your balance updates once payment is confirmed. Refresh your balance if it hasn’t changed yet.</p>}
					{billingError?.offerId === null && <p className="pricing-error" role="alert">{billingError.message}{walletFailed && providerSession && <> <button type="button" className="pricing-text-button" disabled={walletLoading} onClick={() => void refreshWallet()}>Retry</button></>}</p>}
					{packStatus && <p className={`pricing-status${packStatus.open ? " pricing-status--open" : ""}`}>{packStatus.text}</p>}
					<div className="pricing-packs" aria-busy={pendingPack !== null}>
						{NOTORGANIC_PACKS.map((pack, index) => {
							const action = packActions[index];
							return <article key={pack.id} className={`pricing-pack${pack.popular ? " pricing-pack--featured" : ""}`}>
							<h3 data-glyph-host><KeatingGlyph name="card" size={18} />{pack.label}</h3>
							<p className="pricing-pack-amount"><strong><span>$</span>{pack.priceUsd}</strong> <span className="pricing-pack-unit">of hosted AI credit</span></p>
							{action === "waitlist" || action === "unavailable" ? <a className={`pricing-button${pack.popular ? "" : " pricing-button--outline"}`} href={purchaseWaitlistUrl("credits", pack.id)} onClick={() => recordPackIntent(pack)}>Join waitlist for ${pack.priceUsd} credit<KeatingGlyph name="ext" size={17} /></a> : <button type="button" className={`pricing-button${pack.popular ? "" : " pricing-button--outline"}`} disabled={pendingPack !== null || action === "loading"} onClick={() => void buyPack(pack)}>{pendingPack === pack.id ? (providerSession ? "Opening checkout…" : "Opening sign-in…") : action === "loading" ? "Checking availability…" : action === "balance_error" ? `Retry for ${pack.label}` : pricingWaitlistCta(pack, pricingVariant)}<KeatingGlyph name="right" size={17} /></button>}
							{billingError?.offerId === pack.id && <p className="pricing-error" role="alert">{billingError.message}</p>}
							</article>; })}
					</div>
					<ul className="pricing-pack-notes"><li><KeatingGlyph name="check" size={15} /> One-time payment, no subscription</li><li><KeatingGlyph name="check" size={15} /> Same teaching tools</li><li>Prices in USD</li></ul>
				</section>

				<section className="pricing-benefits" aria-labelledby="subscriber-benefits-title">
					<div><p className="pricing-eyebrow"><KeatingGlyph name="clock" /> Planned · not available yet</p><h2 id="subscriber-benefits-title">Coming to Personal</h2></div>
					<div>
						<ul>{KEATING_SUBSCRIBER_BENEFITS.map(benefit => <li key={benefit.id} data-glyph-host><KeatingGlyph name={benefit.id === "hosted-sync" ? "lock" : "server"} size={18} />{benefit.label}</li>)}</ul>
						<p>Local learning, your data, and export/import backups stay free. Existing subscriptions keep their current terms. Personal includes metered hosted usage and excludes custom model training and premium voice.</p>
					</div>
				</section>
				<section className="pricing-faq" aria-labelledby="pricing-faq-title"><h2 id="pricing-faq-title">Pricing questions</h2><div>{FAQ_ITEMS.map(item => <details key={item.q}><summary>{item.q}<KeatingGlyph name="chev" size={16} /></summary><p>{item.a}</p></details>)}</div></section>
			</main>
			<Footer />
		</div>
	);
}
