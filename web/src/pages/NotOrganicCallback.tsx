import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Footer } from "../components/Footer";
import { Nav } from "../components/Nav";
import { NotOrganicPublicClient, publicClientConfig, safeAuthorizationReturnTo } from "../notorganic-provider/public-client";
import { beginNotOrganicAuthorization } from "../notorganic-provider";
import { authorizePendingChatTurn, pendingChatTurn } from "../notorganic-provider/pending-chat-turn";
import "./notorganic-callback.css";

/** Completes the provider-owned redirect; it never accepts an account id from the URL. */
export function NotOrganicCallback() {
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const [retrying, setRetrying] = useState(false);
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		const config = publicClientConfig();
		if (!config) {
			setError("This Keating deployment has not enabled Not Organic sign-in.");
			return;
		}
		void new NotOrganicPublicClient(config).completeAuthorization(new URLSearchParams(window.location.search))
			.then(session => {
				authorizePendingChatTurn();
				const pending = pendingChatTurn();
				window.location.replace(pending
					? `/chat?session=${encodeURIComponent(pending.sessionId)}`
					: safeAuthorizationReturnTo(session.returnTo));
			})
			.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Not Organic sign-in could not be completed."));
	}, [navigate]);

	const retry = async () => {
		setRetrying(true);
		try {
			await beginNotOrganicAuthorization("/chat");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Sign-in could not open. Please try again.");
			setRetrying(false);
		}
	};

	return (
		<div className="retro-layout retro-page">
			<Nav />
			<main className="notorganic-callback">
				<section aria-labelledby="connection-title" aria-busy={!error || retrying}>
					{error ? <CircleAlert size={28} aria-hidden="true" className="connection-icon" /> : <LoaderCircle size={28} aria-hidden="true" className="connection-icon connection-spinner" />}
					<h1 id="connection-title" className="notorganic-callback-title">{error ? "Let’s reconnect" : "Connecting your account"}</h1>
					<p className="connection-message" role={error ? "alert" : "status"}>{error ?? "Confirming your Not Organic sign-in. You’ll return to Keating in a moment."}</p>
					{error && <div className="connection-actions">
						<button type="button" className="connection-primary" disabled={retrying} onClick={() => void retry()}>{retrying ? "Opening sign-in…" : "Try sign-in again"}</button>
						<button type="button" onClick={() => navigate({ to: "/chat" })}>Back to chat</button>
					</div>}
				</section>
			</main>
			<Footer />
		</div>
	);
}
