import {
	displayModelProvider,
	requiresProviderCredential,
} from "../../lib/model-catalog";
import type { KeatingCustomProvider } from "../../lib/provider-models";
import { useImageAccess } from "./models/image-access";
import { getNotOrganicAccount } from "../../notorganic-provider";
import { extractNotOrganicProfile } from "../../notorganic-provider/profile";
import {
	DESKTOP_OFFLINE_MODELS,
	desktopOfflineBridge,
} from "../../lib/desktop-offline";
import { formatBytes } from "../../lib/model-download-progress";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	getCloudProviderModels,
	refreshCloudModelCatalog,
} from "../../lib/models-dev-catalog";
import { KeatingGlyph } from "../../design-system/glyphs";
import {
	Button,
	EmptyState,
	Loading,
	SearchField,
	Switch,
} from "../../design-system/kit";
import { StatusLine } from "./ui";
import { openModelSection } from "./models/model-choices";
import { getAppStorage } from "../../keating/app-storage";
import { loadOAuthCredentials, providerToOAuthId } from "../../keating/oauth";
import {
	PROVIDER_CREDENTIALS_CHANGED_EVENT,
	type ModelPrefs,
} from "../../keating/model-prefs";
import {
	NOTORGANIC_PROVIDER_ID,
	NOTORGANIC_CHAT_MODELS,
	isNotOrganicFeatureEnabled,
	notOrganicPublicClient,
} from "../../notorganic-provider";
import { readConnectedProviders } from "../../lib/provider-connection";
import { ProviderCredentialForm } from "./CloudProviderKeysSection";

type ModelInfo = { id: string; name: string };

export function modelsFor(provider: string): ModelInfo[] {
	if (provider === NOTORGANIC_PROVIDER_ID) {
		return isNotOrganicFeatureEnabled()
			? NOTORGANIC_CHAT_MODELS.map(({ id, name }) => ({ id, name }))
			: [];
	}
	try {
		return getCloudProviderModels(provider).map((m) => ({
			id: m.id,
			name: m.name,
		}));
	} catch {
		return [];
	}
}

/** Providers that already hold an API key or a subscription sign-in. */
export function useProviderConnectionState(providers: string[]) {
	const [connected, setConnected] = useState<Set<string>>(new Set());
	const [checked, setChecked] = useState(false);
	const [endings, setEndings] = useState<Record<string, string>>({});
	const dep = providers.join(",");
	useEffect(() => {
		let active = true;
		let refreshVersion = 0;
		const refresh = async () => {
			const version = ++refreshVersion;
			setChecked(false);
			setConnected(new Set());
			const suffixes: Record<string, string> = {};
			const next = await readConnectedProviders(
				providers,
				{
					hostedSession: async () =>
						(await notOrganicPublicClient()?.activeSession()) ?? null,
					apiKey: async (provider) => {
						const key = await getAppStorage().providerKeys.get(provider);
						if (key)
							suffixes[provider] = key.length > 4 ? key.slice(-4) : "••••";
						return key;
					},
					oauth: async (provider) => {
						const oauthId = providerToOAuthId(provider);
						return oauthId ? await loadOAuthCredentials(oauthId) : null;
					},
				},
				(partial) => {
					if (active && version === refreshVersion) setConnected(partial);
				},
			);
			if (active && version === refreshVersion) {
				setConnected(next);
				setEndings(suffixes);
				setChecked(true);
			}
		};
		void refresh();
		window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh);
		return () => {
			active = false;
			window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh);
		};
	}, [dep]);
	return { connected, checked, endings };
}

export function useConnectedProviders(providers: string[]): Set<string> {
	return useProviderConnectionState(providers).connected;
}

/**
 * Searchable provider picker: pick a provider on the left, connect it and
 * browse its models on the right. Searching also matches model names.
 */
export function ProviderConnectPanel({
	providers,
	modelPrefs,
	customProviders,
	onToggleVisibility,
}: {
	providers: string[];
	modelPrefs: ModelPrefs;
	customProviders: KeatingCustomProvider[];
	onToggleVisibility: (provider: string, hidden: boolean) => void;
}) {
	const { generator, ready } = useImageAccess();
	const [accountName, setAccountName] = useState("");
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState("");
	const { connected, checked, endings } = useProviderConnectionState(providers);
	const [verified, setVerified] = useState<Record<string, string | undefined>>(
		{},
	);
	useEffect(() => {
		const invalidate = () => setVerified({});
		window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, invalidate);
		return () =>
			window.removeEventListener(
				PROVIDER_CREDENTIALS_CHANGED_EVENT,
				invalidate,
			);
	}, []);
	const reportKey = useCallback(
		(p: string, status: string | undefined) =>
			setVerified((prev) =>
				prev[p] === status ? prev : { ...prev, [p]: status },
			),
		[],
	);
	const [offline, setOffline] = useState<
		{ id: string; name: string; bytes: number }[]
	>([]);
	useEffect(() => {
		const bridge = desktopOfflineBridge();
		if (!bridge) return;
		let active = true;
		const refresh = async () => {
			const items = await Promise.all(
				DESKTOP_OFFLINE_MODELS.filter(
					(m, i) => i === 0 || bridge.supportedModels?.includes(m.id),
				).map(async (m) => {
					const status = await bridge.status(m.id).catch(() => undefined);
					return status?.available && status.installed
						? {
								id: m.id,
								name: m.name,
								bytes: status.totalBytes || status.downloadedBytes,
							}
						: undefined;
				}),
			);
			if (active)
				setOffline(items.filter((m): m is NonNullable<typeof m> => !!m));
		};
		void refresh();
		const timer = setInterval(refresh, 2500);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, []);
	const [catalogRevision, setCatalogRevision] = useState(0);
	useEffect(() => {
		let active = true;
		const refresh = () => {
			void refreshCloudModelCatalog().then(() => {
				if (active) setCatalogRevision((value) => value + 1);
			});
		};
		refresh();
		window.addEventListener("focus", refresh);
		return () => {
			active = false;
			window.removeEventListener("focus", refresh);
		};
	}, []);
	const catalog = useMemo(
		() =>
			new Map(
				providers.map((p) => {
					const custom = customProviders.find((item) => item.name === p);
					const entries = [
						...modelsFor(p),
						...(custom?.models ?? []).map((m) => ({
							id: m.id,
							name: m.name || m.id,
						})),
						...modelPrefs.customModels
							.filter((m) => m.provider === p)
							.map((m) => ({ id: m.id, name: m.name })),
					];
					return [
						p,
						Array.from(new Map(entries.map((m) => [m.id, m])).values()),
					];
				}),
			),
		[
			providers.join(","),
			catalogRevision,
			customProviders,
			modelPrefs.customModels,
		],
	);

	const q = query.trim().toLowerCase();
	const visible = useMemo(() => {
		const list = providers.filter((p) => {
			if (!q) return true;
			return (
				p.toLowerCase().includes(q) ||
				(catalog.get(p) ?? []).some((m) =>
					`${m.id} ${m.name}`.toLowerCase().includes(q),
				)
			);
		});
		// Connected providers first, keeping the existing priority order within each group.
		return [
			...list.filter((p) => connected.has(p)),
			...list.filter((p) => !connected.has(p)),
		];
	}, [providers.join(","), q, catalog, connected]);

	const visibleOffline = offline.filter((m) =>
		(m.name + " " + m.id + " on this device").toLowerCase().includes(q),
	);
	const hostedConnected = connected.has(NOTORGANIC_PROVIDER_ID);
	useEffect(() => {
		let active = true;
		setAccountName("");
		if (hostedConnected)
			void getNotOrganicAccount()
				.then((account) => {
					if (active)
						setAccountName(
							extractNotOrganicProfile(account).name ??
								account.did ??
								account.id,
						);
				})
				.catch(() => {});
		return () => {
			active = false;
		};
	}, [hostedConnected]);
	const firstBroken =
		visible.find((p) => verified[p] === "invalid" && endings[p]) ??
		(ready === false && !generator?.needsBaseUrl
			? generator?.providerKey
			: undefined);
	return (
		<div id="settings-section-cloud-providers" className="s2-pane">
			<div data-glyph-host>
				<SearchField
					label="Search providers and models"
					value={query}
					onChange={setQuery}
					placeholder="Search providers or models (e.g. “claude”, “llama”)"
				/>
			</div>
			{!visibleOffline.length && visible.length === 0 && (
				<EmptyState
					heading={`No provider or model matches “${query}”.`}
					glyph="search"
				/>
			)}
			{!checked && (
				<Loading size="inline" label="Checking provider connections" />
			)}
			<div
				className="s2-list s2-provider-list"
				role="region"
				aria-label="Providers"
				tabIndex={0}
			>
				{visibleOffline.map((m) => (
					<div key={m.id} className="s2-provider" data-glyph-host>
						<KeatingGlyph name="chip" size={16} />
						<div>
							<strong>{m.name}</strong>
							<p>On this device · {formatBytes(m.bytes)}</p>
						</div>
						<StatusLine tone="ok">Ready offline</StatusLine>
						<Button variant="ghost" onClick={() => openModelSection("offline")}>
							Manage
						</Button>
					</div>
				))}
				{visible.map((p) => {
					const hosted = p === NOTORGANIC_PROVIDER_ID;
					const subscription = !!providerToOAuthId(p);
					const custom = customProviders.find((c) => c.name === p);
					const status =
						checked && custom && !requiresProviderCredential(p) && !endings[p]
							? "Not verified"
							: providerStatus({
									checked,
									connected: connected.has(p),
									keyed: !!endings[p],
									subscription: subscription || hosted,
									verification: verified[p],
								});
					const matches = (catalog.get(p) ?? []).filter(
						(m) =>
							!q ||
							p.toLowerCase().includes(q) ||
							(m.name + " " + m.id).toLowerCase().includes(q),
					);
					return (
						<div key={p}>
							<div className="s2-provider" data-glyph-host>
								<KeatingGlyph name="server" size={16} />
								<div>
									<strong>
										{hosted ? "Keating (Not Organic)" : displayModelProvider(p)}
									</strong>
									<p>
										{hosted
											? accountName
												? "Hosted · signed in as " + accountName
												: "Hosted · Not Organic account"
											: endings[p]
												? "Your key ending in " + endings[p]
												: custom
													? "Your endpoint · " + custom.type
													: subscription
														? "Subscription sign-in"
														: "Provider API key"}
									</p>
								</div>
								{
									<StatusLine
										tone={
											status === "Key rejected"
												? "bad"
												: status === "Needs a key"
													? "warn"
													: ["Connected", "Key works"].includes(status)
														? "ok"
														: "idle"
										}
									>
										{status}
									</StatusLine>
								}
								<Button
									aria-label={(firstBroken === p ? "Fix " : "Manage ") + p}
									aria-expanded={selected === p}
									variant={firstBroken === p ? "primary" : "ghost"}
									onClick={() => setSelected(selected === p ? "" : p)}
								>
									{firstBroken === p ? "Fix" : "Manage"}
								</Button>
							</div>
							{selected === p && (
								<div className="s2-editor">
									<Switch
										label="Show in model picker"
										checked={!modelPrefs.hiddenProviders.includes(p)}
										onChange={(show) => onToggleVisibility(p, !show)}
									/>
									{hosted ? (
										<Button onClick={() => openModelSection("account")}>
											Your account
										</Button>
									) : (
										<ProviderCredentialForm
											provider={p}
											reportKey={reportKey}
										/>
									)}
									<details>
										<summary>
											{matches.length} model{matches.length === 1 ? "" : "s"}
											{q ? " matching" : ""}
										</summary>
										<ul className="s2-model-catalog">
											{matches.map((m) => (
												<li key={m.id}>
													{m.name}
													<small>{m.id}</small>
												</li>
											))}
										</ul>
									</details>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

export function providerStatus({
	checked,
	connected,
	keyed,
	subscription,
	verification,
}: {
	checked: boolean;
	connected: boolean;
	keyed: boolean;
	subscription: boolean;
	verification?: string;
}) {
	if (!checked) return "Checking";
	if (keyed)
		return (
			(
				{
					ok: "Key works",
					checking: "Checking",
					invalid: "Key rejected",
					error: "Couldn't verify",
				} as Record<string, string>
			)[verification ?? ""] ?? "Not verified"
		);
	if (connected) return "Connected";
	return subscription ? "Not connected yet" : "Needs a key";
}
