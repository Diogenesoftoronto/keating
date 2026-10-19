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
const noteClass = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });

/**
 * A tutor turn that did not pass the full draft review. `unverified` wraps the
 * best available reply; `withheld` explains why no reply could be produced.
 */
export function ReviewNoticeCard({ kind, children }: { kind: ReviewNoticeKind; children: ReactNode }) {
	if (kind === "unverified") {
		return (
			<div
				role="note"
				aria-label="Unverified reply"
				className={cardClass}
				style={{ borderColor: "color-mix(in srgb, var(--warning, #d97706) 45%, transparent)" }}
			>
				<div className={headerClass}>
					<ShieldQuestion size={14} aria-hidden />
					<span>Not fully verified</span>
				</div>
				<p className={noteClass}>
					None of the drafts passed every review check, so Keating is showing the best one it wrote. Double-check
					facts and steps that matter.
				</p>
				<div>{children}</div>
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
