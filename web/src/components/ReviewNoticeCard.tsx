import type { ReactNode } from "react";
import { ShieldAlert, ShieldQuestion } from "lucide-react";
import { css } from "../../styled-system/css";
import type { ReviewNoticeKind } from "../keating/judgement/review-notice";

const cardClass = css({
	display: "grid",
	gap: "0.5rem",
	borderRadius: "0.5rem",
	borderWidth: "1px",
	borderStyle: "solid",
	paddingInline: "0.875rem",
	paddingBlock: "0.75rem",
});
const headerClass = css({ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, fontSize: "0.8125rem" });
const UNVERIFIED_TIP =
	"Not fully verified: none of Keating's drafts passed every review check. Double-check facts and steps that matter.";
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
});

/**
 * A tutor turn that did not pass the full draft review. `unverified` wraps the
 * best available reply; `withheld` explains why no reply could be produced.
 */
export function ReviewNoticeCard({ kind, children }: { kind: ReviewNoticeKind; children: ReactNode }) {
	if (kind === "unverified") {
		// Subtle on purpose: the reply renders as it normally would (a box around it
		// broke OpenUI layout) and the caveat lives in a tooltip.
		return (
			<div>
				{children}
				<span
					role="note"
					aria-label={UNVERIFIED_TIP}
					tabIndex={0}
					className={unverifiedBadgeClass}
				>
					<ShieldQuestion size={13} aria-hidden />
					<span data-tip aria-hidden className={tipClass}>{UNVERIFIED_TIP}</span>
				</span>
			</div>
		);
	}
	return (
		<div
			role="alert"
			aria-label="Reply withheld"
			className={cardClass}
			style={{ borderColor: "color-mix(in srgb, var(--destructive, #dc2626) 45%, transparent)" }}
		>
			<div className={headerClass}>
				<ShieldAlert size={14} aria-hidden />
				<span>Keating couldn't produce a reply</span>
			</div>
			<div className={css({ display: "grid", gap: "0.375rem", fontSize: "0.8125rem" })}>{children}</div>
		</div>
	);
}
