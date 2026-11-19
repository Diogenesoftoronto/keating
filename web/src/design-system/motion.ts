import { useSyncExternalStore } from "react";

export const SPRING = { type: "spring", stiffness: 480, damping: 20 } as const;
export const SOFT = { type: "spring", stiffness: 260, damping: 24 } as const;
export const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
// Motion durations are in seconds.
export const DURATION = { quick: 0.16, play: 0.42, loop: 0.7 } as const;

const query = "(prefers-reduced-motion: reduce)";
export function motionAllowed(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined"
    && document.documentElement.getAttribute("data-reduce-motion") !== "true"
    && !window.matchMedia?.(query).matches;
}

const listeners = new Set<() => void>();
let disconnect: (() => void) | undefined;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!disconnect) {
    const notify = () => listeners.forEach(callback => callback());
    const media = window.matchMedia?.(query);
    const observer = new MutationObserver(notify);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
    media?.addEventListener("change", notify);
    disconnect = () => {
      observer.disconnect();
      media?.removeEventListener("change", notify);
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      disconnect?.();
      disconnect = undefined;
    }
  };
}

export function useMotionAllowed(): boolean {
  return useSyncExternalStore(subscribe, motionAllowed, () => false);
}
