import { useRef, useState, type ReactNode } from "react";
import { css, cx } from "../../styled-system/css";
import { useOutsideClick } from "../hooks/useOutsideClick";

/**
 * Standard anchor + popup menu pattern. Replaces ~6 inline implementations
 * (SessionCard, ForkMapCard, SessionBrowserDesktop, Chat mobile menu,
 * CustomProvidersSection Add Provider dropdown, …) that each replicated
 * the same outside-click useEffect and menu DOM.
 *
 * The trigger button is rendered by the caller (children render-prop).
 * Items are declarative, so menu structure is data not JSX.
 */

export interface OverflowMenuItem {
	/** Stable key. */
	key: string;
	/** Visible label. */
	label: string;
	/** Optional leading icon. */
	icon?: ReactNode;
	/** Show a spinner instead of the icon and disable clicks. */
	busy?: boolean;
	/** Disable the item but render it normally. */
	disabled?: boolean;
	/** Render the item in destructive red. */
	destructive?: boolean;
	onSelect: () => void;
}

export interface OverflowMenuProps {
	/** Trigger content (typically an icon button). */
	children: (api: { open: boolean; toggle: () => void }) => ReactNode;
	items: OverflowMenuItem[];
	/** Anchor-side alignment: default right-aligns the panel to the trigger. */
	align?: "start" | "end";
	/** Override panel width. */
	width?: string;
	/** Pixel offset between trigger and panel (default 8 = trigger height gap). */
	offset?: number;
	/** Class for the menu panel wrapper (positioning hooks). */
	className?: string;
}

export function OverflowMenu({
	children,
	items,
	align = "end",
	width = "9rem",
	offset = 8,
	className,
}: OverflowMenuProps) {
	const [open, setOpen] = useState(false);
	const wrapperRef = useRef<HTMLDivElement>(null);
	useOutsideClick(open, wrapperRef, () => setOpen(false));
	const toggle = () => setOpen((o) => !o);

	return (
		<div ref={wrapperRef} className={cx(css({ position: "relative", flexShrink: 0 }), className)}>
			{children({ open, toggle })}
			{open ? (
				<div
					role="menu"
					className={css({
						position: "absolute",
						top: `calc(100% + ${offset}px)`,
						...(align === "end" ? { right: 0 } : { left: 0 }),
						zIndex: 20,
						width,
						overflow: "hidden",
						borderRadius: "0.5rem",
						border: "1px solid var(--border)",
						background: "var(--background)",
						paddingBlock: "0.25rem",
						boxShadow: "var(--shadow-lg)",
					})}
				>
					{items.map((item) => (
						<button
							key={item.key}
							type="button"
							role="menuitem"
							disabled={item.disabled || item.busy}
							onClick={() => {
								setOpen(false);
								item.onSelect();
							}}
							className={css({
								display: "flex",
								width: "100%",
								alignItems: "center",
								gap: "0.5rem",
								padding: "0.5rem 0.75rem",
								textAlign: "left",
								fontSize: "0.75rem",
								color: item.destructive ? "var(--destructive)" : undefined,
								_hover: {
									background: item.destructive
										? "color-mix(in srgb, var(--destructive) 10%, transparent)"
										: "var(--accent)",
								},
								_disabled: { opacity: 0.5 },
							})}
						>
							{item.icon}
							{item.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}