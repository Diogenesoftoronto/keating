import { useState, type ReactNode } from "react";
import { Button } from "../design-system/kit";
import { isNotOrganicProvider } from "../notorganic-provider";
import { handleTutorialLinkClick, tutorialApiKeyHref } from "../lib/tutorial-links";

interface ProviderAuthRecoveryProps {
	selectedProvider?: string;
	failedProvider: string;
	recovery?: string;
	secondaryActions?: ReactNode;
	diagnostics?: ReactNode;
	onRecover(provider: string): Promise<boolean>;
}

/** Recovery retries with the selected model, which may have changed since the failure. */
export function authRecoveryProvider(selectedProvider: string | undefined, failedProvider: string): string {
	return selectedProvider?.trim() || failedProvider;
}

export function ProviderAuthRecovery({ selectedProvider, failedProvider, recovery, onRecover, secondaryActions, diagnostics }: ProviderAuthRecoveryProps) {
	const provider = authRecoveryProvider(selectedProvider, failedProvider);
	const accountSignIn = isNotOrganicProvider(provider);
	const recoveryGlyph = accountSignIn ? "signin" : "key";
	const [retrying, setRetrying] = useState(false);
	const [error, setError] = useState("");
	const recover = async () => {
		setRetrying(true);
		setError("");
		try {
			await onRecover(provider);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Sign-in could not open. Please try again.");
		} finally {
			setRetrying(false);
		}
	};

  return <section data-chat-recovery="" role="alert" className="turn-failure">
    <strong>Authentication failed</strong>
    <p>{accountSignIn ? "Sign in or sign up with Not Organic, then Keating can retry this message."
      : recovery ?? "Re-enter the provider credentials, then Keating can retry the same turn."}</p>
    <div className="turn-failure__actions">
      {!accountSignIn && <a href={tutorialApiKeyHref(provider)} target="_blank" rel="noopener noreferrer"
        onClick={event => handleTutorialLinkClick(event.nativeEvent, tutorialApiKeyHref(provider))}>Need a key?</a>}
      {secondaryActions}
      <Button size="sm" variant="primary" onClick={() => void recover()} busy={retrying} glyph={retrying ? "spin" : recoveryGlyph}>
        {accountSignIn ? "Sign in / Sign up" : "Re-enter API key"}
      </Button>
    </div>
    {error && <p role="status">{error}</p>}
    {diagnostics}
  </section>;
}
