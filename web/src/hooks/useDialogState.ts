import { useCallback, useState } from "react";

export interface DialogState {
	open: boolean;
	onOpen: () => void;
	onClose: () => void;
	toggle: () => void;
}

export function useDialogState(initialOpen = false): DialogState {
	const [open, setOpen] = useState(initialOpen);

	const onOpen = useCallback(() => {
		setOpen(true);
	}, []);

	const onClose = useCallback(() => {
		setOpen(false);
	}, []);

	const toggle = useCallback(() => {
		setOpen((prev) => !prev);
	}, []);

	return { open, onOpen, onClose, toggle };
}
