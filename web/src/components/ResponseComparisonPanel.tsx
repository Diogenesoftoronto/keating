import { useState } from "react";
import { Check, GitCompareArrows, SkipForward } from "lucide-react";
import { css } from "../../styled-system/css";
import type {
	PendingResponseComparison,
	ResponseComparisonDecision,
} from "../keating/response-comparison";
import { MarkdownBlock } from "./MarkdownBlock";
import { Spinner } from "./Spinner";

interface ResponseComparisonPanelProps {
	comparison: PendingResponseComparison;
	onChoose: (decision: ResponseComparisonDecision) => Promise<void>;
}

export function ResponseComparisonPanel({ comparison, onChoose }: ResponseComparisonPanelProps) {
	const [decision, setDecision] = useState<ResponseComparisonDecision | null>(null);

	const choose = async (next: ResponseComparisonDecision) => {
		if (decision) return;
		setDecision(next);
		try {
			await onChoose(next);
		} finally {
			setDecision(null);
		}
	};

	return (
		<section
			aria-label="Compare responses"
			className={css({
				marginInline: "auto",
				marginBottom: "0.625rem",
				width: "100%",
				maxWidth: "56rem",
				borderRadius: "0.625rem",
				border: "1px solid var(--border)",
				backgroundColor: "var(--background)",
				padding: "0.625rem",
				sm: { padding: "0.875rem" },
			})}
		>
			<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.625rem" })}>
				<GitCompareArrows size={17} className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--primary)" })} />
				<div className={css({ minWidth: 0, flex: 1 })}>
					<h3 className={css({ fontSize: "0.8125rem", fontWeight: 650, color: "var(--foreground)" })}>
						Alternative response ready
					</h3>
					<p className={css({ marginTop: "0.125rem", fontSize: "0.6875rem", lineHeight: "1rem", color: "var(--muted-foreground)" })}>
						The current answer is above. Review this alternative, then choose which one helped more. Your choice creates one preference example.
					</p>
				</div>
			</div>

			<div
				className={css({
					marginTop: "0.625rem",
					maxHeight: "min(30dvh, 14rem)",
					overflowY: "auto",
					overflowX: "hidden",
					borderRadius: "0.375rem",
					backgroundColor: "color-mix(in srgb, var(--muted) 42%, transparent)",
					padding: "0.625rem",
					fontSize: "0.8125rem",
					lineHeight: "1.35rem",
					sm: { padding: "0.75rem", fontSize: "0.875rem", lineHeight: "1.5rem" },
				})}
			>
				<MarkdownBlock content={comparison.alternativeResponse} />
			</div>

			<div className={css({ marginTop: "0.625rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
				<button
					type="button"
					disabled={Boolean(decision)}
					onClick={() => void choose("original")}
					className={css({
						display: "inline-flex",
						minHeight: "2.25rem",
						flex: "1 1 9rem",
						alignItems: "center",
						justifyContent: "center",
						gap: "0.375rem",
						borderRadius: "0.375rem",
						border: "1px solid var(--border)",
						paddingInline: "0.75rem",
						fontSize: "0.75rem",
						fontWeight: 600,
						_hover: { backgroundColor: "var(--accent)" },
						_disabled: { opacity: 0.6 },
					})}
				>
					{decision === "original" ? <Spinner size={14} /> : <Check size={14} />}
					Keep current response
				</button>
				<button
					type="button"
					disabled={Boolean(decision)}
					onClick={() => void choose("alternative")}
					className={css({
						display: "inline-flex",
						minHeight: "2.25rem",
						flex: "1 1 9rem",
						alignItems: "center",
						justifyContent: "center",
						gap: "0.375rem",
						borderRadius: "0.375rem",
						backgroundColor: "var(--primary)",
						paddingInline: "0.75rem",
						fontSize: "0.75rem",
						fontWeight: 600,
						color: "var(--primary-foreground)",
						_hover: { backgroundColor: "color-mix(in srgb, var(--primary) 88%, black)" },
						_disabled: { opacity: 0.6 },
					})}
				>
					{decision === "alternative" ? <Spinner size={14} /> : <GitCompareArrows size={14} />}
					Use alternative response
				</button>
				<button
					type="button"
					disabled={Boolean(decision)}
					onClick={() => void choose("skipped")}
					className={css({
						display: "inline-flex",
						minHeight: "2.25rem",
						alignItems: "center",
						justifyContent: "center",
						gap: "0.375rem",
						paddingInline: "0.5rem",
						fontSize: "0.6875rem",
						color: "var(--muted-foreground)",
						_hover: { color: "var(--foreground)" },
						_disabled: { opacity: 0.6 },
					})}
				>
					{decision === "skipped" ? <Spinner size={13} /> : <SkipForward size={13} />}
					Skip comparison
				</button>
			</div>
		</section>
	);
}
