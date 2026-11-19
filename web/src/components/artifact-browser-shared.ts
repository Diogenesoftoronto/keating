import { KeatingStorage } from "../keating/storage";
import type { RevealQuoteSourceDetail } from "../keating/session-workspace";
import type { SessionMaterialsState } from "./workspace/useSessionMaterials";

export type ArtifactSurfaceView = "workspace" | "library";

export interface ArtifactBrowserSurfaceProps {
  open: boolean;
  /** Legacy library artifact to open directly (switches to the library view). */
  artifactId?: string;
  onClose: () => void;
  /** Active chat session; the panel lists everything Keating made in it. */
  sessionId?: string;
  view?: ArtifactSurfaceView;
  onViewChange?: (view: ArtifactSurfaceView) => void;
  selectedMaterial?: string | null;
  onSelectMaterial?: (key: string) => void;
  reveal?: RevealQuoteSourceDetail | null;
  onRevealHandled?: () => void;
  /** The active session's materials, loaded by the page so the header badge and the panel share one load. */
  materials?: SessionMaterialsState;
  /** Open another conversation on its materials list (from the all-conversations view). */
  onOpenSession?: (sessionId: string) => void;
  /** False when the surface was restored open on load: a non-modal panel then leaves focus alone. */
  focusOnOpen?: boolean;
}

export const artifactBrowserStorage = new KeatingStorage();
