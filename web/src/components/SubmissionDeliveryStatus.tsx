import { KeatingGlyph } from "../design-system/glyphs";
import "./lesson/lesson.css";

/** One status line per state: saved (ok), queued (warn), failed to deliver (bad). */
export function SubmissionDeliveryStatus({ state, error, onRetry }: {
  state: "local" | "pending" | "delivered";
  error?: string;
  onRetry?: () => void;
}) {
  return <div role="status" className="submission-delivery">
    <strong className="lesson-status" data-tone="ok">{state === "delivered" ? "Delivered to course" : "Saved on this device"}</strong>
    {state === "pending" ? <>
      <p className="lesson-status" data-tone={error ? "bad" : "warn"}>{error ?? "Delivery is queued. It will retry when connected."}</p>
      {onRetry ? <button type="button" className="lesson-quiet k-bloom" onClick={onRetry}><KeatingGlyph name="refresh" size={13} />Retry delivery</button> : null}
    </> : null}
  </div>;
}
