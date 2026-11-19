import { useShader } from "./use-shader";

export function PaperGlassOverlay() {
  return <span ref={useShader()} className="keating-fx-overlay" aria-hidden="true" />;
}

export default PaperGlassOverlay;
