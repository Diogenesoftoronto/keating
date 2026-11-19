import { KeatingGlyph } from "../design-system/glyphs";
import { css } from "../../styled-system/css";

export function ImageGenerationRetryButton({ onRetry }: { onRetry: () => void }) {
	return (
		<button
			type="button"
			onClick={onRetry}
			className={css({
				marginTop: "0.5rem",
				display: "inline-flex",
				alignItems: "center",
				gap: "0.375rem",
				borderRadius: "0.375rem",
				border: "1px solid currentColor",
				paddingInline: "0.625rem",
				paddingBlock: "0.375rem",
				fontWeight: 600,
				_hover: { backgroundColor: "color-mix(in srgb, var(--destructive) 12%, transparent)" },
				_focusVisible: { outline: "2px solid currentColor", outlineOffset: "2px" },
			})}
		>
			<KeatingGlyph name="refresh" size={12} />
			Choose model and retry
		</button>
	);
}
