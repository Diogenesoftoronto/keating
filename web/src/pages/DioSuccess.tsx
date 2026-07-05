import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { usePostHog } from "@posthog/react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import { claimDioAccess, DIO_PROVIDER_ID, normalizeEmail, rememberDioIdentity } from "../dio-provider";
import { css, cx } from "../../styled-system/css";

const styles = {
	page: css({ display: "flex", minH: "100vh", flexDir: "column", alignItems: "center", justifyContent: "center", bg: "var(--background)", p: "1.5rem", color: "var(--foreground)" }),
	card: css({ w: "100%", maxW: "24rem", textAlign: "center", "& > * + *": { mt: "1.5rem" } }),
	icon: css({ mx: "auto", h: "2.5rem", w: "2.5rem" }),
	spinning: css({ animation: "spin 1s linear infinite" }),
	primary: css({ color: "var(--primary)" }),
	success: css({ color: "#22c55e" }),
	error: css({ color: "var(--destructive)" }),
	title: css({ fontSize: "1.25rem", fontWeight: "600" }),
	message: css({ color: "var(--muted-foreground)" }),
	link: css({ display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", bg: "var(--primary)", px: "1rem", py: "0.5rem", fontSize: "0.875rem", fontWeight: "500", color: "var(--primary-foreground)", _hover: { bg: "color-mix(in srgb, var(--primary) 90%, transparent)" } }),
};

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
					await rememberDioIdentity(normalized);
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
	}, [posthog]);

	return (
		<div className={styles.page}>
			<div className={styles.card}>
				{status === "claiming" && <Loader2 className={cx(styles.icon, styles.spinning, styles.primary)} />}
				{status === "success" && <CheckCircle2 className={cx(styles.icon, styles.success)} />}
				{status === "error" && <AlertCircle className={cx(styles.icon, styles.error)} />}
				<h1 className={styles.title}>Dio setup</h1>
				<p className={styles.message}>{message}</p>
				{status === "error" && (
					<a
						href="/chat"
						className={styles.link}
					>
						Return to Keating
					</a>
				)}
			</div>
		</div>
	);
}
