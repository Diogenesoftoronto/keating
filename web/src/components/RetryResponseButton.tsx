import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { Spinner } from "./Spinner";

interface RetryResponseButtonProps {
	onRetry: () => void | Promise<void>;
	className?: string;
	loading?: boolean;
	label?: string;
	variant?: "quiet" | "primary";
}

const buttonClass = css({
	display: "inline-flex",
	height: "1.5rem",
	width: "auto",
	alignItems: "center",
	justifyContent: "center",
	gap: "0.375rem",
	borderRadius: "0.375rem",
	paddingInline: "0.5rem",
	fontSize: "0.75rem",
	color: "var(--muted-foreground)",
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
	_focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" },
	_disabled: { cursor: "not-allowed", opacity: 0.6 },
});
const primaryButtonClass = css({
	height: "2rem",
	borderRadius: "0.5rem",
	backgroundColor: "var(--primary)",
	paddingInline: "0.75rem",
	fontWeight: 600,
	color: "var(--primary-foreground)",
	_hover: {
		backgroundColor: "color-mix(in srgb, var(--primary) 88%, var(--background))",
		color: "var(--primary-foreground)",
	},
});

export function RetryResponseButton({
	onRetry,
	className,
	loading,
	label = "Retry response",
	variant = "quiet",
}: RetryResponseButtonProps) {
	const [pending, setPending] = useState(false);
	const busy = loading ?? pending;

	const retry = async () => {
		if (busy) return;
		setPending(true);
		try {
			await onRetry();
		} finally {
			setPending(false);
		}
	};

	return (
		<button
			type="button"
			className={cx(buttonClass, variant === "primary" && primaryButtonClass, className)}
			title="Retry the same prompt"
			onClick={() => void retry()}
			disabled={busy}
			aria-label={label}
		>
			{busy ? <Spinner size={13} /> : <RotateCcw size={13} />}
			<span>{busy ? "Retrying" : label}</span>
		</button>
	);
}
