import { useState } from "react";
import { KeatingBot } from "./KeatingBot";
import "./app-status-screen.css";

export type AppStatus = "loading" | "404" | "403" | "500" | "offline";

export interface AppStatusScreenProps {
	status: AppStatus;
	/** User-facing copy only. Never pass exception messages or stack traces. */
	title?: string;
	description?: string;
	onRetry?: () => void;
	onBack?: () => void;
	homeHref?: string;
}

const STATUS_COPY: Record<AppStatus, { label: string; title: string; description: string }> = {
	loading: { label: "Loading", title: "Getting things ready", description: "Keating is opening your workspace." },
	"404": { label: "404 · Page not found", title: "This page isn’t here", description: "The link may have changed, or the page may no longer exist. You can head home and find your way from there." },
	"403": { label: "403 · Access unavailable", title: "This page isn’t available to you", description: "You may need a different account or permission from the person who shared this page." },
	"500": { label: "500 · Something went wrong", title: "We couldn’t open this page", description: "Something went wrong while loading. Try again, or return home." },
	offline: { label: "Connection unavailable", title: "We can’t connect right now", description: "Check your connection, then try again when you’re ready." },
};

function StatusArt({ source, animated }: { source: string; animated: boolean }) {
	const [fallback, setFallback] = useState(false);
	const [unavailable, setUnavailable] = useState(false);
	const [loaded, setLoaded] = useState(false);
	if (unavailable) return null;
	return <span className="app-status__art" aria-hidden="true">
		<img className="app-status__bot" src={fallback ? "/brand/mascot-full.avif" : source} alt="" draggable={false} onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); if (fallback) setUnavailable(true); else setFallback(true); }} />
		{animated && loaded && !fallback && <span className="app-status__screen-static" />}
	</span>;
}

/** Shared route/loading fallback. The copy stands on its own when artwork is unavailable. */
export function AppStatusScreen({ status, title, description, onRetry, onBack, homeHref = "/" }: AppStatusScreenProps) {
	const copy = STATUS_COPY[status];
	const source = `/brand/bot-status-v1/${status === "offline" ? "loading" : status}.avif`;
	const loading = status === "loading";
	return <main className="app-status" data-status={status} aria-label={copy.label}>
		<div className="app-status__content">
			{loading ? <span className="app-status__art" aria-hidden="true"><KeatingBot variant="body" state="loading" size={200} label="" /></span>
				: <StatusArt key={source} source={source} animated={false} />}
			<div className="app-status__message" role={loading ? "status" : undefined} aria-live={loading ? "polite" : undefined} aria-atomic={loading ? true : undefined}>
				<p className="app-status__label">{copy.label}</p>
				<h1>{title ?? copy.title}</h1>
				<p className="app-status__description">{description ?? copy.description}</p>
			</div>
			<nav className="app-status__actions" aria-label="Page recovery">
				{onRetry && !loading && <button type="button" className="app-status__action app-status__action--primary" onClick={onRetry}>Try again</button>}
				<a className={`app-status__action${onRetry && !loading ? "" : " app-status__action--primary"}`} href={homeHref}>Go home</a>
				{onBack && <button type="button" className="app-status__action app-status__action--quiet" onClick={onBack}>Go back</button>}
			</nav>
		</div>
	</main>;
}

export function RouteLoadingScreen(props: Omit<AppStatusScreenProps, "status">) {
	return <AppStatusScreen {...props} status="loading" />;
}

export function RouteNotFoundScreen(props: Omit<AppStatusScreenProps, "status">) {
	return <AppStatusScreen {...props} status="404" />;
}
