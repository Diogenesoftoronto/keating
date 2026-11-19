import { useState } from "react";
import { Button, Switch, SelectField, ConfirmDialog } from "./index";
export default { title: "Kit/Settings controls" };
export function Controls() {
	const [checked, setChecked] = useState(false);
	const [value, setValue] = useState("paper");
	const [open, setOpen] = useState(false);
	return (
		<>
			<Switch label="Higher contrast" checked={checked} onChange={setChecked} />
			<SelectField label="Theme" value={value} onValueChange={setValue}>
				<option value="paper">Paper</option>
				<option value="terminal">Terminal</option>
			</SelectField>
			<Button onClick={() => setOpen(true)}>Discard changes</Button>
			<ConfirmDialog
				open={open}
				title="Discard changes?"
				description="Unsaved theme and contrast edits will be lost."
				confirmLabel="Discard"
				onCancel={() => setOpen(false)}
				onConfirm={() => {
					setChecked(false);
					setValue("paper");
					setOpen(false);
				}}
			/>
		</>
	);
}
