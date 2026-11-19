import type { SurfaceProps } from "./logic";
import { useShader } from "./use-shader";

export function ShaderSurface(props: SurfaceProps) {
  return <span ref={useShader(props)} className={["keating-fx-surface", props.className].filter(Boolean).join(" ")} aria-hidden="true" />;
}
