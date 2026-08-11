import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type { UiAction, UiDocument } from "@keating/learner-contracts";
import { CircleAlert, Loader2 } from "lucide-react";
import { css } from "../../../styled-system/css";
import type { StorageLike as EventStoreStorage } from "../event-store";
import { compileOpenUISourceToSharedDocument } from "./shared-bridge";
import type {
	KeatingOpenUIAction,
	OpenUIDocumentMetadata,
} from "./types";
import { SharedUiDocumentRenderer } from "./shared-renderer";
import {
	acknowledgeSharedUiActionDelivery,
	dispatchSharedUiAction,
	loadSharedUiActionState,
	type SharedUiActionDelivery,
	type SharedUiActionIntent,
} from "./shared-actions";
import {
	loadOpenUISourceState,
	migrateOpenUISourceStateToSharedDocument,
	openUISourceStateKey,
	saveOpenUISourceState,
} from "./source-state";

type StorageLike = Pick<EventStoreStorage, "getItem" | "setItem">;

export type KeatingOpenUIActionHandler = (
	action: KeatingOpenUIAction,
) => boolean | void | Promise<boolean | void>;

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
	return openUISourceStateKey(documentId);
}

export function loadOpenUIState(
	storage: StorageLike | null,
	metadata: OpenUIDocumentMetadata,
	source = "",
): Record<string, unknown> {
	return loadOpenUISourceState(storage, metadata, source)?.state ?? {};
}

export function saveOpenUIState(
	storage: StorageLike | null,
	metadata: OpenUIDocumentMetadata,
	state: Record<string, unknown>,
	source = "",
): boolean {
	return saveOpenUISourceState(storage, metadata, source, state);
}

function browserStorage(): StorageLike | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function memoryStorage(): StorageLike {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
	};
}

export function KeatingOpenUIRenderer({
	program,
	source,
	document,
	metadata,
	isStreaming = false,
	sourceComplete = !isStreaming,
}: {
	program?: string;
	/** Full inert source, including any uncommitted streaming tail. */
	source?: string;
	document?: UiDocument;
	metadata: OpenUIDocumentMetadata;
	isStreaming?: boolean;
	/** True only after the source fence closes; partial source remains inert. */
	sourceComplete?: boolean;
}) {
	const hostAction = useContext(OpenUIActionContext);
	const storage = useMemo(browserStorage, []);

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
			{document ? <DurableSharedUiDocument key={`${document.id}:${document.revision}`} document={document} metadata={metadata} storage={storage} hostAction={hostAction} /> : program && sourceComplete && !isStreaming ? (
				<CompletedOpenUISource
					key={`${metadata.id}:${metadata.revision}`}
					program={program}
					metadata={metadata}
					storage={storage}
					hostAction={hostAction}
				/>
			) : program || source ? (
				<InertOpenUISourceRecovery source={source ?? program ?? ""} state="incomplete" />
			) : null}
		</div>
	);
}

function CompletedOpenUISource({
	program,
	metadata,
	storage,
	hostAction,
}: {
	program: string;
	metadata: OpenUIDocumentMetadata;
	storage: StorageLike | null;
	hostAction: KeatingOpenUIActionHandler | null;
}) {
	const [prepared] = useState<{ document: UiDocument; error?: undefined } | { document?: undefined; error: string }>(() => {
		try {
			const compiled = compileOpenUISourceToSharedDocument(program, {
				documentId: metadata.id,
				revision: metadata.revision,
				retention: metadata.lifecycle,
			});
			const migrated = migrateOpenUISourceStateToSharedDocument(
				storage,
				metadata,
				program,
				compiled,
			);
			return { document: migrated.document };
		} catch (cause) {
			return {
				error: cause instanceof Error
					? cause.message
					: "The completed OpenUI source could not be migrated safely.",
			};
		}
	});

	if (prepared.document) {
		return <DurableSharedUiDocument
			document={prepared.document}
			metadata={metadata}
			storage={storage}
			hostAction={hostAction}
		/>;
	}
	return <InertOpenUISourceRecovery source={program} state="rejected" error={prepared.error} />;
}

function InertOpenUISourceRecovery({
	source,
	state,
	error,
}: {
	source: string;
	state: "incomplete" | "rejected";
	error?: string;
}) {
	return <section
		data-openui-source-recovery={state}
		className={css({ marginBlock: "0.75rem", overflow: "hidden", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--muted)" })}
	>
		<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.75rem", fontSize: "0.75rem", color: state === "rejected" ? "var(--destructive)" : "var(--muted-foreground)" })} role={state === "rejected" ? "alert" : "status"}>
			<CircleAlert aria-hidden="true" size={15} className={css({ marginTop: "0.0625rem", flexShrink: 0 })} />
			<span>{state === "incomplete"
				? "This interaction is incomplete. Its source is preserved as inert text and has not been executed."
				: `This interaction could not be compiled safely${error ? `: ${error}` : "."} Its source is preserved as inert text and has not been executed.`}</span>
		</div>
		<pre className={css({ margin: 0, maxHeight: "18rem", overflow: "auto", borderTop: "1px solid var(--border)", padding: "0.75rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "mono", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>{source}</pre>
	</section>;
}

function canonicalActionParams(action: UiAction): Record<string, unknown> {
	const {
		schemaVersion: _schemaVersion,
		documentId: _documentId,
		documentRevision: _documentRevision,
		idempotencyKey: _idempotencyKey,
		...params
	} = action;
	return params;
}

function DurableSharedUiDocument({
	document,
	metadata,
	storage,
	hostAction,
}: {
	document: UiDocument;
	metadata: OpenUIDocumentMetadata;
	storage: StorageLike | null;
	hostAction: KeatingOpenUIActionHandler | null;
}) {
	const transientStorage = useMemo(memoryStorage, []);
	const actionStorage = metadata.lifecycle === "ephemeral" ? transientStorage : storage;
	const [state, setState] = useState(() => loadSharedUiActionState(
		metadata.lifecycle === "ephemeral" ? null : storage,
		document,
		metadata.legacyIds,
	));
	const [actionError, setActionError] = useState<string | null>(null);
	const deliveriesInFlight = useRef(new Set<string>());

	const emitDelivery = useCallback(async (delivery: SharedUiActionDelivery) => {
		if (!hostAction || !actionStorage || delivery.state !== "pending") return;
		if (metadata.sessionId && delivery.sessionId !== metadata.sessionId) return;
		if (deliveriesInFlight.current.has(delivery.id)) return;
		const receipt = state.journal.receipts.find((candidate) =>
			`${candidate.action.documentId}-${candidate.action.idempotencyKey}` === delivery.id);
		if (!receipt) return;
		deliveriesInFlight.current.add(delivery.id);
		try {
			const accepted = await hostAction({
				kind: "canonical",
				type: receipt.action.type,
				humanFriendlyMessage: delivery.humanFriendlyMessage,
				params: canonicalActionParams(receipt.action),
				document: {
					...metadata,
					id: delivery.sourceDocument.id,
					revision: delivery.sourceDocument.revision,
				},
				action: receipt.action,
				sourceDocument: delivery.sourceDocument,
				receipt,
			});
			if (accepted === true) {
				acknowledgeSharedUiActionDelivery(actionStorage, delivery.sourceDocument, delivery.id);
				setState(loadSharedUiActionState(actionStorage, document, metadata.legacyIds));
				setActionError(null);
			}
		} catch (cause) {
			setActionError(cause instanceof Error
				? `This interaction is saved locally, but its learner record was not committed: ${cause.message} Reload or retry when ready.`
				: "This interaction is saved locally, but its learner record was not committed. Reload or retry when ready.");
		} finally {
			deliveriesInFlight.current.delete(delivery.id);
		}
	}, [actionStorage, document, hostAction, metadata, state.journal.receipts]);

	useEffect(() => {
		for (const delivery of state.deliveries) void emitDelivery(delivery);
	}, [emitDelivery, state.deliveries]);

	const handleSharedAction = useCallback((event: { intent: SharedUiActionIntent; humanFriendlyMessage: string }) => {
		if (!actionStorage) {
			setActionError("This interaction could not be saved in this browser. Your entered work is still here; retry after enabling site storage.");
			return false;
		}
		try {
			const dispatched = dispatchSharedUiAction(
				actionStorage,
				state.document,
				event.intent,
				undefined,
				metadata.sessionId
					? { sessionId: metadata.sessionId, humanFriendlyMessage: event.humanFriendlyMessage }
					: undefined,
			);
			setState({ version: 1, document: dispatched.document, journal: dispatched.journal, deliveries: dispatched.deliveries });
			setActionError(null);
			if (metadata.sessionId) {
				const delivery = dispatched.deliveries.find((candidate) => candidate.id === `${dispatched.action.documentId}-${dispatched.action.idempotencyKey}`);
				if (delivery) void emitDelivery(delivery);
			} else if (!dispatched.replayed) {
				hostAction?.({
					kind: "canonical",
					type: dispatched.action.type,
					humanFriendlyMessage: event.humanFriendlyMessage,
					params: canonicalActionParams(dispatched.action),
					document: {
						...metadata,
						id: dispatched.sourceDocument.id,
						revision: dispatched.sourceDocument.revision,
					},
					action: dispatched.action,
					sourceDocument: dispatched.sourceDocument,
					receipt: dispatched.receipt,
				});
			}
			return true;
		} catch (cause) {
			setActionError(cause instanceof Error
				? `This interaction was not saved: ${cause.message} Your entered work is still here; retry when ready.`
				: "This interaction was not saved. Your entered work is still here; retry when ready.");
			return false;
		}
	}, [actionStorage, emitDelivery, hostAction, metadata, state.document]);

	return <>
		<SharedUiDocumentRenderer
			document={state.document}
			receipts={state.journal.receipts}
			onAction={handleSharedAction}
		/>
		{actionError ? <div className={css({ marginBlock: "0.75rem", borderRadius: "0.5rem", background: "color-mix(in srgb, var(--destructive) 10%, transparent)", padding: "0.75rem", fontSize: "0.75rem", color: "var(--destructive)" })} role="alert">{actionError}</div> : null}
	</>;
}
