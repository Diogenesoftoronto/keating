/** Activity log for the sandbox dialog: capped event list plus the scroll container ref. */
import { useCallback, useRef, useState } from "react";
import { uid, type PushSandboxEvent, type SandboxLogEvent } from "./sandbox-helpers";

export const MAX_SANDBOX_EVENTS = 500;

export function useSandboxActivityLog() {
  const [events, setEvents] = useState<SandboxLogEvent[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);

  const pushEvent: PushSandboxEvent = useCallback((tab, operation, ok, output, durationMs) => {
    const ev: SandboxLogEvent = { id: uid(), timestamp: Date.now(), tab, operation, ok, output, durationMs };
    setEvents((prev) => [ev, ...prev].slice(0, MAX_SANDBOX_EVENTS));
    if (logRef.current) {
      logRef.current.scrollTop = 0;
    }
  }, []);

  return { events, pushEvent, logRef };
}
