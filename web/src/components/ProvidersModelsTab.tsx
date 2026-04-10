import React from "react";
import { SettingsDialog } from "@mariozechner/pi-web-ui";
import { getProviders } from "@mariozechner/pi-ai";

export class KeatingProvidersTab {
	private customProviders: any[] = [];

	getTabName(): string {
		return "Providers & Models";
	}

	async connectedCallback(): Promise<void> {
		await this.loadCustomProviders();
	}

	private async loadCustomProviders(): Promise<void> {
		// Load from storage
	}

	render(): React.ReactElement {
		const providers = getProviders();

		return React.createElement(
			"div",
			{ className: "p-4 space-y-6" },
			React.createElement(
				"h2",
				{ className: "text-lg font-semibold" },
				"Known Providers"
			),
			React.createElement(
				"div",
				{ className: "space-y-2" },
				providers.map((provider: string) =>
					React.createElement(
						"div",
						{
							key: provider,
							className: "p-3 border rounded hover:bg-accent/5 transition-colors",
						},
						React.createElement("span", { className: "font-medium" }, provider)
					)
				)
			),
			React.createElement(
				"h2",
				{ className: "text-lg font-semibold mt-6" },
				"Custom Providers"
			),
			React.createElement(
				"p",
				{ className: "text-sm text-muted-foreground" },
				"Add custom providers like Ollama, llama.cpp, vLLM, or LM Studio."
			),
			React.createElement(
				"button",
				{
					className: "px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity",
				},
				"Add Custom Provider"
			)
		);
	}
}
