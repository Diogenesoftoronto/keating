/**
 * Dialogs owned by the browser teacher: Settings, the chat and image model
 * selectors, the API key prompt and the knowledge tool review. Plain render
 * functions (not components) so the element tree matches what the hook
 * rendered inline before.
 */
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { MutableRefObject } from "react";
import { SettingsDialog } from "../../components/SettingsDialog";
import { KnowledgeToolReview } from "../../components/settings/KnowledgeSources";
import {
  ImageGenerationModelSelectorDialog,
  ModelSelectorDialog,
} from "../../components/ModelSelector";
import { KeatingApiKeyPromptDialog } from "../../components/KeatingApiKeyPromptDialog";
import { requestInterfaceTour } from "../../keating/interface-tour";
import { loadKeatingUiSettings, saveKeatingUiSettings } from "../../keating/ui-settings";
import {
  DEFAULT_IMAGE_GENERATOR_ID,
  getImageGenerator,
} from "../../lib/image-generators";
import type { DialogState } from "../useDialogState";
import type { SettingsDeepLink } from "./settings-deep-link";

export function renderAgentDialogs({
  settingsDialog,
  settingsDeepLinkRef,
  modelSelectorDialog,
  imageModelSelectorDialog,
  currentModel,
  onSelectModel,
  imageModelRetryRef,
  onImageRetryFailed,
  thinkingLevel,
  onThinkingLevelChange,
  thinkingDisabled,
}: {
  settingsDialog: DialogState;
  settingsDeepLinkRef: MutableRefObject<SettingsDeepLink | null>;
  modelSelectorDialog: DialogState;
  imageModelSelectorDialog: DialogState;
  currentModel: Model<Api>;
  onSelectModel: (model: Model<Api>) => void;
  imageModelRetryRef: MutableRefObject<null | (() => Promise<void>)>;
  onImageRetryFailed: () => void;
  thinkingLevel?: ThinkingLevel;
  onThinkingLevelChange?: (level: ThinkingLevel) => void;
  thinkingDisabled?: boolean;
}) {
  const settingsDialogElement = (
    <SettingsDialog
      open={settingsDialog.open}
      onClose={settingsDialog.onClose}
      defaultTabId={settingsDeepLinkRef.current?.sectionId ? settingsDeepLinkRef.current.tabId+"."+settingsDeepLinkRef.current.sectionId : settingsDeepLinkRef.current?.tabId}
      onTour={requestInterfaceTour}
    />
  );

  const modelSelectorDialogElement = (
    <ModelSelectorDialog
      open={modelSelectorDialog.open}
      currentModel={currentModel}
      onClose={modelSelectorDialog.onClose}
      // The picker only calls this once the model is usable (connected, downloaded), so the choice is made:
      // close it instead of leaving it over the screen the learner came from.
      onSelect={(model) => { onSelectModel(model); modelSelectorDialog.onClose(); }}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={onThinkingLevelChange}
      thinkingDisabled={thinkingDisabled}
    />
  );

  const imageSettings = loadKeatingUiSettings();
  const selectedImageGenerator =
    getImageGenerator(imageSettings.imageGenerator) ??
    getImageGenerator(DEFAULT_IMAGE_GENERATOR_ID)!;
  const imageModelSelectorDialogElement = (
    <ImageGenerationModelSelectorDialog
      open={imageModelSelectorDialog.open}
      generator={selectedImageGenerator}
      currentModelId={
        imageSettings.imageModel || selectedImageGenerator.models[0] || ""
      }
      onClose={() => {
        imageModelRetryRef.current = null;
        imageModelSelectorDialog.onClose();
      }}
      onSelect={(modelId) => {
        saveKeatingUiSettings({
          ...loadKeatingUiSettings(),
          imageModel: modelId,
        });
        const retry = imageModelRetryRef.current;
        imageModelRetryRef.current = null;
        void retry?.().catch((error) => {
          console.error("Keating image generation retry failed:", error);
          onImageRetryFailed();
        });
      }}
    />
  );

  return (
    <>
      {settingsDialogElement}
      {modelSelectorDialogElement}
      {imageModelSelectorDialogElement}
      <KeatingApiKeyPromptDialog />
      <KnowledgeToolReview />
    </>
  );
}
