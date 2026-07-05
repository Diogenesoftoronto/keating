import { useEffect, useState } from "react";
import { usePostHog } from "@posthog/react";
import { completeOAuthFromInput, type OAuthCallbackResult } from "../keating/oauth";
import { css, cx } from "../../styled-system/css";

const styles = {
	page: css({ display: "flex", minH: "100vh", alignItems: "center", justifyContent: "center", bg: "var(--background)" }),
	card: css({ maxW: "28rem", borderRadius: "0.5rem", border: "1px solid var(--border)", bg: "var(--card)", p: "2rem", textAlign: "center", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)" }),
	spinner: css({ mx: "auto", mb: "1rem", h: "2rem", w: "2rem", animation: "spin 1s linear infinite", borderRadius: "9999px", border: "2px solid var(--primary)", borderTopColor: "transparent" }),
	icon: css({ mx: "auto", mb: "1rem", display: "flex", h: "2.5rem", w: "2.5rem", alignItems: "center", justifyContent: "center", borderRadius: "9999px" }),
	successIcon: css({ bg: "color-mix(in srgb, var(--primary) 10%, transparent)", color: "var(--primary)" }),
	errorIcon: css({ bg: "color-mix(in srgb, var(--destructive) 10%, transparent)", color: "var(--destructive)" }),
	svg: css({ h: "1.5rem", w: "1.5rem" }),
	title: css({ fontSize: "1.125rem", fontWeight: "600", color: "var(--foreground)" }),
	copy: css({ mt: "0.5rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	error: css({ mt: "0.5rem", fontSize: "0.875rem", color: "var(--destructive)" }),
	copySpaced: css({ mt: "0.75rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
};

export function OAuthCallback() {
	const posthog = usePostHog();
	const [result, setResult] = useState<OAuthCallbackResult | null>(null);

	useEffect(() => {
		completeOAuthFromInput(window.location.href).then((r) => {
			setResult(r);
			posthog.capture('oauth_login_completed', { success: r.success, error: r.success ? undefined : r.error });
			notifyOpener(r);
		});
	}, [posthog]);

	return (
		<div className={styles.page}>
			<div className={styles.card}>
				{result === null ? (
					<>
						<div className={styles.spinner} />
						<h2 className={styles.title}>Signing in...</h2>
						<p className={styles.copy}>Completing authentication, please wait.</p>
					</>
				) : result.success ? (
					<>
						<div className={cx(styles.icon, styles.successIcon)}>
							<svg className={styles.svg} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						</div>
						<h2 className={styles.title}>Signed in successfully</h2>
						<p className={styles.copy}>
							You can close this window and return to Keating.
						</p>
					</>
				) : (
					<>
						<div className={cx(styles.icon, styles.errorIcon)}>
							<svg className={styles.svg} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</div>
						<h2 className={styles.title}>Sign-in failed</h2>
						<p className={styles.error}>{result.error}</p>
						<p className={styles.copySpaced}>
							You can close this window and try again.
						</p>
					</>
				)}
			</div>
		</div>
	);
}

function notifyOpener(result: OAuthCallbackResult): void {
	try {
		if (window.opener && !window.opener.closed) {
			window.opener.postMessage(
				{ type: "keating-oauth-result", ...result },
				window.location.origin,
			);
		}
	} catch {}
}
