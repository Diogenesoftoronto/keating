import { useEffect, useId, useState } from "react";
import { EmptyState, Loading } from "../../design-system/kit";
import { KeatingGlyph } from "../../design-system/glyphs";
import { css } from "../../../styled-system/css";
import { getInitPromise, sessions } from "../../hooks/keating-storage";
import { summarizeMaterialsBySession, type SessionMaterialSummary } from "../../keating/session-materials";
import { OPENUI_PRESENTATIONS_CHANGED_EVENT } from "../../keating/storage";
import { relativeTime } from "./SessionMaterialsPanel";
import { muted } from "./SessionWorkspaceView";
import { defaultSessionMaterialsSource } from "./useSessionMaterials";

/**
 * Which conversations hold materials, newest first. The way to find the
 * session a plan or quiz lives in; opening a row shows that session's own
 * materials list.
 */

export interface SessionMaterialsRow extends SessionMaterialSummary {
	title: string;
}

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; rows: SessionMaterialsRow[] };

/** Summaries joined to the sessions that still exist; a deleted session's records are not listed. */
export async function loadMaterialsBySession(): Promise<SessionMaterialsRow[]> {
	await getInitPromise();
	const [records, legacy, metadata] = await Promise.all([
		defaultSessionMaterialsSource.getOpenUiPresentations(),
		defaultSessionMaterialsSource.getLegacyRecords?.() ?? Promise.resolve(undefined),
		sessions.getAllMetadata(),
	]);
	const titles = new Map(metadata.filter((session) => !session.hiddenAlternative).map((session) => [session.id, session.title || "Untitled session"]));
	return summarizeMaterialsBySession(records, legacy).flatMap((summary) => {
		const title = titles.get(summary.sessionId);
		return title === undefined ? [] : [{ ...summary, title }];
	});
}

export function kindSummary(kinds: SessionMaterialSummary["kinds"]): string {
	return kinds.map(({ label, count }) => (count > 1 ? `${label} ×${count}` : label)).join(" · ");
}

export function MaterialsBySessionList({ rows, activeSessionId, onOpenSession, now = Date.now() }: {
	rows: readonly SessionMaterialsRow[]; activeSessionId?: string; onOpenSession: (sessionId: string) => void; now?: number;
}) {
	return <ul className={css({ display: "flex", flexDirection: "column", gap: "0.125rem", listStyle: "none", margin: 0, padding: 0 })}>
		{rows.map((entry) => <li key={entry.sessionId}>
			<button type="button" className="h1-material-row" aria-current={entry.sessionId === activeSessionId ? "true" : undefined} data-materials-session={entry.sessionId} onClick={() => onOpenSession(entry.sessionId)}>
				<span className={css({ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: 0, flex: 1 })}>
					<span className="h1-material-name">{entry.title}</span>
					<span className={css({ fontSize: "0.75rem", lineHeight: 1.4, color: "var(--foreground)", overflowWrap: "anywhere" })}>{kindSummary(entry.kinds)}</span>
					<span className={muted}>{entry.sessionId === activeSessionId ? "This conversation · " : ""}{relativeTime(entry.latestAt, now)}</span>
				</span>
				<KeatingGlyph name="chevr" size={16} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
			</button>
		</li>)}
	</ul>;
}

export function MaterialsBySession({ activeSessionId, onOpenSession }: { activeSessionId?: string; onOpenSession: (sessionId: string) => void }) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const headingId = useId();
	useEffect(() => {
		let cancelled = false;
		const read = () => {
			void loadMaterialsBySession().then(
				(rows) => { if (!cancelled) setLoad({ status: "ready", rows }); },
				() => { if (!cancelled) setLoad({ status: "error" }); },
			);
		};
		read();
		window.addEventListener(OPENUI_PRESENTATIONS_CHANGED_EVENT, read);
		window.addEventListener("keating:artifact-created", read);
		window.addEventListener("keating:sessions-changed", read);
		return () => {
			cancelled = true;
			window.removeEventListener(OPENUI_PRESENTATIONS_CHANGED_EVENT, read);
			window.removeEventListener("keating:artifact-created", read);
			window.removeEventListener("keating:sessions-changed", read);
		};
	}, []);

	return <section aria-labelledby={headingId} className={css({ display: "flex", flexDirection: "column", gap: "0.375rem", minWidth: 0 })} data-materials-by-session="">
		<h3 id={headingId} className="h1-library-section">By conversation</h3>
		{load.status === "loading" ? <Loading label="Looking through your conversations…" />
			: load.status === "error" ? <p role="alert" className={muted}>Your conversations' materials could not be read on this device.</p>
			: load.rows.length === 0 ? <EmptyState heading="No conversation has materials yet." glyph="message">Plans, quizzes, flashcards and assignments Keating makes will be listed here by conversation.</EmptyState>
			: <MaterialsBySessionList rows={load.rows} {...(activeSessionId ? { activeSessionId } : {})} onOpenSession={onOpenSession} />}
	</section>;
}
