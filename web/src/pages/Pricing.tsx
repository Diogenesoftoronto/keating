import { usePostHog } from "@posthog/react";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { useSeo } from "../hooks/useSeo";
import {
	NotOrganicAccessPromptDialog,
	promptNotOrganicAccess,
} from "../components/NotOrganicAccessPromptDialog";
import {
	NOTORGANIC_PACKS,
	type NotOrganicPack,
} from "../notorganic-provider/packs";
import { cx } from "../../styled-system/css";
import { btnRetro, eyebrow } from "../../styled-system/recipes";

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
	{
		q: "How do credits work?",
		a: "Each pack adds prepaid value to your shared Not Organic wallet. Usage is metered against the provider's published route and rate configuration; one-time Keating packs do not expire.",
	},
	{
		q: "What happens if I buy again?",
		a: "Top-ups stack in the same wallet, so there is no browser key to rotate or reconfigure.",
	},
	{
		q: "How do I use credits on another device?",
		a: "Sign in with the same Not Organic identity. Your wallet is account-scoped and no provider credential is copied between browsers.",
	},
	{
		q: "Do I have to buy credits to use Keating?",
		a: "No. Keating is free with your own API keys (Anthropic, OpenAI, Google, and more). Credits are only for Keating's hosted model when you'd rather not manage keys.",
	},
];

export function Pricing() {
	const posthog = usePostHog();
	useSeo({
		title: "Pricing — Keating",
		description:
			"Prepaid Not Organic inference credits for Keating, with account-scoped wallet access and no browser-held provider key.",
		canonical: "https://keating.help/pricing",
	});

	const buyPack = (pack: NotOrganicPack) => {
		posthog.capture("pricing_pack_selected", { pack_id: pack.id, price_usd: pack.priceUsd });
		void promptNotOrganicAccess({ packId: pack.id });
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
							Keating&apos;s hosted models route through Not Organic&apos;s prepaid shared wallet.
							There is no browser-held virtual key. Bring your own API keys instead and
							Keating stays free.
						</p>

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
										onClick={() => buyPack(pack)}
									>
										Buy_${pack.priceUsd}_pack
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
							{FAQ_ITEMS.map((item) => (
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
			<NotOrganicAccessPromptDialog />
		</div>
	);
}
