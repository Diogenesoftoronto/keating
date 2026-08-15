import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { getProviders, type Api, type Model } from "@earendil-works/pi-ai/compat";
import {
	localModel,
	BROWSER_MODELS,
	DEFAULT_BROWSER_MODEL_ID,
	getBrowserModel,
	type LocalModel,
} from "../stores/local-model";
import { getSelectableModels, buildSavedModel } from "../lib/provider-models";
import { searchFullText } from "../lib/full-text-search";
import type { ImageGeneratorOption } from "../lib/image-generators";
import type { SpeechProviderDescriptor } from "../keating/speech";
import { addRecentModel, getRecentModels } from "../keating/ui-settings";
import { loadModelPrefs } from "../keating/model-prefs";
import {
	CHAT_CAPABILITY_FILTERS,
	modelCapabilityBadges,
	modelHasCapabilities,
	type ChatCapabilityFilter,
} from "../keating/model-capabilities";
import { MultiSelectDropdown } from "./MultiSelectDropdown";
import { ModelCacheControls, ModelDownloadBar } from "./ModelDownloadBar";
import { refreshCachedModelSizes, useCachedModelSize } from "../hooks/useCachedModelSize";
import { css } from "../../styled-system/css";

function makeBrowserModels(): Model<Api>[] {
	return BROWSER_MODELS.map((spec) => ({
		id: spec.id,
		name: spec.name,
		api: "browser" as Api,
		provider: "browser",
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 0,
		maxTokens: 0,
	}));
}

function defaultBrowserModel(): Model<Api> {
	const models = makeBrowserModels();
	return models.find((model) => model.id === DEFAULT_BROWSER_MODEL_ID) ?? models[0];
}

type SelectableModel = {
	key: string;
	model: Model<Api>;
	group: "recent" | "browser" | "cloud" | "custom";
};

interface ModelCatalogState {
	models: SelectableModel[];
	status: "loading" | "ready" | "error";
	error: string;
	webGpuAvailable: boolean;
}

type ModelCatalogAction =
	| { type: "loading" }
	| { type: "ready"; models: SelectableModel[]; webGpuAvailable: boolean }
	| { type: "error"; message: string; fallbackModels: SelectableModel[]; webGpuAvailable: boolean };

const INITIAL_CATALOG: ModelCatalogState = {
	models: [],
	status: "loading",
	error: "",
	webGpuAvailable: false,
};

function modelCatalogReducer(state: ModelCatalogState, action: ModelCatalogAction): ModelCatalogState {
	switch (action.type) {
		case "loading":
			return { ...state, status: "loading", error: "" };
		case "ready":
			return { models: action.models, status: "ready", error: "", webGpuAvailable: action.webGpuAvailable };
		case "error":
			return {
				models: action.fallbackModels,
				status: "error",
				error: action.message,
				webGpuAvailable: action.webGpuAvailable,
			};
	}
}

function modelKey(model: Model<any>): string {
	return `${model.provider}::${model.api}::${model.id}`;
}

async function checkWebGpu(): Promise<boolean> {
	if (!navigator.gpu) return false;
	try {
		return (await navigator.gpu.requestAdapter()) !== null;
	} catch {
		return false;
	}
}

async function discoverModels(webGpuAvailable: boolean): Promise<SelectableModel[]> {
	const modelPrefs = loadModelPrefs();
	const hidden = new Set(modelPrefs.hiddenProviders);
	const all = await getSelectableModels((provider) => !hidden.has(provider));

	for (const saved of modelPrefs.customModels) {
		all.push(buildSavedModel(saved));
	}

	const knownProviders = new Set<string>(getProviders());
	const selectable: SelectableModel[] = all.map((model) => ({
		key: modelKey(model),
		model,
		group:
			model.provider === "browser"
				? "browser"
				: knownProviders.has(model.provider)
					? "cloud"
					: "custom",
	}));

	if (webGpuAvailable) {
		selectable.unshift(
			...makeBrowserModels().map((model) => ({
				key: modelKey(model),
				model,
				group: "browser" as const,
			})),
		);
	}

	return Array.from(new Map(selectable.map((entry) => [entry.key, entry])).values());
}

export interface ModelSelectorDialogProps {
	open: boolean;
	currentModel: Model<Api> | null;
	onClose: () => void;
	onSelect: (model: Model<Api>) => void;
}

export function ModelSelectorDialog({ open, currentModel, onClose, onSelect }: ModelSelectorDialogProps) {
	const [catalog, dispatchCatalog] = useReducer(modelCatalogReducer, INITIAL_CATALOG);
	const [search, setSearch] = useState("");
	const [providerFilters, setProviderFilters] = useState<string[]>([]);
	const [capabilityFilters, setCapabilityFilters] = useState<ChatCapabilityFilter[]>([]);
	const [selectedKey, setSelectedKey] = useState(currentModel ? modelKey(currentModel) : modelKey(defaultBrowserModel()));
	const [localState, setLocalState] = useState<LocalModel | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const loadRequestRef = useRef(0);
	const { models, status, error, webGpuAvailable } = catalog;
	const loading = status === "loading";

	const refreshModels = useCallback(async () => {
		const requestId = ++loadRequestRef.current;
		dispatchCatalog({ type: "loading" });
		const browserAvailable = await checkWebGpu();
		try {
			const nextModels = await discoverModels(browserAvailable);
			if (requestId !== loadRequestRef.current) return;
			dispatchCatalog({ type: "ready", models: nextModels, webGpuAvailable: browserAvailable });
		} catch (err) {
			if (requestId !== loadRequestRef.current) return;
			const fallbackModels = browserAvailable
				? makeBrowserModels().map((model) => ({
						key: modelKey(model),
						model,
						group: "browser" as const,
					}))
				: [];
			dispatchCatalog({
				type: "error",
				message: err instanceof Error ? err.message : String(err),
				fallbackModels,
				webGpuAvailable: browserAvailable,
			});
		}
	}, []);

	useEffect(() => {
		if (!open) {
			loadRequestRef.current += 1;
			return;
		}
		setSearch("");
		setProviderFilters([]);
		setCapabilityFilters([]);
		setSelectedKey(currentModel ? modelKey(currentModel) : modelKey(defaultBrowserModel()));
		const unsub = localModel.subscribe(setLocalState);
		void refreshModels();
		const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 50);
		return () => {
			loadRequestRef.current += 1;
			window.clearTimeout(focusTimer);
			unsub();
		};
	}, [open, currentModel, refreshModels]);

	const filtered = useMemo(() => {
		const eligible = models.filter(({ model }) => {
			if (providerFilters.length > 0 && !providerFilters.includes(model.provider)) return false;
			if (!modelHasCapabilities(model, capabilityFilters)) return false;
			return true;
		});
		return searchFullText(eligible, search, ({ model, group }) => [
			model.name,
			model.id,
			model.provider,
			model.api,
			group,
		]);
	}, [search, providerFilters, capabilityFilters, models]);

	const providerOptions = useMemo(
		() =>
			Array.from(new Set(models.map(({ model }) => model.provider))).sort((left, right) =>
				left.localeCompare(right),
			),
		[models],
	);

	const recentKeys = useMemo(
		() => new Set(search.trim() === "" ? getRecentModels().map((m) => m.key) : []),
		[search],
	);

	const recentModels = filtered.filter((e) => recentKeys.has(e.key));
	const browserModels = filtered.filter((e) => e.group === "browser" && !recentKeys.has(e.key));
	const cloudModels = filtered.filter((e) => e.group === "cloud" && !recentKeys.has(e.key));
	const customModels = filtered.filter((e) => e.group === "custom" && !recentKeys.has(e.key));

	const handleSelect = async () => {
		const selected = models.find((e) => e.key === selectedKey)?.model;
		if (!selected) return;
		if (selected.provider === "browser" && localModel.getState().modelId !== selected.id) {
			await localModel.load(selected.id);
			if (!localModel.getState().loaded) return;
		}
		addRecentModel(modelKey(selected));
		onSelect(selected);
		setSearch("");
	};

	if (!open) return null;

	return (
		<div
			className={css({
				position: "fixed",
				inset: 0,
				zIndex: 1000,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "rgba(0, 0, 0, 0.6)",
				paddingInline: { base: "0.75rem", sm: "1rem" },
				fontFamily: "monospace",
			})}
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-modal="true"
				className={css({
					display: "flex",
					width: "min(720px, 96vw)",
					height: "min(44rem, 85vh)",
					maxHeight: { base: "92vh", sm: "85vh" },
					minHeight: 0,
					flexDirection: "column",
					overflow: "clip",
					borderRadius: "0.5rem",
					border: "2px solid var(--border)",
					background: "var(--background)",
				})}
				onClick={(e) => e.stopPropagation()}
			>
				<div className={css({ flexShrink: 0, borderBottom: "1px solid var(--border)", padding: { base: "0.75rem", sm: "1rem" } })}>
					<div>
						<h2 className={css({ fontSize: { base: "0.875rem", sm: "1rem" }, fontWeight: 600, color: "var(--foreground)" })}>Select Model</h2>
						<p className={css({ marginTop: "0.125rem", fontSize: { base: "0.6875rem", sm: "0.75rem" }, color: "var(--muted-foreground)" })}>Built-in providers and discovered custom-provider models.</p>
					</div>
					<div
						className={css({
							marginTop: { base: "0.5rem", sm: "0.75rem" },
							display: "grid",
							gap: "0.5rem",
							sm: { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto" },
							lg: { gridTemplateColumns: "minmax(0, 1.5fr) minmax(7.5rem, 0.75fr) minmax(7.5rem, 0.75fr) auto" },
						})}
					>
						<label className={css({ minWidth: 0, sm: { gridColumn: "1 / -1" }, lg: { gridColumn: "auto" } })}>
							<span className={css({ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", borderWidth: 0 })}>Search models</span>
							<div className={css({ position: "relative" })}>
								<Search
									size={15}
									aria-hidden="true"
									className={css({
										position: "absolute",
										left: "0.625rem",
										top: "50%",
										transform: "translateY(-50%)",
										color: "var(--muted-foreground)",
										pointerEvents: "none",
									})}
								/>
								<input
									ref={inputRef}
									type="search"
									placeholder="Search by model, ID, or provider"
									className={css({
										width: "100%",
										minHeight: "2.25rem",
										borderRadius: "0.375rem",
										border: "2px solid var(--border)",
										background: "var(--background)",
										paddingBlock: "0.375rem",
										paddingLeft: "2rem",
										paddingRight: search ? "2rem" : "0.625rem",
										fontSize: { base: "0.75rem", sm: "0.875rem" },
									})}
									value={search}
									onChange={(e) => setSearch(e.target.value)}
								/>
								{search && (
									<button
										type="button"
										aria-label="Clear model search"
										onClick={() => {
											setSearch("");
											inputRef.current?.focus();
										}}
										className={css({
											position: "absolute",
											right: "0.375rem",
											top: "50%",
											display: "inline-flex",
											height: "1.5rem",
											width: "1.5rem",
											transform: "translateY(-50%)",
											alignItems: "center",
											justifyContent: "center",
											borderRadius: "0.25rem",
											color: "var(--muted-foreground)",
											_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
										})}
									>
										<X size={13} />
									</button>
								)}
							</div>
						</label>
						<MultiSelectDropdown
							label="Filter by provider"
							allLabel="All providers"
							options={providerOptions.map((provider) => ({ value: provider, label: provider }))}
							selected={providerFilters}
							onChange={setProviderFilters}
						/>
						<MultiSelectDropdown
							label="Filter by capability"
							allLabel="All capabilities"
							options={CHAT_CAPABILITY_FILTERS}
							selected={capabilityFilters}
							onChange={setCapabilityFilters}
						/>
						<button
							onClick={() => void refreshModels()}
							className={css({
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								gap: "0.25rem",
								borderRadius: "0.375rem",
								border: "2px solid var(--border)",
								padding: "0.375rem 0.625rem",
								fontSize: { base: "0.75rem", sm: "0.875rem" },
								transition: "color 150ms, background-color 150ms",
								_hover: { background: "var(--ink)", color: "var(--paper)" },
							})}
						>
							<RefreshCw size={13} />
							Refresh
							</button>
					</div>
				</div>

				<div className={css({ margin: "0.25rem", minHeight: 0, flex: 1, overflowX: "hidden", overflowY: "auto", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)" })}>
					{loading ? (
						<div className={css({ padding: { base: "0.75rem", sm: "1rem" }, textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>Loading models…</div>
						) : error ? (
						<div className={css({ padding: { base: "0.75rem", sm: "1rem" }, textAlign: "center", fontSize: "0.875rem", color: "var(--destructive)" })}>{error}</div>
					) : filtered.length === 0 ? (
						<div className={css({ padding: { base: "0.75rem", sm: "1rem" }, textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>No models matched the current search.</div>
					) : (
						<>
							{renderGroup("Recent", recentModels, selectedKey, setSelectedKey, localState, webGpuAvailable)}
							{renderGroup("Browser", browserModels, selectedKey, setSelectedKey, localState, webGpuAvailable)}
							{renderGroup("Cloud", cloudModels, selectedKey, setSelectedKey, localState, webGpuAvailable)}
							{renderGroup("Custom Providers", customModels, selectedKey, setSelectedKey, localState, webGpuAvailable)}
						</>
					)}
				</div>

				<div className={css({ display: "flex", flexShrink: 0, justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px solid var(--border)", padding: { base: "0.75rem", sm: "1rem" } })}>
					<button
						onClick={onClose}
						className={css({
							borderRadius: "0.375rem",
							border: "2px solid var(--border)",
							paddingInline: { base: "0.75rem", sm: "1rem" },
							paddingBlock: { base: "0.375rem", sm: "0.5rem" },
							fontSize: { base: "0.75rem", sm: "0.875rem" },
							transition: "color 150ms, background-color 150ms",
							_hover: { background: "var(--ink)", color: "var(--paper)" },
						})}
					>
						Cancel
					</button>
					<button
						onClick={handleSelect}
						className={css({
							borderRadius: "0.375rem",
							border: "2px solid var(--primary)",
							background: "var(--primary)",
							paddingInline: { base: "0.75rem", sm: "1rem" },
							paddingBlock: { base: "0.375rem", sm: "0.5rem" },
							fontSize: { base: "0.75rem", sm: "0.875rem" },
							color: "var(--primary-foreground)",
							transition: "color 150ms, background-color 150ms",
							_hover: { background: "color-mix(in srgb, var(--primary) 90%, black)" },
						})}
					>
						Use Selected Model
					</button>
				</div>
			</div>
		</div>
	);
}

function renderGroup(
	title: string,
	models: SelectableModel[],
	selectedKey: string,
	onSelect: (key: string) => void,
	localState: LocalModel | null,
	webGpuAvailable: boolean,
) {
	if (models.length === 0) return null;
	return (
		<div>
			<div className={css({
				position: "sticky",
				top: 0,
				zIndex: 10,
				borderBlock: "1px solid var(--border)",
				background: "color-mix(in srgb, var(--muted) 80%, transparent)",
				paddingInline: { base: "0.75rem", sm: "1rem" },
				paddingBlock: "0.25rem",
				fontSize: "0.625rem",
				fontWeight: 600,
				letterSpacing: "0.05em",
				textTransform: "uppercase",
				color: "var(--muted-foreground)",
				backdropFilter: "blur(8px)",
			})}>
				{title}
			</div>
			{models.map((entry) => (
				<ModelOption
					key={entry.key}
					entry={entry}
					isSelected={selectedKey === entry.key}
					onClick={() => onSelect(entry.key)}
					localState={localState}
					webGpuAvailable={webGpuAvailable}
				/>
			))}
		</div>
	);
}

function ModelOption({
	entry,
	isSelected,
	onClick,
	localState,
	webGpuAvailable,
}: {
	entry: SelectableModel;
	isSelected: boolean;
	onClick: () => void;
	localState: LocalModel | null;
	webGpuAvailable: boolean;
}) {
	const { model, key } = entry;
	const isBrowser = model.provider === "browser";
	const disabled = isBrowser && !webGpuAvailable;

	const badges = [
		isBrowser ? "WebGPU" : "",
		entry.group === "cloud" ? "Cloud" : "",
		entry.group === "custom" ? "Custom" : "",
		...modelCapabilityBadges(model),
	].filter(Boolean);

	// The store holds one model at a time, so every status below is scoped to the
	// row whose id it actually refers to.
	const isActive = isBrowser && localState?.modelId === model.id;
	const spec = isBrowser ? getBrowserModel(model.id) : undefined;
	const cached = useCachedModelSize(model.id, isBrowser);
	const justLoaded = Boolean(isActive && localState?.loaded);

	// A finished download changes what is on disk, so the size shown alongside
	// the delete control has to be re-read.
	useEffect(() => {
		if (justLoaded) refreshCachedModelSizes();
	}, [justLoaded]);

	const status = (): string => {
		if (!isBrowser) return "";
		if (!webGpuAvailable) return "WebGPU not available";
		// The loading case renders ModelDownloadBar instead of a status line.
		if (isActive && localState?.loaded) return "Model ready";
		if (isActive && localState?.error) return localState.error;
		return `Downloads on demand — ${spec?.downloadLabel ?? "size unknown"}`;
	};

	return (
		<div
			className={css({
				display: "flex",
				alignItems: "flex-start",
				gap: { base: "0.625rem", sm: "0.75rem" },
				borderBottom: "1px solid var(--border)",
				background: isSelected ? "color-mix(in srgb, var(--primary) 5%, transparent)" : undefined,
				paddingInline: { base: "0.75rem", sm: "1rem" },
				paddingBlock: { base: "0.5rem", sm: "0.75rem" },
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.45 : undefined,
				transition: "color 150ms, background-color 150ms",
				_hover: disabled ? undefined : { background: "color-mix(in srgb, var(--accent) 30%, transparent)" },
			})}
			onClick={() => {
				if (!disabled) onClick();
			}}
		>
			<input
				type="radio"
				name="model"
				checked={isSelected}
				readOnly
				disabled={disabled}
				className={css({ marginTop: { base: "0.125rem", sm: "0.25rem" }, flexShrink: 0 })}
			/>
			<div className={css({ minWidth: 0, flex: 1 })}>
				<div className={css({ fontSize: "0.875rem", fontWeight: 700, lineHeight: 1.25 })}>{model.name}</div>
				<div className={css({ marginTop: "0.125rem", fontSize: { base: "0.6875rem", sm: "0.75rem" }, color: "var(--muted-foreground)" })}>
					{isBrowser ? spec?.blurb ?? "Runs in this browser" : `Provider: ${model.provider}`}
				</div>
				<div className={css({ fontSize: { base: "0.6875rem", sm: "0.75rem" }, color: "var(--muted-foreground)" })}>{model.id}</div>
				{badges.length > 0 && (
					<div className={css({ marginTop: "0.375rem", display: "flex", flexWrap: "wrap", gap: "0.25rem" })}>
						{badges.map((b) => (
							<span key={b} className={css({ display: "inline-flex", borderRadius: "9999px", background: "var(--muted)", padding: "0.125rem 0.5rem", fontSize: "0.625rem", fontWeight: 600, color: "var(--muted-foreground)" })}>
								{b}
							</span>
							))}
						</div>
					)}
					{isActive && localState?.loading ? (
						<ModelDownloadBar
							progress={localState.download}
							modelName={model.name.replace(/\s*\(Browser\)$/, "")}
							sizeLabel={spec?.downloadLabel}
							onCancel={() => {
								localModel.cancel();
								// Partial transfers leave cached files behind.
								refreshCachedModelSizes();
							}}
						/>
					) : (
						status() && (
							<div className={css({
								marginTop: "0.25rem",
								fontSize: "0.75rem",
								color: (isActive && localState?.error) || !webGpuAvailable
									? "var(--destructive)"
									: isActive && localState?.loaded
										? "var(--primary)"
										: "var(--muted-foreground)",
							})}>
								{status()}
							</div>
						)
					)}
					{isBrowser && !(isActive && localState?.loading) && (
						<ModelCacheControls
							cachedBytes={cached.bytes}
							loaded={Boolean(isActive && localState?.loaded)}
							onRemove={async () => {
								await localModel.removeDownload(model.id);
								refreshCachedModelSizes();
							}}
						/>
					)}
				</div>
			</div>
		);
	}

interface ContextModelSelectorDialogProps {
	open: boolean;
	title: string;
	description: string;
	searchLabel: string;
	emptyLabel: string;
	badge: string;
	actionLabel: string;
	options: readonly { value: string; label: string }[];
	currentModelId: string;
	onClose: () => void;
	onSelect: (modelId: string) => void;
}

function ContextModelSelectorDialog({
	open,
	title,
	description,
	searchLabel,
	emptyLabel,
	badge,
	actionLabel,
	options,
	currentModelId,
	onClose,
	onSelect,
}: ContextModelSelectorDialogProps) {
	const defaultModel = currentModelId || options[0]?.value || "";
	const [selectedModel, setSelectedModel] = useState(defaultModel);
	const [search, setSearch] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) return;
		setSelectedModel(currentModelId || options[0]?.value || "");
		setSearch("");
		window.setTimeout(() => inputRef.current?.focus(), 50);
	}, [open, currentModelId, options]);

	if (!open) return null;

	const models = searchFullText(options, search, (model) => [model.label, model.value, badge]);

	return (
		<div
			className={css({
				position: "fixed",
				inset: 0,
				zIndex: 1010,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "rgba(0, 0, 0, 0.6)",
				paddingInline: { base: "0.75rem", sm: "1rem" },
				fontFamily: "monospace",
			})}
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="context-model-selector-title"
				className={css({
					display: "flex",
					width: "min(640px, 96vw)",
					height: "min(38rem, 85vh)",
					minHeight: 0,
					flexDirection: "column",
					overflow: "clip",
					borderRadius: "0.5rem",
					border: "2px solid var(--border)",
					background: "var(--background)",
				})}
				onClick={(event) => event.stopPropagation()}
			>
				<div className={css({ flexShrink: 0, borderBottom: "1px solid var(--border)", padding: { base: "0.75rem", sm: "1rem" } })}>
					<h2 id="context-model-selector-title" className={css({ fontSize: { base: "0.875rem", sm: "1rem" }, fontWeight: 600, color: "var(--foreground)" })}>
						{title}
					</h2>
					<p className={css({ marginTop: "0.125rem", fontSize: { base: "0.6875rem", sm: "0.75rem" }, color: "var(--muted-foreground)" })}>
						{description}
					</p>
					<label className={css({ marginTop: "0.75rem", display: "block" })}>
						<span className={css({ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", borderWidth: 0 })}>
							{searchLabel}
						</span>
						<div className={css({ position: "relative" })}>
							<Search size={15} aria-hidden="true" className={css({ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: "var(--muted-foreground)", pointerEvents: "none" })} />
							<input
								ref={inputRef}
								type="search"
								placeholder={searchLabel}
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								className={css({ width: "100%", minHeight: "2.25rem", borderRadius: "0.375rem", border: "2px solid var(--border)", background: "var(--background)", paddingBlock: "0.375rem", paddingLeft: "2rem", paddingRight: "0.625rem", fontSize: { base: "0.75rem", sm: "0.875rem" } })}
							/>
						</div>
					</label>
				</div>

				<div className={css({ margin: "0.25rem", minHeight: 0, flex: 1, overflowX: "hidden", overflowY: "auto", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)" })}>
					{models.length === 0 ? (
						<div className={css({ padding: "1rem", textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>
							{emptyLabel}
						</div>
					) : models.map((model) => (
						<label
							key={model.value}
							className={css({
								display: "flex",
								cursor: "pointer",
								alignItems: "flex-start",
								gap: "0.75rem",
								borderBottom: "1px solid var(--border)",
								background: selectedModel === model.value ? "color-mix(in srgb, var(--primary) 5%, transparent)" : undefined,
								padding: { base: "0.75rem", sm: "1rem" },
								_hover: { background: "color-mix(in srgb, var(--accent) 30%, transparent)" },
							})}
						>
							<input type="radio" name="context-model" checked={selectedModel === model.value} onChange={() => setSelectedModel(model.value)} />
							<span className={css({ minWidth: 0, flex: 1 })}>
								<span className={css({ display: "block", overflowWrap: "anywhere", fontSize: "0.875rem", fontWeight: 700, color: "var(--foreground)" })}>{model.label}</span>
								{model.label !== model.value && <span className={css({ display: "block", overflowWrap: "anywhere", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{model.value}</span>}
								<span className={css({ marginTop: "0.375rem", display: "inline-flex", borderRadius: "9999px", background: "var(--muted)", padding: "0.125rem 0.5rem", fontSize: "0.625rem", fontWeight: 600, color: "var(--muted-foreground)" })}>
									{badge}
								</span>
							</span>
						</label>
					))}
				</div>

				<div className={css({ display: "flex", flexShrink: 0, justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px solid var(--border)", padding: { base: "0.75rem", sm: "1rem" } })}>
					<button type="button" onClick={onClose} className={css({ borderRadius: "0.375rem", border: "2px solid var(--border)", paddingInline: "1rem", paddingBlock: "0.5rem", fontSize: "0.875rem", _hover: { background: "var(--ink)", color: "var(--paper)" } })}>
						Cancel
					</button>
					<button
						type="button"
						disabled={!selectedModel}
						onClick={() => onSelect(selectedModel)}
						className={css({ borderRadius: "0.375rem", border: "2px solid var(--primary)", background: "var(--primary)", paddingInline: "1rem", paddingBlock: "0.5rem", fontSize: "0.875rem", color: "var(--primary-foreground)", _hover: { background: "color-mix(in srgb, var(--primary) 90%, black)" }, _disabled: { cursor: "not-allowed", opacity: 0.5 } })}
					>
						{actionLabel}
					</button>
				</div>
			</div>
		</div>
	);
}

export interface ImageGenerationModelSelectorDialogProps {
	open: boolean;
	generator: ImageGeneratorOption;
	currentModelId: string;
	onClose: () => void;
	onSelect: (modelId: string) => void;
}

/** Only image-generation endpoint models are offered in this context. */
export function ImageGenerationModelSelectorDialog({
	open,
	generator,
	currentModelId,
	onClose,
	onSelect,
}: ImageGenerationModelSelectorDialogProps) {
	const options = useMemo(
		() => generator.models.map((model) => ({ value: model, label: model })),
		[generator.models],
	);
	return (
		<ContextModelSelectorDialog
			open={open}
			title="Select image model"
			description={`Only image-generation models from ${generator.label} are shown.`}
			searchLabel="Search image models"
			emptyLabel="No image-generation models matched this search."
			badge="Image generation"
			actionLabel="Use image model"
			options={options}
			currentModelId={currentModelId}
			onClose={onClose}
			onSelect={onSelect}
		/>
	);
}

export interface AudioModelSelectorDialogProps {
	open: boolean;
	provider: SpeechProviderDescriptor;
	currentModelId: string;
	onClose: () => void;
	onSelect: (modelId: string) => void;
}

/** Only models compatible with the active speech provider are offered. */
export function AudioModelSelectorDialog({
	open,
	provider,
	currentModelId,
	onClose,
	onSelect,
}: AudioModelSelectorDialogProps) {
	const isRealtime = provider.kind === "duplex";
	return (
		<ContextModelSelectorDialog
			open={open}
			title={isRealtime ? "Select realtime voice model" : "Select speech model"}
			description={`Only ${isRealtime ? "realtime voice" : "speech synthesis"} models from ${provider.label} are shown.`}
			searchLabel={isRealtime ? "Search realtime voice models" : "Search speech models"}
			emptyLabel={`No ${isRealtime ? "realtime voice" : "speech synthesis"} models matched this search.`}
			badge={isRealtime ? "Realtime voice" : "Speech output"}
			actionLabel="Use audio model"
			options={provider.models}
			currentModelId={currentModelId}
			onClose={onClose}
			onSelect={onSelect}
		/>
	);
}
