import { useState } from "react";
import { Button } from "../design-system/kit";

interface RetryResponseButtonProps {
	onRetry: () => void | Promise<void>;
	className?: string;
	loading?: boolean;
	label?: string;
	variant?: "quiet" | "primary";
}

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

  return <Button className={className} size="sm" variant={variant === "primary" ? "primary" : "outline"}
    title="Retry the same prompt" onClick={() => void retry()} busy={busy}
    glyph={busy ? "spin" : "refresh"} aria-label={label}>{busy ? "Retrying" : label}</Button>;
}
