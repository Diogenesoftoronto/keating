import { createContext, useId, type ReactNode } from "react";
import { css, cx } from "../../styled-system/css";

/** Ids a control inside a row uses to take its name and description from the row's visible text. */
export const SettingRowContext = createContext<{ titleId: string; descriptionId?: string } | null>(null);

interface SettingRowProps {
	title: string;
	description?: ReactNode;
	children: ReactNode;
	id?: string;
	className?: string;
}

const outerClass = css({
	display: "flex",
	alignItems: "flex-start",
	justifyContent: "space-between",
	gap: "1rem",
	borderRadius: "0.5rem",
	border: "1px solid var(--border)",
	padding: "1rem",
});
const titleClass = css({
	fontSize: "0.875rem",
	fontWeight: 500,
	color: "var(--foreground)",
});
const descriptionClass = css({
	marginTop: "0.25rem",
	fontSize: "0.875rem",
	color: "var(--muted-foreground)",
});

export function SettingRow({ title, description, children, id, className }: SettingRowProps) {
	const base = useId();
	const titleId = `${base}-title`;
	const descriptionId = description ? `${base}-description` : undefined;
	return (
		<SettingRowContext.Provider value={{ titleId, descriptionId }}>
			<div id={id} className={cx(outerClass, className)}>
				<div>
					<div id={titleId} className={titleClass}>{title}</div>
					{description && <p id={descriptionId} className={descriptionClass}>{description}</p>}
				</div>
				{children}
			</div>
		</SettingRowContext.Provider>
	);
}
