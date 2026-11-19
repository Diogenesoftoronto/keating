import {
	type ReactNode,
	type ComponentProps,
	useEffect,
	createContext,
	useContext,
} from "react";
import { Button, StatusDot } from "../../design-system/kit";
import "./settings.css";

export type Scope =
	| "this device"
	| "your profile"
	| "your account"
	| "this chat"
	| "new chats";
export function ScopeTag({ scope }: { scope: Scope }) {
	return <small className="st-scope">{scope}</small>;
}
export function SettingsSection({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<section className="st-section">
			<h3>{title}</h3>
			{description && <p>{description}</p>}
			{children}
		</section>
	);
}
export function SettingRow({
	id,
	label,
	help,
	scope,
	why,
	children,
}: {
	id: string;
	label: string;
	help: string;
	scope: Scope;
	why?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div
			className="st-row"
			id={id}
			tabIndex={-1}
			role="group"
			aria-labelledby={id + "-label"}
		>
			<div>
				<strong id={id + "-label"}>{label}</strong> <ScopeTag scope={scope} />
				<p>{help}</p>
			</div>
			<div className="st-control">{children}</div>
			{why && <small className="st-why">{why}</small>}
		</div>
	);
}
export function StatusLine({
	tone,
	children,
}: {
	tone: ComponentProps<typeof StatusDot>["tone"];
	children: ReactNode;
}) {
	return (
		<span role="status" className="st-status">
			<StatusDot tone={tone} />
			{children}
		</span>
	);
}
export function SavedHint() {
	return <StatusLine tone="ok">Saved as you change it</StatusLine>;
}
export function UnsavedBar({
	count,
	onDiscard,
	onSave,
}: {
	count: number;
	onDiscard(): void;
	onSave(): void;
}) {
	return (
		<footer className="st-unsaved">
			<StatusLine tone={count ? "warn" : "ok"}>{count} unsaved</StatusLine>
			<Button disabled={!count} onClick={onDiscard}>
				Discard
			</Button>
			<Button variant="primary" disabled={!count} onClick={onSave}>
				Save
			</Button>
		</footer>
	);
}
export interface SectionStatus {
	text?: string;
	count?: number;
	save?(): void;
}
export const SettingsStatusContext = createContext<
	(id: string, status?: SectionStatus) => void
>(() => {});
export function useSectionStatus(id: string, status: SectionStatus) {
	const report = useContext(SettingsStatusContext);
	const { text, count, save } = status;
	useEffect(() => {
		report(id, { text, count, save });
		return () => report(id);
	}, [report, id, text, count, save]);
}
