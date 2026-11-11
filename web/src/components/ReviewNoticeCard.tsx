import type { ReactNode } from "react";
import { ShieldAlert, ShieldQuestion } from "lucide-react";
import { css } from "../../styled-system/css";
import type { ReviewNoticeKind } from "../keating/judgement/review-notice";

const UNVERIFIED_TIP =
	"Not fully verified: none of Keating's drafts passed every review check. Double-check facts and steps that matter.";
const WITHHELD_FALLBACK = "Keating couldn't produce a reply this time. Try again.";
const withheldBadgeClass = css({
	position: "relative",
	display: "inline-flex",
	alignItems: "center",
	gap: "0.375rem",
	fontSize: "0.8125rem",
	color: "color-mix(in srgb, var(--destructive, #dc2626) 80%, var(--muted-foreground))",
	cursor: "help",
	"&:hover > [data-tip], &:focus-visible > [data-tip]": { display: "block" },
	_focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px", borderRadius: "0.25rem" },
});
const unverifiedBadgeClass = css({
	position: "relative",
	display: "inline-flex",
	marginTop: "0.25rem",
	color: "var(--muted-foreground)",
	opacity: 0.7,
	cursor: "help",
	_hover: { opacity: 1 },
	_focusVisible: { opacity: 1 },
	"&:hover > [data-tip], &:focus-visible > [data-tip]": { display: "block" },
});
const tipClass = css({
	display: "none",
	position: "absolute",
	bottom: "calc(100% + 0.25rem)",
	left: 0,
	zIndex: 20,
	width: "max-content",
	maxWidth: "16rem",
	borderRadius: "0.375rem",
	borderWidth: "1px",
	borderStyle: "solid",
	borderColor: "var(--border)",
	bg: "var(--popover)",
	color: "var(--popover-foreground)",
	paddingInline: "0.5rem",
	paddingBlock: "0.375rem",
	fontSize: "0.75rem",
	lineHeight: "1rem",
	pointerEvents: "none",
	// The withheld label is often near the top of a short chat, so its tip opens below.
	"&[data-below]": { top: "calc(100% + 0.25rem)", bottom: "auto" },
});

/** The quiet unverified marker, with its explanation in a hover/focus tooltip. */
export function UnverifiedBadge({ tip = UNVERIFIED_TIP }: { tip?: string }) {
	return (
		<span role="note" aria-label={tip} tabIndex={0} className={unverifiedBadgeClass}>
			<ShieldQuestion size={13} aria-hidden />
			<span data-tip aria-hidden className={tipClass}>{tip}</span>
		</span>
	);
}

/** Tooltip for a reply whose factual claims could not all be sourced after release. */
export function unsourcedClaimTip(claims: readonly string[]): string {
	const first = claims[0]?.trim().replace(/[.!?;:,]+$/, "");
	if (!first) return UNVERIFIED_TIP;
	const quoted = first.length > 160 ? `${first.slice(0, 157).trimEnd()}…` : first;
	return `Not verified: Keating couldn't find a source for “${quoted}”${claims.length > 1 ? ` and ${claims.length - 1} other claim${claims.length > 2 ? "s" : ""}` : ""}. Double-check it before relying on it.`;
}

/**
 * A tutor turn that did not pass the full draft review. Both kinds stay quiet:
 * `unverified` shows the best available reply with a small icon, `withheld`
 * shows a one-line label. The explanation lives in a hover/focus tooltip.
 */
export function ReviewNoticeCard({ kind, children, reason }: { kind: ReviewNoticeKind; children?: ReactNode; reason?: string }) {
	if (kind === "unverified") {
		// Subtle on purpose: the reply renders as it normally would (a box around it
		// broke OpenUI layout) and the caveat lives in a tooltip.
		return (
			<div>
				{children}
				<UnverifiedBadge />
			</div>
		);
	}
	const tip = reason?.trim() || WITHHELD_FALLBACK;
	return (
		<span role="alert" aria-label={`Couldn't produce a reply. ${tip}`} tabIndex={0} className={withheldBadgeClass}>
			<ShieldAlert size={14} aria-hidden />
			<span aria-hidden>Couldn't produce a reply</span>
			<span data-tip data-below aria-hidden className={tipClass}>{tip}</span>
		</span>
	);
}
