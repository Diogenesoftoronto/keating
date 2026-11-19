import { useEffect, useRef } from "react";
import { loadKeatingUiSettings, subscribeKeatingUiSettings } from "../../keating/ui-settings";
import type { SurfaceProps } from "./logic";
import "./shaders.css";

export function useShader(props?: SurfaceProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const effect = props?.effect, strength = props?.strength, variant = props?.variant;
  const [r, g, b] = props?.tint ?? [];
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let generation = 0;
    let cleanup: (() => void) | undefined;
    let enabled: boolean | undefined;
    let timer = 0;
    function sync(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      const current = ++generation;
      window.clearTimeout(timer);
      cleanup?.();
      cleanup = undefined;
      if (!next) return;
      timer = window.setTimeout(async () => {
        const runtime = await import("./mount").catch(() => null);
        if (current !== generation || !host || !runtime) return;
        const tint = r !== undefined && g !== undefined && b !== undefined ? [r, g, b] as const : undefined;
        cleanup = effect ? runtime.mountSurface(host, { effect, strength, tint, variant }) : runtime.mountOverlay(host);
      }, 32);
    }
    sync(loadKeatingUiSettings().visualEffects);
    const unsubscribe = subscribeKeatingUiSettings(settings => sync(settings.visualEffects));
    return () => { ++generation; window.clearTimeout(timer); unsubscribe(); cleanup?.(); };
  }, [effect, strength, variant, r, g, b]);
  return ref;
}
