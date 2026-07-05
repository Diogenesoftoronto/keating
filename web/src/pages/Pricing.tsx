import { usePostHog } from "@posthog/react";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { useSeo } from "../hooks/useSeo";
import { DioAccessPromptDialog, promptDioAccess } from "../components/DioAccessPromptDialog";
import { DIO_PACKS, DIO_TOKEN_RATES, formatPackTokenVolume, type DioPack } from "../dio-provider/packs";
import { cx } from "../../styled-system/css";
import { btnRetro, eyebrow } from "../../styled-system/recipes";

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
	{
		q: "How do credits work?",
		a: "Each pack loads a dollar budget onto your personal API key. Usage draws it down at the advertised per-token rates — no subscription, and credits never expire.",
	},
	{
		q: "What happens if I buy again?",
		a: "Top-ups stack. A second purchase raises the budget on your existing key instead of creating a new one, so nothing to reconfigure.",
	},
	{
		q: "I lost my key. Can I get it back?",
		a: "Yes — recover access with the email you purchased with. We'll send a verification code and restore the same key.",
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
			"Transparent pay-per-token pricing for Keating's hosted inference. Buy credit packs; pay $1 per million input tokens and $4 per million output tokens.",
		canonical: "https://keating.help/pricing",
	});

	const buyPack = (pack: DioPack) => {
		posthog.capture("pricing_pack_selected", { pack_id: pack.id, price_usd: pack.priceUsd });
		void promptDioAccess({ packId: pack.id });
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
							Keating's hosted model (Kimi K2.6) runs on prepaid credits with transparent
							per-token rates. No subscription, no expiry, no minimum. Bring your own API
							keys instead and Keating stays free.
						</p>

						<div className={cx("download-source-box")} style={{ marginTop: "1.5rem" }}>
							<div>
								<h3>Token rates — Kimi K2.6</h3>
								<p>
									Credits draw down at exactly these rates. What you see in the usage
									dashboard is what you pay.
								</p>
							</div>
							<div className={cx("download-command")} aria-label="Token rates">
								<div>input&nbsp;&nbsp;${DIO_TOKEN_RATES.inputPerMTok.toFixed(2)} / 1M tokens</div>
								<div>output&nbsp;${DIO_TOKEN_RATES.outputPerMTok.toFixed(2)} / 1M tokens</div>
							</div>
						</div>
					</div>
				</section>

				<section aria-label="Credit packs">
					<div className={cx("wrap")}>
						<div className={cx(eyebrow(), "prompt")}>ls PACKS/</div>
						<div className={cx("desktop-download-grid")}>
							{DIO_PACKS.map((pack) => (
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
										${pack.priceUsd} — {formatPackTokenVolume(pack)}
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
			<DioAccessPromptDialog />
		</div>
	);
}
