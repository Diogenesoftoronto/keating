import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { localModel, getBrowserModel } from "../stores/local-model";
import {
	checkBrowserModelAvailability,
	discoverModels,
	displayModelProvider,
	getModelProviderAvailability,
	hasProviderCredential,
	modelKey,
	requiresProviderCredential,
	type ModelProviderAvailability,
	type SelectableModel,
} from "../lib/model-catalog";
import type { ImageGeneratorOption } from "../lib/image-generators";
import type { SpeechProviderDescriptor } from "../keating/speech";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../keating/model-prefs";
import { addRecentModel } from "../keating/ui-settings";
import { promptKeatingApiKey } from "./KeatingApiKeyPromptDialog";
import { ModelPicker } from "./ModelPicker";
import { ModelDownloadBar, ModelCacheControls } from "./ModelDownloadBar";
import { useCachedModelSize, refreshCachedModelSizes } from "../hooks/useCachedModelSize";
import { NOTORGANIC_DEFAULT_MODEL } from "../notorganic-provider";

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
 const [providerAvailability, setProviderAvailability] = useState<ModelProviderAvailability[]>([]);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");
 const [recoveryProvider, setRecoveryProvider] = useState("");
 const [authenticating, setAuthenticating] = useState(false);
 const [revealedProviders, setRevealedProviders] = useState<string[]>([]);
 const [selected, setSelected] = useState(currentModel ? modelKey(currentModel) : "");
 const [provider, setProvider] = useState("");
 const [capability, setCapability] = useState("");
 const [notice, setNotice] = useState("");
 const [local, setLocal] = useState(localModel.getState());
 useEffect(() => localModel.subscribe(setLocal), []);
 useEffect(() => { setSelected(currentModel ? modelKey(currentModel) : ""); }, [currentModel]);
 const loadModels = useCallback(async () => {
  if (!open) return;
  setLoading(true); setError("");
  try {
   const [browserAvailability, nextAvailability] = await Promise.all([
    checkBrowserModelAvailability(),
    getModelProviderAvailability(),
   ]);
   let next = await discoverModels(browserAvailability, { revealProviders: new Set(revealedProviders) });
   if (currentModel && !next.some(entry => entry.key === modelKey(currentModel))) {
    const provider = nextAvailability.find(entry => entry.id === currentModel.provider);
    next = [{
     key: modelKey(currentModel),
     model: currentModel,
     group: currentModel.provider === "browser" ? "browser" : provider?.cloud ? "cloud" : "custom",
    }, ...next];
   }
   setModels(next);
   setProviderAvailability(nextAvailability);
   setNotice(Object.values(browserAvailability).find(value => !value.available)?.reason ?? "");
  } catch (error) {
   setError(error instanceof Error ? error.message : "Could not load models.");
  } finally {
   setLoading(false);
  }
 }, [currentModel, open, revealedProviders]);
 useEffect(() => {
  if (!open) return;
  setError(""); setProvider(""); setCapability(""); setRecoveryProvider("");
  void loadModels();
 }, [loadModels, open]);
 useEffect(() => {
  const refresh = () => { if (open) void loadModels(); };
  window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh);
  window.addEventListener("focus", refresh);
  return () => {
   window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh);
   window.removeEventListener("focus", refresh);
  };
 }, [loadModels, open]);
 const openProviderSettings = useCallback(() => {
  flushSync(onClose);
  window.dispatchEvent(new CustomEvent("keating:open-settings", { detail: { tab: "models" } }));
 }, [onClose]);
 const requestProviderAccess = useCallback(async (provider: string): Promise<boolean> => {
  setRecoveryProvider(provider);
  // Remove the native modal from the top layer before mounting the key prompt.
  flushSync(() => setAuthenticating(true));
  try {
   const connected = await promptKeatingApiKey(provider);
   if (connected) {
    setRevealedProviders(previous => previous.includes(provider) ? previous : [...previous, provider]);
    setRecoveryProvider("");
   }
   return connected;
  } catch {
   return false;
  } finally {
   setAuthenticating(false);
  }
 }, []);
 const providers = Array.from(new Set(models.map(entry => entry.model.provider)));
 const unavailableProviders = providerAvailability.filter(provider => provider.cloud && !provider.configured);
 const unavailableProviderIds = new Set(unavailableProviders.map(provider => provider.id));
 const providerSetupNotice = unavailableProviders.length > 0 ? <div>
  <p>Connect a provider to show its models.</p>
  {unavailableProviders.map(provider => <p key={provider.id}>
   <strong>{displayModelProvider(provider.id)}</strong>{" "}
   <button type="button" onClick={() => void requestProviderAccess(provider.id)}>Add key or sign in</button>{" "}
   <button type="button" onClick={openProviderSettings}>Open settings</button>
  </p>)}
 </div> : null;
 const items = models.filter(entry => !excludeKeys?.includes(entry.key) &&
  (!provider || entry.model.provider === provider) &&
  (!capability || (capability === "reasoning" ? entry.model.reasoning : entry.model.input.includes("image"))))
 .map(({ key, model }) => ({
  id: key, name: model.name, group: displayModelProvider(model.provider),
  pinnedLabel: key === modelKey(NOTORGANIC_DEFAULT_MODEL) ? "Provider default" : undefined,
  summary: [displayModelProvider(model.provider), model.reasoning ? "Step-by-step reasoning" : "", model.input.includes("image") ? "Understands images" : ""].filter(Boolean).join(" · "),
  details: <div><p>Model ID: {model.id}</p>
   {model.provider === "browser" ? <p>{getBrowserModel(model.id)?.blurb} Downloads when selected.</p> : <p>Context: {model.contextWindow.toLocaleString()} tokens</p>}
   {model.provider === "browser" && local.modelId === model.id && local.loading &&
    <ModelDownloadBar progress={local.download} modelName={model.name} onCancel={() => localModel.cancel()}/>}
   {model.provider === "browser" && !local.loading && <BrowserCache id={model.id}/>}
  </div>,
  action: unavailableProviderIds.has(model.provider) ? <span>
   This provider is not connected. <button type="button" onClick={() => void requestProviderAccess(model.provider)}>Add key or sign in</button>{" "}
   <button type="button" onClick={openProviderSettings}>Open settings</button>
  </span> : undefined,
 }));
 return <ModelPicker open={open && !authenticating} label="Find a model" items={items} selected={selected} onClose={onClose} loading={loading} error={error}
  errorAction={recoveryProvider ? <div>
   <button type="button" onClick={() => void requestProviderAccess(recoveryProvider)}>Add key or sign in for {displayModelProvider(recoveryProvider)}</button>{" "}
   <button type="button" onClick={openProviderSettings}>Open provider settings</button>
  </div> : undefined}
  notice={providerSetupNotice || (notice ? <p>{notice}</p> : undefined)}
  noticeLabel={providerSetupNotice ? "Provider setup" : undefined}
  filters={<><label>Provider<select value={provider} onChange={e => setProvider(e.target.value)}><option value="">All providers</option>{providers.map(id => <option key={id} value={id}>{displayModelProvider(id)}</option>)}</select></label>
   <label>Use it for<select value={capability} onChange={e => setCapability(e.target.value)}><option value="">Any conversation</option><option value="reasoning">Step-by-step reasoning</option><option value="image">Understanding images</option></select></label></>}
  onSelect={async key => {
   const model = models.find(entry => entry.key === key)?.model;
   if (!model) return;
   const credentialMissing = requiresProviderCredential(model.provider)
    && !unavailableProviderIds.has(model.provider)
    && !(await hasProviderCredential(model.provider));
   if (unavailableProviderIds.has(model.provider) || credentialMissing) {
    const connected = await requestProviderAccess(model.provider);
    if (!connected) throw new Error(`${displayModelProvider(model.provider)} is not connected. Add a key or sign in, then try again.`);
   }
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
