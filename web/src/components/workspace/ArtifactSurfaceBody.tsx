import type { Ref } from "react";
import { ArrowLeft } from "lucide-react";
import { css } from "../../../styled-system/css";
import { keatingStorage } from "../../hooks/keating-storage";
import { ArtifactViewer } from "../ArtifactViewer";
import { artifactBrowserStorage, type ArtifactBrowserSurfaceProps } from "../artifact-browser-shared";
import { SessionWorkspace } from "./SessionWorkspace";
import { workspaceButton } from "./SessionWorkspaceView";

/**
 * What both artifact surfaces show: the session workspace first, with the
 * legacy all-materials library one step away. Without a session (or when a
 * legacy artifact is targeted) it falls back to the library.
 */
export function ArtifactSurfaceBody(props: ArtifactBrowserSurfaceProps & { headingRef?: Ref<HTMLHeadingElement> }) {
	const view = props.sessionId && !props.artifactId ? props.view ?? "workspace" : "library";
	if (view === "workspace" && props.sessionId) {
		return <SessionWorkspace
			sessionId={props.sessionId}
			source={keatingStorage}
			selectedKey={props.selectedMaterial ?? null}
			onSelect={(key) => props.onSelectMaterial?.(key)}
			onShowLibrary={() => props.onViewChange?.("library")}
			reveal={props.reveal ?? null}
			{...(props.onRevealHandled ? { onRevealHandled: props.onRevealHandled } : {})}
			{...(props.headingRef ? { headingRef: props.headingRef } : {})}
		/>;
	}
	return <div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 0 })}>
		{props.sessionId ? <div>
			<button type="button" className={workspaceButton} onClick={() => props.onViewChange?.("workspace")}>
				<ArrowLeft size={14} aria-hidden="true" /> Back to this session's workspace
			</button>
		</div> : null}
		<h2 ref={props.headingRef} tabIndex={-1} className={css({ fontSize: "1rem", fontWeight: 700, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } })}>All materials</h2>
		<ArtifactViewer storage={artifactBrowserStorage} artifactId={props.artifactId} onClose={props.onClose} />
	</div>;
}
