import { useEffect, useState, useTransition } from "react";
import { Check, GitCompareArrows, SkipForward, X } from "lucide-react";
import { css, cx } from "../../styled-system/css";
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

type ResponseChoice = "original" | "alternative";

const optionButtonClass = css({
	display: "inline-flex",
	minHeight: "2.5rem",
	alignItems: "center",
	justifyContent: "center",
	gap: "0.375rem",
	borderRadius: "0.375rem",
	paddingInline: "0.875rem",
	fontSize: "0.75rem",
	fontWeight: 600,
	_disabled: { opacity: 0.6 },
});

export function ResponseComparisonPanel({ comparison, onChoose }: ResponseComparisonPanelProps) {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState<ResponseChoice>("original");
	const [isAnswerPending, startAnswerTransition] = useTransition();
	const [decision, setDecision] = useState<ResponseComparisonDecision | null>(null);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open]);

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
		<>
			<section
				aria-label="Alternative response available"
				className={css({
					marginInline: "auto",
					marginBottom: "0.625rem",
					width: "100%",
					maxWidth: "56rem",
				})}
			>
				<button
					type="button"
					onClick={() => setOpen(true)}
					className={css({
						display: "flex",
						width: "100%",
						alignItems: "center",
						gap: "0.625rem",
						borderRadius: "0.5rem",
						border: "1px solid var(--border)",
						backgroundColor: "var(--card)",
						paddingInline: "0.75rem",
						paddingBlock: "0.625rem",
						textAlign: "left",
						transition: "background-color 180ms ease-out, border-color 180ms ease-out",
						_hover: { backgroundColor: "var(--accent)", borderColor: "var(--primary)" },
					})}
				>
					<GitCompareArrows size={16} className={css({ flexShrink: 0, color: "var(--primary)" })} />
					<span className={css({ minWidth: 0, flex: 1 })}>
						<span className={css({ display: "block", fontSize: "0.75rem", fontWeight: 650, color: "var(--foreground)" })}>
							Another explanation is ready
						</span>
						<span className={css({ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", color: "var(--muted-foreground)" })}>
							Compare it when you have a moment
						</span>
					</span>
					<span className={css({ flexShrink: 0, fontSize: "0.75rem", fontWeight: 600, color: "var(--primary)" })}>
						Compare
					</span>
				</button>
			</section>

			{open ? (
				<div
					className={css({
						position: "fixed",
						inset: 0,
						zIndex: 60,
						display: "flex",
						alignItems: "stretch",
						justifyContent: "center",
						backgroundColor: "rgb(0 0 0 / 0.58)",
						sm: { alignItems: "center", padding: "1.5rem" },
					})}
					role="dialog"
					aria-modal="true"
					aria-labelledby="response-comparison-title"
					onClick={() => setOpen(false)}
				>
					<div
						className={css({
							display: "flex",
							height: "100dvh",
							width: "100%",
							flexDirection: "column",
							backgroundColor: "var(--background)",
							color: "var(--foreground)",
							sm: {
								height: "min(88dvh, 52rem)",
								maxWidth: "68rem",
								borderRadius: "0.75rem",
								border: "1px solid var(--border)",
							},
						})}
						onClick={(event) => event.stopPropagation()}
					>
						<header className={css({ display: "flex", alignItems: "flex-start", gap: "0.75rem", borderBottom: "1px solid var(--border)", padding: "1rem" })}>
							<GitCompareArrows size={18} className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--primary)" })} />
							<div className={css({ minWidth: 0, flex: 1 })}>
								<h2 id="response-comparison-title" className={css({ fontSize: "0.9375rem", fontWeight: 700 })}>
									Which explanation helped more?
								</h2>
								<p className={css({ marginTop: "0.125rem", fontSize: "0.75rem", lineHeight: "1.125rem", color: "var(--muted-foreground)" })}>
									Your choice helps Keating learn how to teach you. It does not change the underlying facts.
								</p>
							</div>
							<button type="button" onClick={() => setOpen(false)} aria-label="Close comparison" className={css({ display: "inline-flex", height: "2rem", width: "2rem", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", _hover: { backgroundColor: "var(--accent)" } })}>
								<X size={16} />
							</button>
						</header>

						<div className={css({ display: "flex", borderBottom: "1px solid var(--border)", padding: "0.5rem", md: { display: "none" } })}>
							{(["original", "alternative"] as const).map((choice) => (
								<button
									key={choice}
									type="button"
									onClick={() => startAnswerTransition(() => setActive(choice))}
									aria-busy={isAnswerPending && active !== choice}
									className={css({ flex: 1, borderRadius: "0.375rem", paddingBlock: "0.5rem", fontSize: "0.75rem", fontWeight: 600 })}
									style={{ background: active === choice ? "var(--accent)" : "transparent" }}
								>
									{choice === "original" ? "Original" : "Alternative"}
								</button>
							))}
						</div>

						<div aria-busy={isAnswerPending} className={css({ minHeight: 0, flex: 1, overflowY: "auto", padding: "0.75rem", sm: { padding: "1rem" }, md: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem" } })} style={{ opacity: isAnswerPending ? 0.72 : 1, transition: "opacity 120ms ease-out" }}>
							<ResponseOption label="Original response" content={comparison.originalResponse} choice="original" active={active} decision={decision} onChoose={choose} />
							<ResponseOption label="Alternative response" content={comparison.alternativeResponse} choice="alternative" active={active} decision={decision} onChoose={choose} />
						</div>

						<footer className={css({ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", borderTop: "1px solid var(--border)", padding: "0.75rem 1rem" })}>
							<button type="button" disabled={Boolean(decision)} onClick={() => void choose("skipped")} className={css({ display: "inline-flex", minHeight: "2.25rem", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "var(--muted-foreground)", _hover: { color: "var(--foreground)" }, _disabled: { opacity: 0.6 } })}>
								{decision === "skipped" ? <Spinner size={13} /> : <SkipForward size={13} />}
								Skip
							</button>
							<span className={css({ fontSize: "11px", color: "var(--muted-foreground)" })}>Comparisons appear in about 1% of replies</span>
						</footer>
					</div>
				</div>
			) : null}
		</>
	);
}

function ResponseOption({
	label,
	content,
	choice,
	active,
	decision,
	onChoose,
}: {
	label: string;
	content: string;
	choice: ResponseChoice;
	active: ResponseChoice;
	decision: ResponseComparisonDecision | null;
	onChoose: (choice: ResponseChoice) => Promise<void>;
}) {
	return (
		<article
			className={css({
				display: active === choice ? "flex" : "none",
				minHeight: 0,
				flexDirection: "column",
				gap: "0.75rem",
				md: { display: "flex" },
			})}
		>
			<h3 className={css({ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted-foreground)" })}>{label}</h3>
			<div className={css({ minHeight: 0, flex: 1, overflowWrap: "anywhere", borderRadius: "0.5rem", backgroundColor: "color-mix(in srgb, var(--muted) 42%, transparent)", padding: "0.875rem", fontSize: "0.875rem", lineHeight: "1.5rem" })}>
				<MarkdownBlock content={content} />
			</div>
			<button
				type="button"
				disabled={Boolean(decision)}
				onClick={() => void onChoose(choice)}
				className={cx(
					optionButtonClass,
					choice === "alternative"
						? css({ backgroundColor: "var(--primary)", color: "var(--primary-foreground)", _hover: { backgroundColor: "color-mix(in srgb, var(--primary) 88%, black)" } })
						: css({ border: "1px solid var(--border)", _hover: { backgroundColor: "var(--accent)" } }),
				)}
			>
				{decision === choice ? <Spinner size={14} /> : <Check size={14} />}
				Choose {choice}
			</button>
		</article>
	);
}
