import { CheckCircle2 } from "lucide-react";
import { css } from "../../styled-system/css";
import {
	resolvedLearnerResponseReview,
	type LearnerResponseEnvelope,
} from "../keating/learner-response";

export function LearnerResponseReview({ response }: { response: LearnerResponseEnvelope }) {
	const review = resolvedLearnerResponseReview(response);
	const answeredQuestions = response.kind === "question"
		|| (response.kind === "openui-action"
			&& response.payload.kind === "canonical"
			&& response.payload.action.type === "submit-question-group");
	return (
		<section
			aria-label={review.title}
			className={css({
				width: "100%",
				maxWidth: "42rem",
				borderRadius: "0.75rem",
				border: "1px solid color-mix(in srgb, var(--primary) 24%, var(--border))",
				background: "color-mix(in srgb, var(--primary) 5%, var(--background))",
				padding: "0.875rem",
				color: "var(--foreground)",
			})}
		>
			<header className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem" })}>
				<CheckCircle2 aria-hidden="true" size={17} className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--primary)" })} />
				<div className={css({ minWidth: 0 })}>
					<h3 className={css({ fontSize: "0.875rem", fontWeight: 700 })}>{review.title}</h3>
					{review.summary ? (
						<p className={css({ marginTop: "0.125rem", fontSize: "0.75rem", lineHeight: "1.125rem", color: "var(--muted-foreground)" })}>
							{review.summary}
						</p>
					) : null}
				</div>
			</header>
			{review.items.length > 0 && answeredQuestions ? (
				<ol className={css({ marginTop: "0.75rem", display: "grid", gap: "0.625rem" })}>
					{review.items.map((item, index) => (
						<li key={`${item.label}-${index}`} className={css({ minWidth: 0, borderTop: index === 0 ? "none" : "1px solid var(--border)", paddingTop: index === 0 ? 0 : "0.625rem" })}>
							<div className={css({ fontSize: "0.75rem", fontWeight: 700, lineHeight: "1.2rem", color: "var(--foreground)" })}>{item.label}</div>
							<div className={css({ marginTop: "0.375rem", borderLeft: "2px solid var(--primary)", borderRadius: "0.25rem", background: "color-mix(in srgb, var(--background) 82%, transparent)", padding: "0.5rem 0.625rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.875rem", lineHeight: "1.375rem" })}>{item.value}</div>
						</li>
					))}
				</ol>
			) : review.items.length > 0 ? (
				<dl className={css({ marginTop: "0.625rem", display: "grid", gap: "0.5rem" })}>
					{review.items.map((item, index) => (
						<div key={`${item.label}-${index}`} className={css({ minWidth: 0 })}>
							<dt className={css({ fontSize: "0.6875rem", fontWeight: 600, color: "var(--muted-foreground)" })}>{item.label}</dt>
							<dd className={css({ marginTop: "0.125rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.875rem", lineHeight: "1.375rem" })}>{item.value}</dd>
						</div>
					))}
				</dl>
			) : null}
		</section>
	);
}
