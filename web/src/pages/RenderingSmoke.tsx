import { useState } from "react";
import {
	MARKDOWN_PARITY_FIXTURE,
	OPENUI_JSON_PARITY_FIXTURE,
	OPENUI_SOURCE_PARITY_FIXTURE,
} from "@keating/learner-contracts";
import { css } from "../../styled-system/css";
import { MarkdownBlock } from "../components/MarkdownBlock";
import {
	KeatingOpenUIActionProvider,
	KeatingOpenUIRenderer,
	openUIStateKey,
} from "../keating/openui/renderer";
import { sharedUiActionStateKey } from "../keating/openui/shared-actions";
import type { KeatingOpenUIAction } from "../keating/openui/types";

const page = css({ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", padding: "1rem", sm: { padding: "2rem" } });
const content = css({ marginInline: "auto", display: "grid", maxWidth: "72rem", gap: "1.5rem" });
const card = css({ display: "grid", gap: "0.75rem", border: "1px solid var(--border)", borderRadius: "0.75rem", background: "var(--background)", padding: "1rem" });
const button = css({ minHeight: "2.75rem", border: "1px solid var(--border)", borderRadius: "0.5rem", paddingInline: "0.875rem", fontWeight: 650, cursor: "pointer", _hover: { background: "var(--muted)" } });

/**
 * Isolated production rendering harness. It exercises the same Markdown,
 * Mermaid, shared renderer, and durable action code as chat without mounting a
 * learner session or writing fixture activity into learner data.
 */
export function RenderingSmoke() {
	const [mount, setMount] = useState(0);
	const [lastAction, setLastAction] = useState<KeatingOpenUIAction | null>(null);
	const document = OPENUI_JSON_PARITY_FIXTURE;
	const sourceDocumentId = "rendering-source-parity-document";
	const reset = () => {
		window.localStorage.removeItem(sharedUiActionStateKey(document.id));
		window.localStorage.removeItem(sharedUiActionStateKey(sourceDocumentId));
		window.localStorage.removeItem(openUIStateKey(sourceDocumentId));
		setLastAction(null);
		setMount((value) => value + 1);
	};

	return <main className={page}>
		<div className={content}>
			<header className={card}>
				<p className={css({ color: "var(--primary)", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" })}>Cross-surface acceptance fixture v1</p>
				<h1 className={css({ fontSize: "1.75rem", fontWeight: 750 })}>Markdown, Mermaid, and OpenUI</h1>
				<p>This route is isolated from learner sessions. Controls write only the fixture's versioned action journal so reload and replay can be inspected safely.</p>
				<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
					<a className={button} href="/chat">Back to Tutor</a>
					<button className={button} type="button" onClick={reset}>Reset fixture receipts</button>
				</div>
			</header>

			<section className={card} aria-labelledby="markdown-fixture-title">
				<h2 id="markdown-fixture-title" className={css({ fontSize: "1.125rem", fontWeight: 700 })}>Web Markdown reference</h2>
				<MarkdownBlock content={MARKDOWN_PARITY_FIXTURE} />
			</section>

			<section aria-labelledby="openui-fixture-title">
				<h2 id="openui-fixture-title" className={css({ marginBottom: "0.5rem", fontSize: "1.125rem", fontWeight: 700 })}>Canonical OpenUI reference</h2>
				<KeatingOpenUIActionProvider onAction={setLastAction}>
					<KeatingOpenUIRenderer
						key={`${document.id}:${mount}`}
						document={document}
						metadata={{ id: document.id, revision: document.revision, lifecycle: "resumable" }}
					/>
				</KeatingOpenUIActionProvider>
			</section>

			<section aria-labelledby="openui-source-fixture-title">
				<h2 id="openui-source-fixture-title" className={css({ marginBottom: "0.5rem", fontSize: "1.125rem", fontWeight: 700 })}>Browser-source OpenUI reference</h2>
				<KeatingOpenUIActionProvider onAction={setLastAction}>
					<KeatingOpenUIRenderer
						key={`${sourceDocumentId}:${mount}`}
						program={OPENUI_SOURCE_PARITY_FIXTURE}
						sourceComplete
						metadata={{ id: sourceDocumentId, revision: 0, lifecycle: "workspace" }}
					/>
				</KeatingOpenUIActionProvider>
			</section>

			<section className={card} aria-live="polite">
				<h2 className={css({ fontSize: "1.125rem", fontWeight: 700 })}>Last committed fixture action</h2>
				{lastAction?.kind === "canonical"
					? <dl className={css({ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "0.375rem 0.75rem", fontSize: "0.75rem" })}>
						<dt>Type</dt><dd>{lastAction.action.type}</dd>
						<dt>Key</dt><dd className={css({ overflowWrap: "anywhere" })}>{lastAction.action.idempotencyKey}</dd>
						<dt>Receipt</dt><dd>{lastAction.receipt.state}</dd>
						<dt>Revision</dt><dd>{lastAction.receipt.result?.resultingDocument?.revision ?? "unchanged"}</dd>
					</dl>
					: <p>No action committed during this mount. Reload to verify durable restoration.</p>}
			</section>
		</div>
	</main>;
}
