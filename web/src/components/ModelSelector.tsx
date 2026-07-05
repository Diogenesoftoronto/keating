import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { getProviders, type Api, type Model } from "@earendil-works/pi-ai/compat";
import { localModel, getModelName, getModelId, type LocalModel } from "../stores/local-model";
import { getSelectableModels, buildSavedModel } from "../lib/provider-models";
import { addRecentModel, getRecentModels } from "../keating/ui-settings";
import { loadModelPrefs } from "../keating/model-prefs";
import { css } from "../../styled-system/css";

function makeBrowserModel(): Model<Api> {
	return {
		id: getModelId(),
		name: getModelName(),
		api: "browser" as Api,
		provider: "browser",
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 0,
		maxTokens: 0,
	};
}

type SelectableModel = {
	key: string;
	model: Model<Api>;
	group: "recent" | "browser" | "cloud" | "custom";
};

function modelKey(model: Model<any>): string {
	return `${model.provider}::${model.api}::${model.id}`;
}

export interface ModelSelectorDialogProps {
	open: boolean;
	currentModel: Model<Api> | null;
	onClose: () => void;
	onSelect: (model: Model<Api>) => void;
}

export function ModelSelectorDialog({ open, currentModel, onClose, onSelect }: ModelSelectorDialogProps) {
	const [models, setModels] = useState<SelectableModel[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [search, setSearch] = useState("");
	const [providerFilter, setProviderFilter] = useState("all");
	const [selectedKey, setSelectedKey] = useState(currentModel ? modelKey(currentModel) : modelKey(makeBrowserModel()));
	const [localState, setLocalState] = useState<LocalModel | null>(null);
	const [webGpuAvailable, setWebGpuAvailable] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) return;
		setSearch("");
		setProviderFilter("all");
		setSelectedKey(currentModel ? modelKey(currentModel) : modelKey(makeBrowserModel()));
		checkWebGpu().then(setWebGpuAvailable);
		const unsub = localModel.subscribe(setLocalState);
		loadModels();
		// Focus search input after a short delay
		window.setTimeout(() => inputRef.current?.focus(), 50);
		return () => unsub();
	}, [open, currentModel]);

	const checkWebGpu = async (): Promise<boolean> => {
		if (!navigator.gpu) return false;
		try {
			return (await navigator.gpu.requestAdapter()) !== null;
		} catch {
			return false;
		}
	};

	const loadModels = async () => {
		setLoading(true);
		setError("");
		try {
			const modelPrefs = loadModelPrefs();
			const hidden = new Set(modelPrefs.hiddenProviders);
			const all = await getSelectableModels((provider) => !hidden.has(provider));

			// Append saved custom models
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
				selectable.unshift({ key: modelKey(makeBrowserModel()), model: makeBrowserModel(), group: "browser" });
			}

			const deduped = new Map<string, SelectableModel>();
			for (const m of selectable) deduped.set(m.key, m);

			setModels(Array.from(deduped.values()));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setModels(webGpuAvailable ? [{ key: modelKey(makeBrowserModel()), model: makeBrowserModel(), group: "browser" }] : []);
		} finally {
			setLoading(false);
		}
	};

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		const provider = providerFilter;
		return models.filter(({ model }) => {
			if (provider !== "all" && model.provider !== provider) return false;
			if (!q) return true;
			const haystack = `${model.name} ${model.id} ${model.provider}`.toLowerCase();
			return haystack.includes(q);
		});
	}, [search, providerFilter, models]);

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
		if (selected.provider === "browser" && !localState?.loaded) {
			await localModel.load();
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
					maxHeight: { base: "92vh", sm: "85vh" },
					flexDirection: "column",
					overflow: "hidden",
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
					<div className={css({ marginTop: { base: "0.5rem", sm: "0.75rem" }, display: "grid", gap: "0.5rem", sm: { gridTemplateColumns: "minmax(0, 1fr) minmax(10rem, 14rem) auto" } })}>
						<label className={css({ minWidth: 0 })}>
							<span className={css({ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", borderWidth: 0 })}>Search models</span>
							<input
								ref={inputRef}
								type="text"
								placeholder="Search models"
								className={css({ width: "100%", borderRadius: "0.375rem", border: "2px solid var(--border)", background: "var(--background)", padding: "0.375rem 0.625rem", fontSize: { base: "0.75rem", sm: "0.875rem" } })}
								value={search}
								onChange={(e) => setSearch(e.target.value)}
							/>
						</label>
						<label className={css({ minWidth: 0 })}>
							<span className={css({ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", borderWidth: 0 })}>Filter by provider</span>
							<select
								className={css({ width: "100%", borderRadius: "0.375rem", border: "2px solid var(--border)", background: "var(--background)", padding: "0.375rem 0.625rem", fontSize: { base: "0.75rem", sm: "0.875rem" } })}
								value={providerFilter}
								onChange={(e) => setProviderFilter(e.target.value)}
							>
								<option value="all">All providers</option>
								{providerOptions.map((provider) => (
									<option key={provider} value={provider}>
										{provider}
									</option>
								))}
							</select>
						</label>
						<button
							onClick={() => {
								setLoading(true);
								loadModels();
							}}
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

				<div className={css({ margin: "0.25rem", flex: 1, overflowY: "auto", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)" })}>
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
		model.input.includes("image") ? "Vision" : "",
		model.reasoning ? "Thinking" : "",
	].filter(Boolean);

	const status = (): string => {
		if (model.provider !== "browser") return "";
		if (!webGpuAvailable) return "WebGPU not available";
		if (localState?.loading) return `Loading browser model... ${localState.loadingProgress}%`;
		if (localState?.loaded) return "Model ready";
		if (localState?.error) return localState.error;
		return "Loads on demand when selected";
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
					{isBrowser ? "Runs in this browser" : `Provider: ${model.provider}`}
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
					{status() && (
						<div className={css({
							marginTop: "0.25rem",
							fontSize: "0.75rem",
							color: status().includes("error") || status().includes("not available")
								? "var(--destructive)"
								: status().includes("ready")
									? "var(--primary)"
									: status().includes("Loading")
										? "#2563eb"
										: "var(--muted-foreground)",
						})}>
							{status()}
							{localState?.loading && (
								<div className={css({ marginTop: "0.25rem", height: "0.25rem", width: "100%", overflow: "hidden", borderRadius: "9999px", background: "color-mix(in srgb, var(--muted-foreground) 20%, transparent)" })}>
									<div className={css({ height: "100%", borderRadius: "9999px", background: "#2563eb", transition: "all 150ms" })} style={{ width: `${localState.loadingProgress}%` }} />
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		);
	}
