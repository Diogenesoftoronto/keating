import { KeatingStorage } from "../keating/storage";
import type { RevealQuoteSourceDetail } from "../keating/session-workspace";

export type ArtifactSurfaceView = "workspace" | "library";

export interface ArtifactBrowserSurfaceProps {
  open: boolean;
  /** Legacy library artifact to open directly (switches to the library view). */
  artifactId?: string;
  onClose: () => void;
  /** Active chat session; the workspace shows its plan and maps. */
  sessionId?: string;
  view?: ArtifactSurfaceView;
  onViewChange?: (view: ArtifactSurfaceView) => void;
  selectedMaterial?: string | null;
  onSelectMaterial?: (key: string) => void;
  reveal?: RevealQuoteSourceDetail | null;
  onRevealHandled?: () => void;
  /** False when the surface was restored open on load: a non-modal panel then leaves focus alone. */
  focusOnOpen?: boolean;
}

export const artifactBrowserStorage = new KeatingStorage();
