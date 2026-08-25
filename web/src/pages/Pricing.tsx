import { useEffect, useState } from "react";
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
import { cx } from "../../styled-system/css";
import { btnRetro, eyebrow } from "../../styled-system/recipes";

const WAITLIST_FAQ_ITEMS: Array<{ q: string; a: string }> = [
	{
		q: "Can I buy credits today?",
		a: "Not on this deployment. The packs below are not purchasable until its provider client is configured. Pick a pack to check whether the waitlist signup form is available.",
	},
	{
		q: "Do I need credits to use Keating?",
		a: "No. Keating is free with your own API keys (Anthropic, OpenAI, Google, and more). Credits are only for Keating's hosted model when you'd rather not manage keys.",
	},
	{
		q: "How will credits work when they launch?",
		a: "Each pack will add prepaid value to a shared Not Organic wallet. Usage is metered against the provider's published route and rate configuration, and one-time Keating packs will not expire.",
	},
	{
		q: "How will credits work across devices?",
		a: "The wallet is account-scoped rather than browser-scoped. Each browser connects separately with its own device-bound key; no long-lived provider credential is copied between devices.",
	},
];

const CHECKOUT_FAQ_ITEMS: Array<{ q: string; a: string }> = [
	{
		q: "Can I buy credits today?",
		a: "Yes. Connect your Not Organic account, choose a pack, and complete the provider-hosted checkout.",
	},
	...WAITLIST_FAQ_ITEMS.slice(1),
];

export const PRICING_WAITLIST_EXPERIMENT_KEY = "pricing-waitlist-cta-copy";

export function pricingWaitlistCta(
	pack: NotOrganicPack,
	variant: PricingWaitlistVariant,
): string {
	return variant === "test"
		? "Notify_me_at_launch"
		: `Join_$${pack.priceUsd}_waitlist`;
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
): boolean {
	const fieldsPresent = [
		env.VITE_NOTORGANIC_PUBLIC_ISSUER,
		env.VITE_NOTORGANIC_AUTHORIZATION_URL,
		env.VITE_NOTORGANIC_CLIENT_ID,
		env.VITE_NOTORGANIC_REDIRECT_URI,
		env.VITE_NOTORGANIC_SCOPE,
	].every((value) => Boolean(value?.trim()));
	const scopes = new Set(env.VITE_NOTORGANIC_SCOPE?.trim().split(/\s+/) ?? []);
	return env.VITE_NOTORGANIC_ENABLED === "true"
		&& fieldsPresent
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
	const clientConfig = checkoutConfigured ? publicClientConfig() : null;
	const publicClient = clientConfig ? new NotOrganicPublicClient(clientConfig) : null;
	const [providerSession] = useState(() => {
		return publicClient?.getSession() ?? null;
	});
	const [billingError, setBillingError] = useState<string | null>(null);
	const [walletSummary, setWalletSummary] = useState<string | null>(null);
	const [walletLoading, setWalletLoading] = useState(false);
	const availability = pricingAvailability(checkoutConfigured, Boolean(providerSession));
	const faqItems = checkoutConfigured ? CHECKOUT_FAQ_ITEMS : WAITLIST_FAQ_ITEMS;
	useSeo({
		title: "Pricing — Keating",
		description: checkoutConfigured
			? "Buy prepaid Not Organic inference credits for Keating through provider-hosted checkout."
			: "Keating is free with your own API keys. Hosted inference credits are coming soon — join the waitlist.",
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
			const wallet = await response.json().catch(() => null) as { balance_microusd?: unknown } | null;
			if (!response.ok || typeof wallet?.balance_microusd !== "number") {
				throw new Error("Not Organic could not read the wallet balance.");
			}
			setWalletSummary(`$${(wallet.balance_microusd / 1_000_000).toFixed(2)} available`);
			setBillingError(null);
		} catch (cause) {
			setBillingError(cause instanceof Error ? cause.message : "Not Organic wallet refresh failed.");
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

	const connectProvider = async () => {
		if (!publicClient) return;
		try {
			setBillingError(null);
			window.location.assign(await publicClient.authorizationUrl("/pricing"));
		} catch (cause) {
			setBillingError(cause instanceof Error ? cause.message : "Not Organic connection could not be started.");
		}
	};

	const buyPack = async (pack: NotOrganicPack) => {
		// Keep the established event name stable: selecting a pack is purchase
		// intent, not a completed checkout. The availability property makes that
		// distinction explicit without breaking historical funnels.
		posthog?.capture("pricing_pack_selected", {
			pack_id: pack.id,
			price_usd: pack.priceUsd,
			availability,
			pricing_cta_variant: pricingVariant,
		});
		if (!publicClient) {
			promptCreditWaitlist(pack.id, pricingVariant);
			return;
		}
		if (!providerSession) {
			await connectProvider();
			return;
		}
		try {
			setBillingError(null);
			const response = await publicClient.request("/v1/billing/checkout", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ pack_id: pack.id, return_url: `${window.location.origin}/pricing?checkout=returned` }),
			});
			const result = await response.json().catch(() => null) as { url?: unknown; checkout_url?: unknown } | null;
			const checkoutUrl = typeof result?.url === "string" ? result.url : typeof result?.checkout_url === "string" ? result.checkout_url : null;
			if (!response.ok || !checkoutUrl) throw new Error("Not Organic could not create checkout.");
			window.location.assign(checkoutUrl);
		} catch (cause) {
			setBillingError(cause instanceof Error ? cause.message : "Not Organic checkout could not be started.");
		}
	};

	return (
		<div className={cx("retro-layout", "retro-page")}>
			<Nav />
			<main className={cx("download-page")}>
				<section className={cx("download-hero")}>
					<div className={cx("wrap")}>
						<div className={cx(eyebrow(), "prompt")}>cat PRICING.txt</div>
						<h1>Pay for tokens. Nothing else.</h1>
						<p className={cx("download-hero-copy")}>
							Keating is free when you bring your own API keys. Hosted inference credits
							route through Not Organic&apos;s prepaid wallet without a long-lived provider
							secret in Keating. {checkoutConfigured
								? "Connect your provider account to use hosted credits."
								: "Hosted checkout is not enabled on this Keating deployment yet."}
						</p>
						{publicClient && !providerSession && (
							<button type="button" className={btnRetro()} onClick={() => void connectProvider()}>
								Connect_Not_Organic
							</button>
						)}
						{providerSession && (
							<div>
								<p>Connected to Not Organic. {walletSummary ?? "Wallet balance is loading."}</p>
					{checkoutReturned && (
									<p>Returned from checkout. Creem updates the wallet after its signed webhook arrives.</p>
								)}
								<button type="button" className={btnRetro()} disabled={walletLoading} onClick={() => void refreshWallet()}>
									{walletLoading ? "Refreshing_wallet…" : "Refresh_wallet"}
								</button>
							</div>
						)}
						{billingError && <p role="alert">{billingError}</p>}

						<div className={cx("download-source-box")} style={{ marginTop: "1.5rem" }}>
							<div>
								<h3>Hosted routing — Not Organic</h3>
								<p>
									Keating uses the provider&apos;s balanced model alias. Wallet and usage
									records remain visible through your account session.
								</p>
							</div>
							<div className={cx("download-command")} aria-label="Hosted provider">
								<div>provider&nbsp;&nbsp;Not Organic</div>
								<div>model&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;balanced</div>
								<div>
									status&nbsp;&nbsp;&nbsp;&nbsp;{availability}
								</div>
							</div>
						</div>
					</div>
				</section>

				<section aria-label="Credit packs">
					<div className={cx("wrap")}>
						<div className={cx(eyebrow(), "prompt")}>ls PACKS/</div>
						<div className={cx("desktop-download-grid")}>
							{NOTORGANIC_PACKS.map((pack) => (
								<article
									key={pack.id}
									className={cx("desktop-download-card", pack.popular && "is-recommended")}
								>
									<div className={cx("desktop-card-head")}>
										<div className={cx("desktop-platform")}>{pack.label.toUpperCase()}</div>
										{pack.popular && <span className={cx("desktop-recommend-tag")}>POPULAR</span>}
									</div>
									<p>{pack.blurb}</p>
									<code>
										${pack.priceUsd} in prepaid inference value
									</code>
									<button
										type="button"
										className={btnRetro()}
										style={{ padding: "0.5rem 1rem", fontWeight: 700 }}
										onClick={() => void buyPack(pack)}
									>
									{availability === "waitlist"
										? pricingWaitlistCta(pack, pricingVariant)
										: availability === "checkout_connect_required"
											? `Connect_to_buy_$${pack.priceUsd}`
											: `Buy_$${pack.priceUsd}_pack`}
									</button>
								</article>
							))}
						</div>
					</div>
				</section>

				<section aria-label="Pricing FAQ">
					<div className={cx("wrap")}>
						<div className={cx(eyebrow(), "prompt")}>man CREDITS</div>
						<div className={cx("desktop-download-grid")}>
							{faqItems.map((item) => (
								<article className={cx("desktop-download-card")} key={item.q}>
									<div className={cx("desktop-platform")}>{item.q}</div>
									<p>{item.a}</p>
								</article>
							))}
						</div>
					</div>
				</section>
			</main>
			<Footer />
			<CreditWaitlistDialog />
		</div>
	);
}
