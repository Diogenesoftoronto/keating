/**
 * Dialogs owned by the browser teacher: Settings, the chat and image model
 * selectors, the API key prompt and the knowledge tool review. Plain render
 * functions (not components) so the element tree matches what the hook
 * rendered inline before.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { MutableRefObject } from "react";
import { SettingsDialog } from "../../components/SettingsDialog";
import { StartTab } from "../../components/settings/StartTab";
import { KeatingUiSettingsTab } from "../../components/KeatingUiSettingsTab";
import { DiagnosticsTab } from "../../components/settings/DiagnosticsTab";
import { LearningTab } from "../../components/settings/LearningTab";
import { ModelsProvidersTab } from "../../components/settings/ModelsProvidersTab";
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
}: {
  settingsDialog: DialogState;
  settingsDeepLinkRef: MutableRefObject<SettingsDeepLink | null>;
  modelSelectorDialog: DialogState;
  imageModelSelectorDialog: DialogState;
  currentModel: Model<Api>;
  onSelectModel: (model: Model<Api>) => void;
  imageModelRetryRef: MutableRefObject<null | (() => Promise<void>)>;
  onImageRetryFailed: () => void;
}) {
  const settingsDialogElement = (
    <SettingsDialog
      open={settingsDialog.open}
      onClose={settingsDialog.onClose}
      defaultTabId={settingsDeepLinkRef.current?.tabId}
      tabs={[
        {
          id: "start",
          label: "Get started",
          group: "Basics",
          description: "The few things worth doing first.",
          docsPath: "start-here/",
          component: <StartTab />,
        },
        {
          id: "models",
          label: "Models & Providers",
          group: "Connect",
          description: "API keys, local models, web search and proxy.",
          docsPath: "choose-a-model/",
          component: <ModelsProvidersTab />,
        },
        {
          id: "learning",
          label: "Learning",
          group: "Personalize",
          description: "Your profile, the teacher's persona, and voice.",
          docsPath: "learning-with-keating/",
          component: (
            <LearningTab
              onStartTour={() => {
                // Settings sits above the chat, so close it before the tour
                // starts pointing at elements underneath.
                settingsDialog.onClose();
                requestInterfaceTour();
              }}
            />
          ),
        },
        {
          id: "app",
          label: "Appearance & Privacy",
          group: "Personalize",
          description: "Chat display, sharing, images and analytics.",
          component: <KeatingUiSettingsTab />,
        },
        {
          id: "diagnostics",
          label: "Diagnostics",
          group: "Support",
          description: "Troubleshoot problems and report issues.",
          docsPath: "troubleshooting/",
          component: <DiagnosticsTab />,
        },
      ]}
    />
  );

  const modelSelectorDialogElement = (
    <ModelSelectorDialog
      open={modelSelectorDialog.open}
      currentModel={currentModel}
      onClose={modelSelectorDialog.onClose}
      onSelect={onSelectModel}
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
