import { KeatingStorage } from "../keating/storage";

export interface ArtifactBrowserSurfaceProps {
  open: boolean;
  artifactId?: string;
  onClose: () => void;
}

export const artifactBrowserStorage = new KeatingStorage();
