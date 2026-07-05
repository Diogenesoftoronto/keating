import { GitBranch } from "lucide-react";
import { css } from "../../styled-system/css";

export interface ForkBannerProps {
	/** Title of the session this one was forked from. */
	parentTitle: string;
	/** Jump back to the original (parent) session. */
	onOpenOriginal: () => void;
}

const rootClass = css({
	flexShrink: 0,
	borderBottom: "1px solid var(--border)",
	backgroundColor: "color-mix(in srgb, var(--primary) 5%, transparent)",
	paddingInline: "0.75rem",
	paddingBlock: "0.5rem",
});
const rowClass = css({
	marginInline: "auto",
	display: "flex",
	maxWidth: "48rem",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "0.75rem",
});
const labelStackClass = css({
	display: "flex",
	minWidth: 0,
	alignItems: "center",
	gap: "0.5rem",
	fontSize: "0.75rem",
	color: "var(--muted-foreground)",
});
const truncateClass = css({
	minWidth: 0,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});
const parentTitleClass = css({ fontWeight: 500, color: "var(--foreground)" });
const iconClass = css({ flexShrink: 0, color: "var(--primary)" });
const buttonClass = css({
	display: "inline-flex",
	height: "1.5rem",
	flexShrink: 0,
	alignItems: "center",
	borderRadius: "0.25rem",
	border: "1px solid var(--border)",
	paddingInline: "0.5rem",
	fontSize: "11px",
	fontWeight: 500,
	transitionProperty: "background-color, color",
	transitionDuration: "150ms",
	_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
});

/**
 * Slim banner shown under the chat header when the active session is a fork,
 * making the branch relationship obvious and offering a jump back to the
 * original session.
 */
export function ForkBanner({ parentTitle, onOpenOriginal }: ForkBannerProps) {
	return (
		<div className={rootClass}>
			<div className={rowClass}>
				<div className={labelStackClass}>
					<GitBranch size={13} className={iconClass} />
					<span className={truncateClass}>
						Forked from{" "}
						<span className={parentTitleClass}>
							“{parentTitle}”
						</span>
					</span>
				</div>
				<button
					type="button"
					className={buttonClass}
					onClick={onOpenOriginal}
				>
					Open original
				</button>
			</div>
		</div>
	);
}
