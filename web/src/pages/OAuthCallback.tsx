import { useEffect, useState } from "react";
import { handleOAuthCallback, type OAuthCallbackResult } from "../keating/oauth";

export function OAuthCallback() {
	const [result, setResult] = useState<OAuthCallbackResult | null>(null);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get("code");
		const state = params.get("state");
		const error = params.get("error");
		const errorDescription = params.get("error_description");

		if (error) {
			const r: OAuthCallbackResult = {
				success: false,
				error: errorDescription ?? error,
			};
			setResult(r);
			notifyOpener(r);
			return;
		}

		if (!code) {
			const r: OAuthCallbackResult = {
				success: false,
				error: "No authorization code received.",
			};
			setResult(r);
			notifyOpener(r);
			return;
		}

		handleOAuthCallback(code, state).then((r) => {
			setResult(r);
			notifyOpener(r);
		});
	}, []);

	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<div className="max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-lg">
				{result === null ? (
					<>
						<div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
						<h2 className="text-lg font-semibold text-foreground">Signing in...</h2>
						<p className="mt-2 text-sm text-muted-foreground">Completing authentication, please wait.</p>
					</>
				) : result.success ? (
					<>
						<div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
							<svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						</div>
						<h2 className="text-lg font-semibold text-foreground">Signed in successfully</h2>
						<p className="mt-2 text-sm text-muted-foreground">
							You can close this window and return to Keating.
						</p>
					</>
				) : (
					<>
						<div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
							<svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</div>
						<h2 className="text-lg font-semibold text-foreground">Sign-in failed</h2>
						<p className="mt-2 text-sm text-destructive">{result.error}</p>
						<p className="mt-3 text-sm text-muted-foreground">
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
