import { css } from "../../styled-system/css";

/**
 * Centered muted placeholder used when a list/grid has no items to show.
 * Promoted from a file-local helper in `UsageCharts.tsx` so any component
 * can use the same wording.
 */
export interface EmptyStateProps {
	message: string;
	className?: string;
}

const emptyClass = css({
	py: "3rem",
	textAlign: "center",
	fontSize: "0.875rem",
	color: "var(--muted-foreground)",
});

export function EmptyState({ message, className }: EmptyStateProps) {
	return <div className={className ? `${emptyClass} ${className}` : emptyClass}>{message}</div>;
}