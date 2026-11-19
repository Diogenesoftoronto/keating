import type { Ref } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import { css } from "../../../styled-system/css";
import { keatingStorage } from "../../hooks/keating-storage";
import { ArtifactViewer } from "../ArtifactViewer";
import { artifactBrowserStorage, type ArtifactBrowserSurfaceProps } from "../artifact-browser-shared";
import { MaterialsBySession } from "./MaterialsBySession";
import { SessionMaterialsPanel } from "./SessionMaterialsPanel";
import { workspaceButton } from "./SessionWorkspaceView";
import { useSessionMaterials, type SessionMaterialsState } from "./useSessionMaterials";

type SurfaceBodyProps = ArtifactBrowserSurfaceProps & { headingRef?: Ref<HTMLHeadingElement>; modal?: boolean };

function SessionPanel(props: SurfaceBodyProps & { sessionId: string; state: SessionMaterialsState }) {
	return <SessionMaterialsPanel
		state={props.state}
		sessionId={props.sessionId}
		source={keatingStorage}
		selectedKey={props.selectedMaterial ?? null}
		onSelect={(key) => props.onSelectMaterial?.(key)}
		onShowLibrary={() => props.onViewChange?.("library")}
		onClose={props.onClose}
		reveal={props.reveal ?? null}
		{...(props.onRevealHandled ? { onRevealHandled: props.onRevealHandled } : {})}
		{...(props.headingRef ? { headingRef: props.headingRef } : {})}
		{...(props.modal ? { modal: true } : {})}
	/>;
}

/** Loads the session itself when the page did not pass its shared state. */
function OwnSessionPanel(props: SurfaceBodyProps & { sessionId: string }) {
	const state = useSessionMaterials(props.sessionId);
	return <SessionPanel {...props} state={state} />;
}

/**
 * What both artifact surfaces show: this session's materials first, with the
 * all-sessions library one step away. Without a session (or when a stored
 * record is targeted) it falls back to the library.
 */
export function ArtifactSurfaceBody(props: SurfaceBodyProps) {
	const view = props.sessionId && !props.artifactId ? props.view ?? "workspace" : "library";
	if (view === "workspace" && props.sessionId) {
		return props.materials && props.materials.sessionId === props.sessionId
			? <SessionPanel {...props} sessionId={props.sessionId} state={props.materials} />
			: <OwnSessionPanel {...props} sessionId={props.sessionId} />;
	}
	return <div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 0 })}>
		{props.sessionId ? <div>
			<button type="button" className={workspaceButton} onClick={() => props.onViewChange?.("workspace")}>
				<KeatingGlyph name="left" size={14} /> Back to this session's materials
			</button>
		</div> : null}
		<h2 ref={props.headingRef} tabIndex={-1} className="h1-material-heading">All materials</h2>
		{/* A targeted stored record opens straight in the library below; otherwise lead with where materials live. */}
		{props.onOpenSession && !props.artifactId ? <MaterialsBySession
			{...(props.sessionId ? { activeSessionId: props.sessionId } : {})}
			onOpenSession={(sessionId) => {
				if (sessionId === props.sessionId) props.onViewChange?.("workspace");
				else props.onOpenSession?.(sessionId);
			}}
		/> : null}
		<ArtifactViewer storage={artifactBrowserStorage} artifactId={props.artifactId} onClose={props.onClose} />
	</div>;
}
