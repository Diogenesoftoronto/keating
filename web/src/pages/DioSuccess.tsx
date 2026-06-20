import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { usePostHog } from "@posthog/react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import { claimDioAccess, DIO_PROVIDER_ID, normalizeEmail } from "../dio-provider";

export function DioSuccess() {
	const posthog = usePostHog();
	const [status, setStatus] = useState<"claiming" | "success" | "error">("claiming");
	const [message, setMessage] = useState("Completing your Dio setup...");
	const attempted = useRef(false);

	useEffect(() => {
		if (attempted.current) return;
		attempted.current = true;

		const params = new URLSearchParams(window.location.search);
		const ref = params.get("dio_ref");
		const email = params.get("dio_email");

		if (!ref || !email) {
			setStatus("error");
			setMessage("Missing checkout reference or email.");
			return;
		}

		const normalized = normalizeEmail(email);
		claimDioAccess(normalized, ref)
			.then(async (result) => {
				if (result.success && result.apiKey) {
					await getAppStorage().providerKeys.set(DIO_PROVIDER_ID, result.apiKey);
					posthog.identify(normalized, { email: normalized });
					posthog.capture('dio_access_claimed', { email: normalized });
					setStatus("success");
					setMessage("Dio access is ready.");
					window.setTimeout(() => {
						window.location.href = "/chat";
					}, 1200);
				} else if (result.pending) {
					setStatus("error");
					setMessage("Payment is still being processed. Please wait a moment and refresh this page.");
				} else {
					setStatus("error");
					setMessage(result.error || "Could not complete Dio setup.");
				}
			})
			.catch((err) => {
				setStatus("error");
				setMessage(err instanceof Error ? err.message : String(err));
			});
	}, []);

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-foreground">
			<div className="w-full max-w-sm space-y-6 text-center">
				{status === "claiming" && <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />}
				{status === "success" && <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />}
				{status === "error" && <AlertCircle className="mx-auto h-10 w-10 text-destructive" />}
				<h1 className="text-xl font-semibold">Dio setup</h1>
				<p className="text-muted-foreground">{message}</p>
				{status === "error" && (
					<a
						href="/chat"
						className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>
						Return to Keating
					</a>
				)}
			</div>
		</div>
	);
}
