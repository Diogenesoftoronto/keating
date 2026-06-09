import type { StorybookConfig } from "@storybook/react-vite";

// Plugins from the app's vite.config that are irrelevant to component stories and
// can break the Storybook build (service worker, OG image routes, dev API proxy).
const DROP_PLUGINS = ["pwa", "workbox", "og-image", "og:image", "chat-proxy"];

const config: StorybookConfig = {
	stories: ["../src/**/*.stories.@(ts|tsx)"],
	framework: {
		name: "@storybook/react-vite",
		options: {},
	},
	core: {
		// Don't phone home with anonymous usage telemetry.
		disableTelemetry: true,
	},
	async viteFinal(viteConfig) {
		viteConfig.plugins = (viteConfig.plugins ?? []).filter((plugin) => {
			const name = (plugin as { name?: string } | null)?.name ?? "";
			return !DROP_PLUGINS.some((needle) => name.toLowerCase().includes(needle));
		});
		return viteConfig;
	},
};

export default config;
