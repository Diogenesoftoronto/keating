import { useState } from "react";
import { KeyRound, LogIn } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { primaryButton } from "../../styled-system/recipes";
import { isNotOrganicProvider } from "../notorganic-provider";
import { handleTutorialLinkClick, tutorialApiKeyHref } from "../lib/tutorial-links";
import { Spinner } from "./Spinner";

interface ProviderAuthRecoveryProps {
	selectedProvider?: string;
	failedProvider: string;
	recovery?: string;
	onRecover(provider: string): Promise<boolean>;
}

/** Recovery retries with the selected model, which may have changed since the failure. */
export function authRecoveryProvider(selectedProvider: string | undefined, failedProvider: string): string {
	return selectedProvider?.trim() || failedProvider;
}

export function ProviderAuthRecovery({ selectedProvider, failedProvider, recovery, onRecover }: ProviderAuthRecoveryProps) {
	const provider = authRecoveryProvider(selectedProvider, failedProvider);
	const accountSignIn = isNotOrganicProvider(provider);
	const RecoveryIcon = accountSignIn ? LogIn : KeyRound;
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

	return <div role="alert" className={css({ marginBlock: "0.5rem", borderRadius: "0.5rem", border: "1px solid color-mix(in srgb, var(--destructive) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)", padding: "0.75rem", fontSize: "0.875rem" })}>
		<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem" })}>
			<RecoveryIcon size={16} aria-hidden="true" className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--destructive)" })} />
			<div className={css({ minWidth: 0, flex: 1 })}>
				<p className={css({ marginBottom: "0.25rem", fontWeight: 500, color: "var(--destructive)" })}>Authentication failed</p>
				<p className={css({ marginBottom: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{accountSignIn
					? "Sign in or sign up with Not Organic, then Keating can retry this message."
					: recovery ?? "Re-enter the provider credentials, then Keating can retry the same turn."}</p>
				<button type="button" onClick={() => void recover()} disabled={retrying} className={cx(primaryButton(), css({ display: "inline-flex", alignItems: "center", gap: "0.375rem", minHeight: "2.75rem", paddingInline: "0.75rem", fontSize: "0.75rem" }))}>
					{retrying ? <Spinner size={12} /> : <RecoveryIcon size={12} aria-hidden="true" />}
					{accountSignIn ? "Sign in / Sign up" : "Re-enter API key"}
				</button>
				{!accountSignIn && <a href={tutorialApiKeyHref(provider)} target="_blank" rel="noopener noreferrer"
					onClick={event => handleTutorialLinkClick(event.nativeEvent, tutorialApiKeyHref(provider))}
					className={css({ marginLeft: "0.5rem", display: "inline-flex", alignItems: "center", fontSize: "0.75rem", color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "2px" })}>Need a key?</a>}
				{error && <p className={css({ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--destructive)" })}>{error}</p>}
			</div>
		</div>
	</div>;
}
