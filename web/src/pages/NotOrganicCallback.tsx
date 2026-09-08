import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Footer } from "../components/Footer";
import { Nav } from "../components/Nav";
import { NotOrganicPublicClient, publicClientConfig, safeAuthorizationReturnTo } from "../notorganic-provider/public-client";
import { btnRetro } from "../../styled-system/recipes";

/** Completes the provider-owned redirect; it never accepts an account id from the URL. */
export function NotOrganicCallback() {
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
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
			.then(session => window.location.replace(safeAuthorizationReturnTo(session.returnTo)))
			.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Not Organic sign-in could not be completed."));
	}, [navigate]);

	return (
		<div className="retro-layout retro-page">
			<Nav />
			<main className="download-page">
				<section className="download-hero"><div className="wrap">
					<h1>{error ? "Connection not completed" : "Connecting Not Organic…"}</h1>
					<p className="download-hero-copy">{error ?? "Keating is confirming the provider-owned account connection."}</p>
					{error && <button type="button" className={btnRetro()} onClick={() => navigate({ to: "/pricing" })}>Back_to_pricing</button>}
				</div></section>
			</main>
			<Footer />
		</div>
	);
}
