import { useState } from "react";
import { Button, ConfirmDialog } from "../../../design-system/kit";

export function ConfirmAction({ label, description, disabled, onConfirm }: {
	label: string; description: string; disabled?: boolean; onConfirm(): void;
}) {
	const [open, setOpen] = useState(false);
	return <>
		<Button variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>
		<ConfirmDialog open={open} title={label + "?"} description={description} confirmLabel={label}
			onCancel={() => setOpen(false)} onConfirm={() => { setOpen(false); onConfirm(); }}/>
	</>;
}
