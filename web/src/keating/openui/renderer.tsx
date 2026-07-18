import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import {
	Renderer,
	type ActionEvent,
	type OpenUIError,
} from "@openuidev/react-lang";
import { CircleAlert, Loader2 } from "lucide-react";
import { css } from "../../../styled-system/css";
import type { StorageLike as EventStoreStorage } from "../event-store";
import { keatingOpenUILibrary } from "./library";
import type {
	KeatingOpenUIAction,
	OpenUIDocumentMetadata,
} from "./types";

const STATE_KEY_PREFIX = "keating:openui-state:v1:";

interface StoredOpenUIState {
	version: 1;
	updatedAt: number;
	state: Record<string, unknown>;
}

type StorageLike = Pick<EventStoreStorage, "getItem" | "setItem">;

export type KeatingOpenUIActionHandler = (action: KeatingOpenUIAction) => void;

const OpenUIActionContext = createContext<KeatingOpenUIActionHandler | null>(null);

export function KeatingOpenUIActionProvider({
	onAction,
	children,
}: {
	onAction: KeatingOpenUIActionHandler;
	children: ReactNode;
}) {
	return <OpenUIActionContext.Provider value={onAction}>{children}</OpenUIActionContext.Provider>;
}

export function openUIStateKey(documentId: string): string {
	return `${STATE_KEY_PREFIX}${documentId}`;
}

export function loadOpenUIState(
	storage: StorageLike | null,
	metadata: OpenUIDocumentMetadata,
): Record<string, unknown> {
	if (!storage || metadata.lifecycle === "ephemeral") return {};
	try {
		const raw = storage.getItem(openUIStateKey(metadata.id));
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Partial<StoredOpenUIState>;
		return parsed.version === 1 && parsed.state && typeof parsed.state === "object"
			? parsed.state
			: {};
	} catch {
		return {};
	}
}

export function saveOpenUIState(
	storage: StorageLike | null,
	metadata: OpenUIDocumentMetadata,
	state: Record<string, unknown>,
): boolean {
	if (!storage || metadata.lifecycle === "ephemeral") return false;
	try {
		const payload: StoredOpenUIState = { version: 1, updatedAt: Date.now(), state };
		storage.setItem(openUIStateKey(metadata.id), JSON.stringify(payload));
		return true;
	} catch {
		return false;
	}
}

function browserStorage(): StorageLike | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

export function KeatingOpenUIRenderer({
	program,
	metadata,
	isStreaming = false,
}: {
	program: string;
	metadata: OpenUIDocumentMetadata;
	isStreaming?: boolean;
}) {
	const hostAction = useContext(OpenUIActionContext);
	const [errors, setErrors] = useState<OpenUIError[]>([]);
	const storage = useMemo(browserStorage, []);
	const initialState = useMemo(
		() => loadOpenUIState(storage, metadata),
		[storage, metadata.id, metadata.lifecycle],
	);

	const handleAction = useCallback(
		(event: ActionEvent) => {
			const action: KeatingOpenUIAction = {
				type: event.type,
				humanFriendlyMessage: event.humanFriendlyMessage,
				params: event.params,
				formState: event.formState,
				formName: event.formName,
				document: metadata,
			};
			hostAction?.(action);
		},
		[hostAction, metadata],
	);

	const handleStateUpdate = useCallback(
		(state: Record<string, unknown>) => {
			saveOpenUIState(storage, metadata, state);
		},
		[storage, metadata],
	);

	return (
		<div
			data-openui-document={metadata.id}
			data-openui-lifecycle={metadata.lifecycle}
			data-openui-revision={metadata.revision}
			aria-busy={isStreaming}
		>
			{isStreaming ? (
				<div className={css({ marginBottom: "0.375rem", display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })} role="status">
					<Loader2 aria-hidden="true" size={12} className={css({ animation: "spin 1s linear infinite", "@media (prefers-reduced-motion: reduce)": { animation: "none" } })} />
					Building interaction
				</div>
			) : null}
			<div className={isStreaming ? css({ pointerEvents: "none", opacity: 0.78 }) : undefined}>
				<Renderer
					response={program}
					library={keatingOpenUILibrary}
					isStreaming={isStreaming}
					initialState={initialState}
					onAction={handleAction}
					onStateUpdate={handleStateUpdate}
					onError={setErrors}
				/>
			</div>
			{!isStreaming && errors.length > 0 ? (
				<div className={css({ marginBlock: "0.75rem", display: "flex", alignItems: "flex-start", gap: "0.5rem", borderRadius: "0.5rem", background: "color-mix(in srgb, var(--destructive) 10%, transparent)", padding: "0.75rem", fontSize: "0.75rem", color: "var(--destructive)" })} role="alert">
					<CircleAlert aria-hidden="true" size={15} className={css({ marginTop: "0.0625rem", flexShrink: 0 })} />
					<span>This interaction could not be rendered completely. The surrounding lesson is still available.</span>
				</div>
			) : null}
		</div>
	);
}
