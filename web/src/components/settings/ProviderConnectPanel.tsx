import { useEffect, useMemo, useState } from "react";
import { getModels } from "@earendil-works/pi-ai/compat";
import { Check, Search } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { getAppStorage } from "../../keating/app-storage";
import { loadOAuthCredentials, providerToOAuthId } from "../../keating/oauth";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT, type ModelPrefs } from "../../keating/model-prefs";
import { Toggle } from "../Toggle";
import { NotOrganicAccountCard } from "./NotOrganicAccountCard";
import { NOTORGANIC_PROVIDER_ID } from "../../notorganic-provider";
import { ProviderCredentialForm } from "./CloudProviderKeysSection";

const layoutClass = css({
	display: "grid",
	gap: "1rem",
	gridTemplateColumns: "1fr",
	sm: { gridTemplateColumns: "15rem 1fr", alignItems: "start" },
});
const searchWrapClass = css({
	position: "relative",
	display: "flex",
	alignItems: "center",
});
const searchIconClass = css({ position: "absolute", left: "0.625rem", color: "var(--muted-foreground)", pointerEvents: "none" });
const searchInputClass = css({
	width: "100%",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	backgroundColor: "var(--background)",
	paddingLeft: "2rem",
	paddingRight: "0.625rem",
	paddingBlock: "0.5rem",
	fontSize: "0.875rem",
	_focusVisible: { outline: "2px solid var(--primary)", outlineOffset: "1px" },
});
const listClass = css({
	display: "flex",
	flexDirection: "column",
	gap: "0.125rem",
	maxHeight: "16rem",
	overflowY: "auto",
	sm: { maxHeight: "28rem" },
});
const itemBase = css({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "0.5rem",
	width: "100%",
	textAlign: "left",
	borderRadius: "0.375rem",
	paddingInline: "0.625rem",
	paddingBlock: "0.5rem",
	fontSize: "0.875rem",
	textTransform: "capitalize",
	color: "var(--muted-foreground)",
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
});
const itemActive = css({
	backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)",
	color: "var(--primary)",
	fontWeight: 500,
});
const connectedDot = css({ display: "inline-flex", color: "var(--success, #16a34a)", flexShrink: 0 });
const detailClass = css({ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 });
const detailHeaderClass = css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" });
const detailTitleClass = css({ fontSize: "1rem", fontWeight: 600, textTransform: "capitalize", color: "var(--foreground)" });
const mutedClass = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });
const modelsBoxClass = css({
	display: "flex",
	flexDirection: "column",
	maxHeight: "14rem",
	overflowY: "auto",
	borderRadius: "0.5rem",
	border: "1px solid var(--border)",
});
const modelRowClass = css({
	display: "flex",
	justifyContent: "space-between",
	gap: "0.75rem",
	paddingInline: "0.75rem",
	paddingBlock: "0.375rem",
	fontSize: "0.8125rem",
	borderBottom: "1px solid var(--border)",
	_last: { borderBottom: "none" },
});
const emptyClass = css({ padding: "1rem", fontSize: "0.875rem", color: "var(--muted-foreground)" });

type ModelInfo = { id: string; name: string };

function modelsFor(provider: string): ModelInfo[] {
	try {
		return (getModels(provider as never) as unknown as ModelInfo[]).map((m) => ({ id: m.id, name: m.name }));
	} catch {
		return [];
	}
}

/** Providers that already hold an API key or a subscription sign-in. */
export function useConnectedProviders(providers: string[]): Set<string> {
	const [connected, setConnected] = useState<Set<string>>(new Set());
	const dep = providers.join(",");
	useEffect(() => {
		let active = true;
		const refresh = async () => {
			const storage = getAppStorage();
			const next = new Set<string>();
			await Promise.all(providers.map(async (p) => {
				try {
					if ((await storage.providerKeys.get(p))?.trim()) { next.add(p); return; }
					const oauthId = providerToOAuthId(p);
					if (oauthId && (await loadOAuthCredentials(oauthId))) next.add(p);
				} catch { /* unavailable storage just reads as not connected */ }
			}));
			if (active) setConnected(next);
		};
		void refresh();
		window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh);
		return () => { active = false; window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh); };
	}, [dep]);
	return connected;
}

/**
 * Searchable provider picker: pick a provider on the left, connect it and
 * browse its models on the right. Searching also matches model names.
 */
export function ProviderConnectPanel({ providers, modelPrefs, onToggleVisibility }: {
	providers: string[];
	modelPrefs: ModelPrefs;
	onToggleVisibility: (provider: string, hidden: boolean) => void;
}) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(providers[0] ?? "");
	const connected = useConnectedProviders(providers);
	const catalog = useMemo(() => new Map(providers.map((p) => [p, modelsFor(p)])), [providers.join(",")]);

	const q = query.trim().toLowerCase();
	const visible = useMemo(() => {
		const list = providers.filter((p) => {
			if (!q) return true;
			return p.toLowerCase().includes(q) || (catalog.get(p) ?? []).some((m) => `${m.id} ${m.name}`.toLowerCase().includes(q));
		});
		// Connected providers first, keeping the existing priority order within each group.
		return [...list.filter((p) => connected.has(p)), ...list.filter((p) => !connected.has(p))];
	}, [providers.join(","), q, catalog, connected]);

	const active = visible.includes(selected) ? selected : visible[0];
	const models = (catalog.get(active ?? "") ?? []).filter((m) => !q || active?.toLowerCase().includes(q) || `${m.id} ${m.name}`.toLowerCase().includes(q));
	const hidden = active ? modelPrefs.hiddenProviders.includes(active) : false;

	return (
		<div id="settings-section-cloud-providers" className={css({ display: "flex", flexDirection: "column", gap: "1rem", scrollMarginTop: "5rem" })}>
			<div className={searchWrapClass}>
				<Search size={14} className={searchIconClass} />
				<input
					type="search"
					className={searchInputClass}
					placeholder="Search providers or models (e.g. “claude”, “llama”)"
					aria-label="Search providers and models"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
			</div>
			<div className={layoutClass}>
				<div className={listClass} role="listbox" aria-label="Providers">
					{visible.length === 0 && <p className={emptyClass}>No provider or model matches “{query}”.</p>}
					{visible.map((p) => (
						<button
							key={p}
							type="button"
							role="option"
							aria-selected={p === active}
							className={cx(itemBase, p === active && itemActive)}
							onClick={() => setSelected(p)}
						>
							<span>{p}</span>
							{connected.has(p) && <span className={connectedDot} title="Connected"><Check size={14} /></span>}
						</button>
					))}
				</div>
				{active && (
					<div className={detailClass} key={active}>
						<div className={detailHeaderClass}>
							<div>
								<div className={detailTitleClass}>{active}</div>
								<div className={mutedClass}>{connected.has(active) ? "Connected" : "Not connected yet"}</div>
							</div>
							<label className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
								Show in model picker
								<Toggle
									tone="success"
									aria-label={`Show ${active} in model picker`}
									checked={!hidden}
									onChange={(checked) => onToggleVisibility(active, !checked)}
								/>
							</label>
						</div>
						<ProviderCredentialForm provider={active} />
						{active === NOTORGANIC_PROVIDER_ID && <NotOrganicAccountCard />}
						<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
							<div className={mutedClass}>{models.length} model{models.length === 1 ? "" : "s"}{q ? " matching" : ""}</div>
							{models.length > 0 && (
								<div className={modelsBoxClass}>
									{models.map((m) => (
										<div key={m.id} className={modelRowClass}>
											<span>{m.name}</span>
											<span className={mutedClass}>{m.id}</span>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
