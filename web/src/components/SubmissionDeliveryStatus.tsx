export function SubmissionDeliveryStatus({ state, error, onRetry }: {
  state: "local" | "pending" | "delivered";
  error?: string;
  onRetry?: () => void;
}) {
  return <div role="status">
    <strong>{state === "delivered" ? "Delivered to course" : "Saved on this device"}</strong>
    {state === "pending" ? <>
      <p>{error ?? "Delivery is queued. It will retry when connected."}</p>
      {onRetry ? <button type="button" onClick={onRetry}>Retry delivery</button> : null}
    </> : null}
  </div>;
}
