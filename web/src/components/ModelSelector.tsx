import { useEffect, useMemo, useState } from "react";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { localModel, getBrowserModel } from "../stores/local-model";
import { checkBrowserModelAvailability, discoverModels, displayModelProvider, modelKey, type SelectableModel } from "../lib/model-catalog";
import type { ImageGeneratorOption } from "../lib/image-generators";
import type { SpeechProviderDescriptor } from "../keating/speech";
import { addRecentModel } from "../keating/ui-settings";
import { ModelPicker } from "./ModelPicker";
import { ModelDownloadBar, ModelCacheControls } from "./ModelDownloadBar";
import { useCachedModelSize, refreshCachedModelSizes } from "../hooks/useCachedModelSize";

function BrowserCache({ id }: { id: string }) {
 const cached = useCachedModelSize(id, true);
 return <ModelCacheControls cachedBytes={cached.bytes}
  loaded={localModel.getState().modelId === id && localModel.getState().loaded}
  onRemove={async () => { await localModel.removeDownload(id); refreshCachedModelSizes(); }}/>;
}

export interface ModelSelectorDialogProps {
 open: boolean; currentModel: Model<Api> | null; onClose: () => void;
 onSelect: (model: Model<Api>) => void;
 title?: string; description?: string; actionLabel?: string;
 excludeKeys?: readonly string[]; preloadBrowserModel?: boolean;
}
export function ModelSelectorDialog({ open, currentModel, onClose, onSelect, excludeKeys, preloadBrowserModel = true }: ModelSelectorDialogProps) {
 const [models, setModels] = useState<SelectableModel[]>([]);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");
 const [selected, setSelected] = useState(currentModel ? modelKey(currentModel) : "");
 const [provider, setProvider] = useState("");
 const [capability, setCapability] = useState("");
 const [notice, setNotice] = useState("");
 const [local, setLocal] = useState(localModel.getState());
 useEffect(() => localModel.subscribe(setLocal), []);
 useEffect(() => { setSelected(currentModel ? modelKey(currentModel) : ""); }, [currentModel]);
 useEffect(() => {
  if (!open) return;
  let cancelled = false;
  setLoading(true); setError(""); setProvider(""); setCapability("");
  void (async () => {
   try {
    const availability = await checkBrowserModelAvailability();
    const next = await discoverModels(availability);
    if (cancelled) return;
    setModels(next);
    setNotice(Object.values(availability).find(value => !value.available)?.reason ?? "");
   } catch (error) { if (!cancelled) setError(error instanceof Error ? error.message : "Could not load models."); }
   finally { if (!cancelled) setLoading(false); }
  })();
  return () => { cancelled = true; };
 }, [open]);
 const providers = Array.from(new Set(models.map(entry => entry.model.provider)));
 const items = models.filter(entry => !excludeKeys?.includes(entry.key) &&
  (!provider || entry.model.provider === provider) &&
  (!capability || (capability === "reasoning" ? entry.model.reasoning : entry.model.input.includes("image"))))
 .map(({ key, model }) => ({
  id: key, name: model.name, group: displayModelProvider(model.provider),
  summary: [displayModelProvider(model.provider), model.reasoning ? "Step-by-step reasoning" : "", model.input.includes("image") ? "Understands images" : ""].filter(Boolean).join(" · "),
  details: <div><p>Model ID: {model.id}</p>
   {model.provider === "browser" ? <p>{getBrowserModel(model.id)?.blurb} Downloads when selected.</p> : <p>Context: {model.contextWindow.toLocaleString()} tokens</p>}
   {model.provider === "browser" && local.modelId === model.id && local.loading &&
    <ModelDownloadBar progress={local.download} modelName={model.name} onCancel={() => localModel.cancel()}/>}
   {model.provider === "browser" && !local.loading && <BrowserCache id={model.id}/>}
  </div>
 }));
 return <ModelPicker open={open} label="Find a model" items={items} selected={selected} onClose={onClose} loading={loading} error={error}
  notice={notice ? <p>{notice}</p> : undefined}
  filters={<><label>Provider<select value={provider} onChange={e => setProvider(e.target.value)}><option value="">All providers</option>{providers.map(id => <option key={id} value={id}>{displayModelProvider(id)}</option>)}</select></label>
   <label>Use it for<select value={capability} onChange={e => setCapability(e.target.value)}><option value="">Any conversation</option><option value="reasoning">Step-by-step reasoning</option><option value="image">Understanding images</option></select></label></>}
  onSelect={async key => {
   const model = models.find(entry => entry.key === key)?.model;
   if (!model) return;
   if (preloadBrowserModel && model.provider === "browser" && !(localModel.getState().modelId === model.id && localModel.getState().loaded)) {
    await localModel.load(model.id);
    if (!localModel.getState().loaded) throw new Error(localModel.getState().error || "Download did not complete. Choose the model to retry.");
   }
   onSelect(model); setSelected(key); addRecentModel(key);
  }}/>;
}
interface ContextModelSelectorDialogProps {
 open: boolean; title: string; description: string; searchLabel: string; emptyLabel: string; badge: string;
 options: readonly { value: string; label: string }[]; currentModelId: string;
 onClose: () => void; onSelect: (id: string) => void;
}
function ContextModelSelectorDialog({ open, searchLabel, badge, options, currentModelId, onClose, onSelect }: ContextModelSelectorDialogProps) {
 const [selected, setSelected] = useState(currentModelId);
 useEffect(() => setSelected(currentModelId), [currentModelId]);
 return <ModelPicker open={open} label={searchLabel} selected={selected} onClose={onClose}
  items={options.map(option => ({ id: option.value, name: option.label, group: badge, summary: badge }))}
  onSelect={id => { onSelect(id); setSelected(id); }}/>;
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
			options={provider.models}
			currentModelId={currentModelId}
			onClose={onClose}
			onSelect={onSelect}
		/>
	);
}
