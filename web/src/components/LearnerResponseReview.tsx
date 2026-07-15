import { CheckCircle2 } from "lucide-react";
import { css } from "../../styled-system/css";
import type { LearnerResponseEnvelope } from "../keating/learner-response";

export function LearnerResponseReview({ response }: { response: LearnerResponseEnvelope }) {
	return (
		<section
			aria-label={response.review.title}
			className={css({
				width: "100%",
				maxWidth: "42rem",
				borderRadius: "0.75rem",
				background: "color-mix(in srgb, var(--primary) 7%, var(--background))",
				padding: "0.75rem",
				color: "var(--foreground)",
			})}
		>
			<header className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem" })}>
				<CheckCircle2 aria-hidden="true" size={17} className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--primary)" })} />
				<div className={css({ minWidth: 0 })}>
					<h3 className={css({ fontSize: "0.875rem", fontWeight: 650 })}>{response.review.title}</h3>
					{response.review.summary ? (
						<p className={css({ marginTop: "0.125rem", fontSize: "0.75rem", lineHeight: "1.125rem", color: "var(--muted-foreground)" })}>
							{response.review.summary}
						</p>
					) : null}
				</div>
			</header>
			{response.review.items.length > 0 ? (
				<dl className={css({ marginTop: "0.625rem", display: "grid", gap: "0.5rem" })}>
					{response.review.items.map((item, index) => (
						<div key={`${item.label}-${index}`} className={css({ minWidth: 0 })}>
							<dt className={css({ fontSize: "0.6875rem", fontWeight: 600, color: "var(--muted-foreground)" })}>
								{item.label}
							</dt>
							<dd className={css({ marginTop: "0.125rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.875rem", lineHeight: "1.375rem" })}>
								{item.value}
							</dd>
						</div>
					))}
				</dl>
			) : null}
		</section>
	);
}
