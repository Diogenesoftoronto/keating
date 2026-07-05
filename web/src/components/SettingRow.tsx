import type { ReactNode } from "react";
import { css, cx } from "../../styled-system/css";

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
	return (
		<div id={id} className={cx(outerClass, className)}>
			<div>
				<div className={titleClass}>{title}</div>
				{description && <p className={descriptionClass}>{description}</p>}
			</div>
			{children}
		</div>
	);
}
