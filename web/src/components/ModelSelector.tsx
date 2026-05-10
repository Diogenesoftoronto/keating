import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { getProviders, type Api, type Model } from "@mariozechner/pi-ai";
import { localModel, getModelName, getModelId, type LocalModel } from "../stores/local-model";
import { getSelectableModels } from "../lib/provider-models";
import { addRecentModel, getRecentModels } from "../keating/ui-settings";

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
	const [selectedKey, setSelectedKey] = useState(currentModel ? modelKey(currentModel) : modelKey(makeBrowserModel()));
	const [localState, setLocalState] = useState<LocalModel | null>(null);
	const [webGpuAvailable, setWebGpuAvailable] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) return;
		setSearch("");
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
			const all = await getSelectableModels();
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
		if (!q) return models;
		return models.filter(({ model }) => {
			const haystack = `${model.name} ${model.id} ${model.provider}`.toLowerCase();
			return haystack.includes(q);
		});
	}, [search, models]);

	const recentKeys = new Set(search.trim() === "" ? getRecentModels().map((m) => m.key) : []);

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
		<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-4 font-mono" onClick={onClose}>
			<div
				role="dialog"
				aria-modal="true"
				className="flex flex-col rounded-lg border-2 border-border bg-background overflow-hidden w-[min(720px,92vw)] max-h-[85vh]"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="p-4 border-b border-border shrink-0">
					<div>
						<h2 className="text-base font-semibold text-foreground">Select Model</h2>
						<p className="text-xs text-muted-foreground mt-0.5">Built-in providers and discovered custom-provider models.</p>
					</div>
					<div className="flex gap-2 mt-3 flex-wrap">
						<input
							ref={inputRef}
							type="text"
							placeholder="Search models or providers"
							className="flex-1 min-w-[180px] rounded-md border-2 border-border bg-background px-3 py-2 text-sm"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
						<button
							onClick={() => {
								setLoading(true);
								loadModels();
							}}
							className="inline-flex items-center gap-1 rounded-md border-2 border-border px-3 py-2 text-sm hover:bg-ink hover:text-paper transition-colors"
						>
							<RefreshCw size={14} />
							Refresh
							</button>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto border border-border m-1 bg-muted/20">
					{loading ? (
						<div className="p-4 text-sm text-muted-foreground text-center">Loading models…</div>
						) : error ? (
						<div className="p-4 text-sm text-destructive text-center">{error}</div>
					) : filtered.length === 0 ? (
						<div className="p-4 text-sm text-muted-foreground text-center">No models matched the current search.</div>
					) : (
						<>
							{renderGroup("Recent", recentModels, selectedKey, setSelectedKey, localState, webGpuAvailable)}
							{renderGroup("Browser", browserModels, selectedKey, setSelectedKey, localState, webGpuAvailable)}
							{renderGroup("Cloud", cloudModels, selectedKey, setSelectedKey, localState, webGpuAvailable)}
							{renderGroup("Custom Providers", customModels, selectedKey, setSelectedKey, localState, webGpuAvailable)}
						</>
					)}
				</div>

				<div className="flex justify-end gap-2 p-4 border-t border-border shrink-0">
					<button
						onClick={onClose}
						className="rounded-md border-2 border-border px-4 py-2 text-sm hover:bg-ink hover:text-paper transition-colors"
					>
						Cancel
					</button>
					<button
						onClick={handleSelect}
						className="rounded-md bg-primary border-2 border-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
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
			<div className="sticky top-0 z-10 bg-muted/80 border-y border-border px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
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
			className={`flex gap-3 items-start px-4 py-3 border-b border-border cursor-pointer transition-colors ${
				isSelected ? "bg-primary/5" : ""
			} ${disabled ? "opacity-45 cursor-not-allowed" : "hover:bg-accent/30"}`}
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
				className="mt-1 shrink-0"
			/>
			<div className="min-w-0 flex-1">
				<div className="text-sm font-bold">{model.name}</div>
				<div className="text-xs text-muted-foreground mt-0.5">
					{isBrowser ? "Runs in this browser" : `Provider: ${model.provider}`}
				</div>
				<div className="text-xs text-muted-foreground">{model.id}</div>
				{badges.length > 0 && (
					<div className="flex flex-wrap gap-1 mt-1.5">
						{badges.map((b) => (
							<span key={b} className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground">
								{b}
							</span>
							))}
						</div>
					)}
					{status() && (
						<div className={`text-xs mt-1 ${status().includes("error") || status().includes("not available") ? "text-destructive" : status().includes("ready") ? "text-primary" : status().includes("Loading") ? "text-blue-600" : "text-muted-foreground"}`}>
							{status()}
							{localState?.loading && (
								<div className="w-full h-1 bg-muted-foreground/20 rounded-full mt-1 overflow-hidden">
									<div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${localState.loadingProgress}%` }} />
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		);
	}
