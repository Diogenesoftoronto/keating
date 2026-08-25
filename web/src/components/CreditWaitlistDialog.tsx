import { useEffect, useState } from "react";
import { Clock, X } from "lucide-react";
import { usePostHog } from "@posthog/react";
import { css, cx } from "../../styled-system/css";
import { iconButton, primaryButton } from "../../styled-system/recipes";
import {
	DEFAULT_NOTORGANIC_PACK_ID,
	getNotOrganicPack,
	type NotOrganicPack,
	type NotOrganicPackId,
} from "../notorganic-provider/packs";

const CHANGE_EVENT = "keating:credit-waitlist-changed";
export const CREDIT_WAITLIST_SURVEY_NAME = "Keating hosted credits waitlist";

export type PricingWaitlistVariant = "control" | "test";
export type CreditWaitlistPanelState = "prompt" | "loading" | "survey_unavailable";

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

/**
 * Hosted credit checkout is not purchasable yet: the deployment has no durable
 * product-session adapter, so the provider rejects every checkout attempt. Until
 * that exists, purchase intent is routed to a waitlist instead of a dead button.
 */
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

export function CreditWaitlistPanel({
	pack,
	state,
	onJoin,
	onDismiss,
}: {
	pack: NotOrganicPack;
	state: CreditWaitlistPanelState;
	onJoin(): void;
	onDismiss(): void;
}) {
	const surveyUnavailable = state === "survey_unavailable";

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="credit-waitlist-title"
			className={css({ width: "100%", maxWidth: "28rem", borderRadius: "0.5rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", boxShadow: "var(--shadow-xl)" })}
		>
			<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderBottom: "1px solid var(--border)", paddingInline: "1rem", paddingBlock: "0.75rem" })}>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
					<Clock size={16} className={css({ color: "var(--primary)" })} />
					<h2 id="credit-waitlist-title" className={css({ fontSize: "0.875rem", fontWeight: 600 })}>
						{surveyUnavailable ? "Waitlist form unavailable" : "Not available yet"}
					</h2>
				</div>
				<button
					type="button"
					className={cx(iconButton({ size: "md", tone: "ghost" }), css({ _hover: { color: "var(--foreground)" } }))}
					onClick={onDismiss}
					aria-label="Close"
				>
					<X size={16} />
				</button>
			</div>

			<div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "1rem" })}>
				{surveyUnavailable ? (
					<>
						<p className={css({ fontSize: "0.875rem", fontWeight: 600 })}>
							Your interest was recorded, but your email was not.
						</p>
						<p className={css({ fontSize: "0.8125rem", color: "var(--muted-foreground)" })}>
							The notification form could not be loaded, so you are not yet on the
							email waitlist. Try again later. Keating remains free with your own API
							keys.
						</p>
					</>
				) : (
					<>
						<p className={css({ fontSize: "0.875rem" })}>
							The <strong>{pack.label}</strong> pack (${pack.priceUsd}) can&apos;t be
							bought yet — hosted credit checkout isn&apos;t live.
						</p>
						<p className={css({ fontSize: "0.8125rem", color: "var(--muted-foreground)" })}>
							Open the short waitlist form and leave an email address if you want a
							launch notification. Keating is free today with your own API keys.
						</p>
					</>
				)}

				<div className={css({ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.25rem" })}>
					<button
						type="button"
						className={cx("dialog-compact-button", css({ display: "inline-flex", height: "2.25rem", alignItems: "center", borderRadius: "0.375rem", backgroundColor: "var(--secondary)", paddingInline: "0.75rem", fontSize: "0.875rem", fontWeight: 500 }))}
						onClick={onDismiss}
					>
						{surveyUnavailable ? "Close" : "Not now"}
					</button>
					<button
						type="button"
						className={cx("dialog-compact-button", primaryButton(), css({ paddingInline: "0.75rem" }))}
						onClick={onJoin}
						disabled={state === "loading"}
					>
						{state === "loading"
							? "Opening form…"
							: surveyUnavailable
								? "Try again"
								: "Open waitlist form"}
					</button>
				</div>
			</div>
		</div>
	);
}

export function CreditWaitlistDialog() {
	const posthog = usePostHog();
	const [request, setRequest] = useState(activeRequest);
	const [state, setState] = useState<CreditWaitlistPanelState>("prompt");

	useEffect(() => {
		const sync = () => {
			setRequest(activeRequest);
			setState("prompt");
		};
		window.addEventListener(CHANGE_EVENT, sync);
		return () => window.removeEventListener(CHANGE_EVENT, sync);
	}, []);

	const pack = request ? getNotOrganicPack(request.packId) : undefined;
	const requestId = request?.id;

	useEffect(() => {
		if (!requestId || !pack) return;
		posthog?.capture("credit_waitlist_prompt_shown", {
			pack_id: pack.id,
			price_usd: pack.priceUsd,
			pricing_cta_variant: request.pricingVariant,
		});
	}, [requestId]);

	if (!request || !pack) return null;

	const dismiss = () => {
		posthog?.capture("credit_waitlist_dismissed", {
			pack_id: pack.id,
			price_usd: pack.priceUsd,
			pricing_cta_variant: request.pricingVariant,
			survey_state: state,
		});
		closeCreditWaitlist();
	};

	const join = () => {
		setState("loading");
		posthog?.capture("credit_waitlist_joined", {
			pack_id: pack.id,
			price_usd: pack.priceUsd,
			pricing_cta_variant: request.pricingVariant,
		});

		if (!posthog) {
			setState("survey_unavailable");
			return;
		}

		let settled = false;
		const unavailable = () => {
			if (settled) return;
			settled = true;
			setState("survey_unavailable");
			posthog.capture("credit_waitlist_survey_unavailable", {
				pack_id: pack.id,
				price_usd: pack.priceUsd,
				pricing_cta_variant: request.pricingVariant,
			});
		};
		const timeout = window.setTimeout(unavailable, 4_000);

		posthog.getSurveys((surveys) => {
			if (settled) return;
			const survey = surveys.find((candidate) => candidate.name === CREDIT_WAITLIST_SURVEY_NAME);
			if (!survey) {
				window.clearTimeout(timeout);
				unavailable();
				return;
			}

			settled = true;
			window.clearTimeout(timeout);
			closeCreditWaitlist();
			window.setTimeout(() => {
				posthog.displaySurvey(survey.id, {
					displayType: "popover",
					ignoreConditions: true,
					ignoreDelay: true,
					properties: {
						pack_id: pack.id,
						price_usd: pack.priceUsd,
						pricing_cta_variant: request.pricingVariant,
					},
				});
			}, 0);
		}, true);
	};

	return (
		<div
			className={css({ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "color-mix(in srgb, var(--background) 70%, transparent)", padding: "1rem", backdropFilter: "blur(4px)" })}
		>
			<CreditWaitlistPanel
				pack={pack}
				state={state}
				onJoin={join}
				onDismiss={dismiss}
			/>
		</div>
	);
}
