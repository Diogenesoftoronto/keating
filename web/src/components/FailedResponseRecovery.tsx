import { CircleAlert } from "lucide-react";
import { css } from "../../styled-system/css";
import { RetryResponseButton } from "./RetryResponseButton";

interface FailedResponseRecoveryProps {
	recovery?: string;
	onRetry: () => void | Promise<void>;
}

export function FailedResponseRecovery({ recovery, onRetry }: FailedResponseRecoveryProps) {
	return (
		<div
			role="alert"
			className={css({
				marginTop: "0.625rem",
				display: "flex",
				flexWrap: "wrap",
				alignItems: "flex-start",
				gap: "0.75rem",
				borderRadius: "0.625rem",
				backgroundColor: "color-mix(in srgb, var(--destructive) 9%, var(--background))",
				padding: "0.75rem",
			})}
		>
			<CircleAlert
				aria-hidden="true"
				size={17}
				className={css({ flexShrink: 0, color: "var(--destructive)" })}
			/>
			<div className={css({ minWidth: 0, flex: 1, sm: { minWidth: "12rem" } })}>
				<p className={css({ fontSize: "0.8125rem", fontWeight: 650 })}>
					This response did not finish
				</p>
				<p className={css({ marginTop: "0.125rem", fontSize: "0.75rem", lineHeight: 1.45, color: "var(--muted-foreground)" })}>
					{recovery || "Retry the same prompt without rewriting it."}
				</p>
			</div>
			<RetryResponseButton
				onRetry={onRetry}
				label="Retry response"
				variant="primary"
				className={css({ width: "100%", sm: { width: "auto" } })}
			/>
		</div>
	);
}
