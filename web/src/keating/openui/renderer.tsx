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
import { type OpenUISourceFailureKind, tryCompileOpenUISourceToSharedDocument } from "./shared-bridge";
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

/**
 * A component that fails to compile is the model's mistake, not the learner's,
 * so Keating asks the model to fix it rather than showing the learner a stack
 * of broken source. The chain is capped: three consecutive failures anywhere in
 * the session stop the automatic path and hand the learner a manual button, so
 * a model that cannot produce a valid component can never loop forever.
 *
 * Each regeneration arrives as a fresh document with a fresh id, so the cap is
 * a running count of consecutive failures rather than a per-document one, and
 * any successful compile clears it. `attempted` keeps a remount or re-render of
 * the same failed document from dispatching twice.
 */
const MAX_COMPILE_RECOVERY_ATTEMPTS = 3;
const compileRecovery = { consecutiveFailures: 0, attempted: new Set<string>() };

/** Safety rejections are never retried: re-asking is pressure to bypass them. */
function recoverableFailure(kind: OpenUISourceFailureKind): boolean {
	return kind === "invalid" || kind === "unsupported";
}

export function __resetOpenUICompileRecovery(): void {
	compileRecovery.consecutiveFailures = 0;
	compileRecovery.attempted.clear();
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
	const [prepared] = useState<{ document: UiDocument; error?: undefined; kind?: undefined } | { document?: undefined; error: string; kind: OpenUISourceFailureKind }>(() => {
		const compiled = tryCompileOpenUISourceToSharedDocument(program, {
			documentId: metadata.id,
			revision: metadata.revision,
			retention: metadata.lifecycle,
		});
		if (!compiled.ok) return { error: compiled.message, kind: compiled.kind };
		try {
			const migrated = migrateOpenUISourceStateToSharedDocument(
				storage,
				metadata,
				program,
				compiled.document,
			);
			return { document: migrated.document };
		} catch (cause) {
			return {
				error: cause instanceof Error
					? cause.message
					: "The completed OpenUI source could not be migrated safely.",
				kind: "invalid",
			};
		}
	});
	const failure = prepared.error;
	const kind = prepared.kind;
	const [attempt, setAttempt] = useState(0);
	const [exhausted, setExhausted] = useState(false);

	const requestRegeneration = useCallback((manual: boolean) => {
		if (!hostAction || !failure || !kind) return false;
		const next = compileRecovery.consecutiveFailures + 1;
		if (!manual && (next > MAX_COMPILE_RECOVERY_ATTEMPTS || !recoverableFailure(kind))) {
			setExhausted(true);
			return false;
		}
		compileRecovery.consecutiveFailures = manual ? 1 : next;
		compileRecovery.attempted.add(metadata.id);
		setAttempt(compileRecovery.consecutiveFailures);
		void hostAction({
			kind: "legacy",
			type: "regenerate-interaction",
			humanFriendlyMessage: "This interaction could not be built and needs regenerating",
			params: {
				interaction: "regenerate",
				reason: failure,
				failureKind: kind,
				attempt: compileRecovery.consecutiveFailures,
				maxAttempts: MAX_COMPILE_RECOVERY_ATTEMPTS,
				source: program,
			},
			document: metadata,
		});
		return true;
	}, [failure, hostAction, kind, metadata, program]);

	useEffect(() => {
		if (!failure || !kind || compileRecovery.attempted.has(metadata.id)) return;
		if (!requestRegeneration(false)) setExhausted(true);
	}, [failure, kind, metadata.id, requestRegeneration]);

	useEffect(() => {
		if (prepared.document) compileRecovery.consecutiveFailures = 0;
	}, [prepared.document]);

	if (prepared.document) {
		return <DurableSharedUiDocument
			document={prepared.document}
			metadata={metadata}
			storage={storage}
			hostAction={hostAction}
		/>;
	}
	const rebuilding = attempt > 0 && !exhausted;
	return <InertOpenUISourceRecovery
		source={program}
		state={rebuilding ? "rebuilding" : "rejected"}
		error={prepared.error}
		attempt={attempt}
		{...(hostAction && !rebuilding ? { onRetry: () => requestRegeneration(true) } : {})}
	/>;
}

function InertOpenUISourceRecovery({
	source,
	state,
	error,
	attempt,
	onRetry,
}: {
	source: string;
	state: "incomplete" | "rejected" | "rebuilding";
	error?: string;
	attempt?: number;
	onRetry?: () => void;
}) {
	const tone = state === "rejected" ? "var(--destructive)" : "var(--muted-foreground)";
	return <section
		data-openui-source-recovery={state}
		className={css({ marginBlock: "0.75rem", overflow: "hidden", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--muted)" })}
	>
		<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.75rem", fontSize: "0.75rem", color: tone })} role={state === "rejected" ? "alert" : "status"}>
			{state === "rebuilding"
				? <Loader2 aria-hidden="true" size={15} className={css({ marginTop: "0.0625rem", flexShrink: 0, animation: "spin 1s linear infinite", "@media (prefers-reduced-motion: reduce)": { animation: "none" } })} />
				: <CircleAlert aria-hidden="true" size={15} className={css({ marginTop: "0.0625rem", flexShrink: 0 })} />}
			<div className={css({ display: "grid", gap: "0.5rem" })}>
				<span>{state === "incomplete"
					? "This interaction is incomplete. Its source is preserved as inert text and has not been executed."
					: state === "rebuilding"
						? `Rebuilding this interaction${attempt && attempt > 1 ? ` (attempt ${attempt} of ${MAX_COMPILE_RECOVERY_ATTEMPTS})` : ""}…`
						: `This interaction could not be built${error ? `: ${error}` : "."} Nothing was executed.`}</span>
				{onRetry ? <div>
					<button
						type="button"
						className={css({ minHeight: "2.25rem", cursor: "pointer", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "var(--background)", paddingInline: "0.625rem", fontSize: "0.75rem", fontWeight: 650, color: "var(--foreground)", _hover: { background: "var(--muted)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } })}
						onClick={onRetry}
					>
						Ask Keating to rebuild it
					</button>
				</div> : null}
			</div>
		</div>
		{state === "rebuilding" ? null : <details className={css({ borderTop: "1px solid var(--border)" })}>
			<summary className={css({ cursor: "pointer", padding: "0.5rem 0.75rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>Show source</summary>
			<pre className={css({ margin: 0, maxHeight: "18rem", overflow: "auto", borderTop: "1px solid var(--border)", padding: "0.75rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "mono", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>{source}</pre>
		</details>}
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
