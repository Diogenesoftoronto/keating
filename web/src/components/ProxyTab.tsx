import { useCallback, useEffect, useState } from "react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import { css } from "../../styled-system/css";
import { fieldInput, settingsCard } from "../../styled-system/recipes";
import { Toggle } from "./Toggle";

const stackClass = css({ display: "flex", flexDirection: "column", gap: "1rem" });
const descriptionClass = css({ fontSize: "0.875rem", color: "var(--muted-foreground)" });
const labelClass = css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" });
const fieldStackClass = css({ display: "flex", flexDirection: "column", gap: "0.25rem" });
const helpClass = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });

export function ProxyTab() {
	const [enabled, setEnabled] = useState(false);
	const [url, setUrl] = useState("http://localhost:3001");

	useEffect(() => {
		const storage = getAppStorage();
		storage.settings.get("proxy.enabled").then((v) => {
			if (typeof v === "boolean") setEnabled(v);
		});
		storage.settings.get("proxy.url").then((v) => {
			if (typeof v === "string") setUrl(v);
		});
	}, []);

	const save = useCallback((nextEnabled: boolean, nextUrl: string) => {
		const storage = getAppStorage();
		storage.settings.set("proxy.enabled", nextEnabled);
		storage.settings.set("proxy.url", nextUrl);
	}, []);

	return (
		<div className={stackClass}>
			<p className={descriptionClass}>
				Allows browser-based apps to bypass CORS restrictions when calling LLM providers. Required for Z-AI and Anthropic with OAuth token.
			</p>

			<div className={settingsCard({ tone: "subtle" })}>
				<span className={labelClass}>Use CORS Proxy</span>
				<Toggle
					checked={enabled}
					onChange={(checked) => {
						setEnabled(checked);
						save(checked, url);
					}}
				/>
			</div>

			<div className={fieldStackClass}>
				<label className={labelClass}>Proxy URL</label>
				<input
					type="text"
					className={fieldInput({ size: "wide" })}
					value={url}
					onChange={(e) => {
						setUrl(e.target.value);
						save(enabled, e.target.value);
					}}
					placeholder="http://localhost:3001"
				/>
				<p className={helpClass}>
					The proxy must forward requests to the upstream provider.
				</p>
			</div>
		</div>
	);
}
