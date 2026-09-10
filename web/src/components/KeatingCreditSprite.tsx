import "./keating-credit-recovery.css";
import { useEffect, useRef, useState } from "react";

/** Authored 4-by-2 sheets; refresh loops only while a wallet request is pending. */
export function KeatingCreditSprite({ refreshing = false, ready = false, balanceMicros }: { refreshing?: boolean; ready?: boolean; balanceMicros?: number }) {
  const lastConfirmed = useRef<number | undefined>(undefined);
  const [celebration, setCelebration] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (refreshing || balanceMicros === undefined) return;
    if (ready && (lastConfirmed.current === undefined || balanceMicros > lastConfirmed.current)) {
      setCelebration(value => value + 1);
      setCelebrating(true);
    }
    lastConfirmed.current = balanceMicros;
  }, [ready, refreshing, balanceMicros]);
  const state = refreshing ? "wallet-refresh" : ready ? "credits-ready" : "insufficient-funds";
  const version = state === "insufficient-funds" ? "v2" : "v1";
  return <span key={`${state}:${celebration}`} className="keating-credit-sprite" data-state={state}
    data-animated={state !== "credits-ready" || celebrating} aria-hidden="true" onAnimationEnd={() => setCelebrating(false)}
    style={{ backgroundImage: `url("/brand/keatingbot-${state}-${version}.png")` }} />;
}
