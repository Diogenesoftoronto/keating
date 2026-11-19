import "./export-sheet.css";
import type { ReactNode } from "react";
import { Button, DefinitionList, Loading, Note, Sheet } from "../../design-system/kit";

export interface ExportSheetProps {
	open: boolean;
	onClose(): void;
	title: string;
	included: ReactNode;
	excluded?: ReactNode;
	format: ReactNode;
	destination: ReactNode;
	note?: ReactNode;
	confirmLabel: string;
	busyLabel?: string;
	busy?: boolean;
	error?: ReactNode;
	onConfirm(): void | Promise<void>;
}

export function ExportSheet(props: ExportSheetProps) {
	const { open, onClose, title, included, excluded, format, destination, note, confirmLabel, busyLabel, busy, error, onConfirm } = props;
	return <Sheet className="rv-export-sheet" open={open} onClose={() => { if (!busy) onClose(); }} title={<span className="rv-sheet-title k-halftone">{title}</span>} footer={<div className="rv-export-actions">
		<Button disabled={busy} onClick={onClose}>Cancel</Button>
		<Button variant="primary" glyph={busy ? undefined : "export"} busy={busy} onClick={onConfirm}>{busy ? <Loading size="inline" label={busyLabel ?? "Exporting…"} /> : confirmLabel}</Button>
	</div>}>
		<DefinitionList items={[
			{ term: "Included", detail: included },
			...(excluded != null ? [{ term: "Not included", detail: excluded }] : []),
			{ term: "Format", detail: format },
			{ term: "Goes to", detail: destination },
		]}/>
		{note != null && <Note data-glyph-host glyph="info">{note}</Note>}
		{error != null && <Note data-glyph-host role="alert" tone="warn">{error}</Note>}
	</Sheet>;
}
