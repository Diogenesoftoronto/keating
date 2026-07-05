import { Loader2 } from "lucide-react";
import { css, cx } from "../../styled-system/css";

/**
 * Single source of truth for the rotating loader icon. Replaces ~15 inline
 * `<Loader2 size={N} className={css({ animation: "spin 1s linear infinite" })} />`
 * sites scattered across components and pages.
 *
 * The `loading` prop avoids the visual flash when `busy` flips false → true
 * inside a quick action; pass `loading={false}` to fall through to children
 * (typically the underlying icon).
 */
export interface SpinnerProps {
	size?: number;
	className?: string;
	loading?: boolean;
	children?: React.ReactNode;
}

const spinnerClass = css({ animation: "spin 1s linear infinite" });

export function Spinner({ size = 14, className, loading = true, children }: SpinnerProps) {
	if (!loading) return <>{children}</>;
	return <Loader2 size={size} className={cx(spinnerClass, className)} />;
}