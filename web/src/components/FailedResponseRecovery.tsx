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
				alignItems: "center",
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
			<div className={css({ minWidth: "12rem", flex: 1 })}>
				<p className={css({ fontSize: "0.8125rem", fontWeight: 650 })}>
					This response did not finish
				</p>
				<p className={css({ marginTop: "0.125rem", fontSize: "0.75rem", lineHeight: 1.45, color: "var(--muted-foreground)" })}>
					{recovery || "Retry the same prompt without rewriting it."}
				</p>
			</div>
			<RetryResponseButton onRetry={onRetry} label="Retry prompt" variant="primary" />
		</div>
	);
}
