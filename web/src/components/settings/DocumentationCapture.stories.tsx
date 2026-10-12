import { useLayoutEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ProviderDialog, INITIAL_PROVIDER_FORM, type ProviderFormState } from "./CustomProvidersSection";
import { OfflineTutorSettings } from "../OfflineTutorSettings";
import { ModelPicker } from "../ModelPicker";
import { DESKTOP_OFFLINE_MODELS, type DesktopOfflineBridge, type DesktopOfflineStatus } from "../../lib/desktop-offline";

const meta = {
  title: "Documentation/Model setup",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function CustomProviderPreview() {
  const [form, setForm] = useState<ProviderFormState>({
    ...INITIAL_PROVIDER_FORM, name: "My Ollama server", type: "ollama", baseUrl: "http://localhost:11434",
  });
  return <ProviderDialog dialog={{ open: true }} form={form} error="" saving={false}
    onChange={setForm} onClose={fn()} onSave={fn()} />;
}
export const CustomProvider: Story = { render: () => <CustomProviderPreview /> };

export const PopulatedModelPicker: Story = { render: () => <ModelPicker open label="Find a model"
  selected="demo-tutor" onSelect={fn()} onClose={fn()} items={[
    { id: "keating", name: "Keating", group: "Keating Cloud", pinnedLabel: "Recommended", summary: "Provider default · fixture catalog" },
    { id: "demo-tutor", name: "Local tutor", group: "Keating Demo", summary: "OpenAI-compatible · selected fixture" },
    { id: "offline-minicpm", name: "MiniCPM5 2B (Offline)", group: "On this device", summary: "Compact text tutor · fixture installation" },
  ]} /> };

function OfflinePreview({ installed = false }: { installed?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const bridge = useMemo<DesktopOfflineBridge>(() => {
    const status: DesktopOfflineStatus = {
      available: true, installed, downloading: !installed,
      downloadedBytes: installed ? 1_550_000_000 : 620_000_000, totalBytes: 1_550_000_000,
    };
    return {
      supportedModels: DESKTOP_OFFLINE_MODELS.map(model => model.id),
      status: async () => ({ ...status }),
      download: async () => {}, cancelDownload: async () => {}, remove: async () => {},
      generate: async () => "Fixture preview only.", cancelGeneration: async () => {},
    };
  }, [installed]);
  useLayoutEffect(() => {
    const previous = window.keatingOffline;
    window.keatingOffline = bridge;
    setMounted(true);
    return () => { if (window.keatingOffline === bridge) window.keatingOffline = previous; };
  }, [bridge]);
  return <div style={{ maxWidth: 680, margin: "48px auto", padding: 24 }}>
    {mounted && <OfflineTutorSettings />}
  </div>;
}
export const OfflineDownload: Story = { render: () => <OfflinePreview /> };
export const OfflineReady: Story = { render: () => <OfflinePreview installed /> };
