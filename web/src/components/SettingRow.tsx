import type { ReactNode } from "react";

interface SettingRowProps {
	title: string;
	description?: ReactNode;
	children: ReactNode;
	id?: string;
	className?: string;
}

export function SettingRow({ title, description, children, id, className }: SettingRowProps) {
	return (
		<div
			id={id}
			className={`flex items-start justify-between gap-4 rounded-lg border border-border p-4 ${className ?? ""}`}
		>
			<div>
				<div className="text-sm font-medium text-foreground">{title}</div>
				{description && (
					<p className="mt-1 text-sm text-muted-foreground">{description}</p>
				)}
			</div>
			{children}
		</div>
	);
}
