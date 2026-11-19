import { useId, type ReactNode } from "react";
import { Select, type SelectProps } from "../../components/Select";
import { Button } from "./primitives";
import { Sheet } from "./overlays";
import "./settings-controls.css";

export function Switch({
	checked,
	onChange,
	label,
	labelledBy,
	disabled,
}: {
	checked: boolean;
	onChange(value: boolean): void;
	disabled?: boolean;
} & (
	| { label: string; labelledBy?: never }
	| { label?: never; labelledBy: string }
)) {
	const id = useId();
	return (
		<span className="k-switch-field">
			{label && <label htmlFor={id}>{label}</label>}
			<button
				id={id}
				type="button"
				role="switch"
				aria-labelledby={labelledBy}
				aria-checked={checked}
				disabled={disabled}
				className="k-switch"
				onClick={() => onChange(!checked)}
			>
				<span />
			</button>
		</span>
	);
}

export function SelectField({
	label,
	id,
	...props
}: SelectProps & { label: string }) {
	const generated = useId();
	return (
		<div className="k-select-field">
			<label htmlFor={id ?? generated}>{label}</label>
			<Select {...props} id={id ?? generated} />
		</div>
	);
}

export function ConfirmDialog({
	open,
	title,
	description,
	cancelLabel = "Cancel",
	confirmLabel,
	onCancel,
	onConfirm,
	children,
}: {
	open: boolean;
	title: string;
	description: string;
	cancelLabel?: string;
	confirmLabel: string;
	onCancel(): void;
	onConfirm(): void;
	children?: ReactNode;
}) {
	return (
		<Sheet
			open={open}
			role="alertdialog"
			aria-modal="true"
			title={title}
			description={description}
			onClose={onCancel}
			footer={
				<>
					<Button onClick={onCancel}>{cancelLabel}</Button>
					{children}
					<Button variant="primary" onClick={onConfirm}>
						{confirmLabel}
					</Button>
				</>
			}
		/>
	);
}
