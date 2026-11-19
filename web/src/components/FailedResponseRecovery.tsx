import { Button } from "../design-system/kit";
import { RetryResponseButton } from "./RetryResponseButton";
import { ErrorDiagnosticsActions } from "./ErrorDiagnosticsActions";

interface FailedResponseRecoveryProps {
  recovery?: string;
  onRetry?: () => void | Promise<void>;
  onModelSelect?: () => void;
  preferModel?: boolean;
  diagnosticsSummary?: string;
}

export function FailedResponseRecovery({ recovery, onRetry, onModelSelect, preferModel, diagnosticsSummary }: FailedResponseRecoveryProps) {
  const modelFirst = onModelSelect && (preferModel || !onRetry);
  return <section data-chat-recovery="" role="alert" className="turn-failure">
    <strong>This response did not finish</strong>
    <p>{recovery || (onRetry ? "Retry the same prompt without rewriting it." : "This request could not finish. Please try again.")}</p>
    <div className="turn-failure__actions">
      {onModelSelect && !modelFirst && <Button size="sm" onClick={onModelSelect}>Choose model</Button>}
      {onRetry && <RetryResponseButton onRetry={onRetry} variant={modelFirst ? "quiet" : "primary"} />}
      {modelFirst && <Button size="sm" variant="primary" onClick={onModelSelect}>Choose model</Button>}
    </div>
    {diagnosticsSummary && <ErrorDiagnosticsActions summary={diagnosticsSummary} />}
  </section>;
}
