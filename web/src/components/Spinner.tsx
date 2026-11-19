import { KeatingGlyph } from "../design-system/glyphs";
import { cx } from "../../styled-system/css";

/**
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

export function Spinner({ size = 14, className, loading = true, children }: SpinnerProps) {
	if (!loading) return <>{children}</>;
	return <KeatingGlyph name="spin" size={size} className={cx("k-glyph-working", className)} />;
}