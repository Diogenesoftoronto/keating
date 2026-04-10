import { i18n } from "@mariozechner/mini-lit";
import { Select } from "@mariozechner/mini-lit/dist/Select.js";
import { getProviders } from "@mariozechner/pi-ai";
import { type CustomProvider, CustomProviderCard, ProviderKeyInput, SettingsTab, getAppStorage } from "@mariozechner/pi-web-ui";
import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { KeatingCustomProviderDialog, type KeatingCustomProviderType } from "./custom-provider-dialog";

type KeatingCustomProvider = Omit<CustomProvider, "type"> & {
	type:
		| "ollama"
		| "llama.cpp"
		| "vllm"
		| "lmstudio"
		| "openai-completions"
		| "openai-responses"
		| "anthropic-messages"
		| "synthetic";
};

const AUTO_DISCOVERY_TYPES = new Set(["ollama", "llama.cpp", "vllm", "lmstudio"]);

@customElement("keating-providers-models-tab")
export class KeatingProvidersModelsTab extends SettingsTab {
	private customProviders: KeatingCustomProvider[] = [];

	override async connectedCallback() {
		super.connectedCallback();
		await this.loadCustomProviders();
	}

	private async loadCustomProviders() {
		try {
			const storage = getAppStorage();
			this.customProviders = (await storage.customProviders.getAll()) as KeatingCustomProvider[];
		} catch (error) {
			console.error("Failed to load custom providers:", error);
		}
	}

	getTabName(): string {
		return "Providers & Models";
	}

	private renderKnownProviders(): TemplateResult {
		const providers = getProviders();

		return html`
			<div class="flex flex-col gap-6">
				<div>
					<h3 class="text-sm font-semibold text-foreground mb-2">Cloud Providers</h3>
					<p class="text-sm text-muted-foreground mb-4">
						Cloud LLM providers with predefined models. API keys are stored locally in your browser.
					</p>
				</div>
				<div class="flex flex-col gap-6">
					${providers.map((provider) => html`<provider-key-input .provider=${provider}></provider-key-input>`)}
				</div>
			</div>
		`;
	}

	private renderCustomProviders(): TemplateResult {
		return html`
			<div class="flex flex-col gap-6">
				<div class="flex items-center justify-between">
					<div>
						<h3 class="text-sm font-semibold text-foreground mb-2">Custom Providers</h3>
						<p class="text-sm text-muted-foreground">
							User-configured servers with auto-discovered or manually defined models.
						</p>
					</div>
					${Select({
						placeholder: i18n("Add Provider"),
						options: [
							{ value: "ollama", label: "Ollama" },
							{ value: "llama.cpp", label: "llama.cpp" },
							{ value: "vllm", label: "vLLM" },
							{ value: "lmstudio", label: "LM Studio" },
							{ value: "openai-completions", label: i18n("OpenAI Completions Compatible") },
							{ value: "openai-responses", label: i18n("OpenAI Responses Compatible") },
							{ value: "anthropic-messages", label: i18n("Anthropic Messages Compatible") },
							{ value: "synthetic", label: "Synthetic (OpenAI Compatible)" },
						],
						onChange: (value: string) => this.addCustomProvider(value as KeatingCustomProviderType),
						variant: "outline",
						size: "sm",
					})}
				</div>

				${
					this.customProviders.length === 0
						? html`
							<div class="text-sm text-muted-foreground text-center py-8">
								No custom providers configured. Click 'Add Provider' to get started.
							</div>
						`
						: html`
							<div class="flex flex-col gap-4">
								${this.customProviders.map(
									(provider) => html`
										<custom-provider-card
											.provider=${provider as any}
											.isAutoDiscovery=${AUTO_DISCOVERY_TYPES.has(provider.type)}
											.onEdit=${(p: CustomProvider) => this.editProvider(p as KeatingCustomProvider)}
											.onDelete=${(p: CustomProvider) => this.deleteProvider(p as KeatingCustomProvider)}
										></custom-provider-card>
									`,
								)}
							</div>
						`
				}
			</div>
		`;
	}

	private async addCustomProvider(type: KeatingCustomProviderType) {
		await KeatingCustomProviderDialog.open(undefined, type, async () => {
			await this.loadCustomProviders();
			this.requestUpdate();
		});
	}

	private async editProvider(provider: KeatingCustomProvider) {
		await KeatingCustomProviderDialog.open(provider, undefined, async () => {
			await this.loadCustomProviders();
			this.requestUpdate();
		});
	}

	private async deleteProvider(provider: KeatingCustomProvider) {
		if (!confirm("Are you sure you want to delete this provider?")) {
			return;
		}

		try {
			const storage = getAppStorage();
			await storage.customProviders.delete(provider.id);
			await storage.providerKeys.delete(provider.name);
			await this.loadCustomProviders();
			this.requestUpdate();
		} catch (error) {
			console.error("Failed to delete provider:", error);
		}
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-8">
				${this.renderKnownProviders()}
				<div class="border-t border-border"></div>
				${this.renderCustomProviders()}
			</div>
		`;
	}
}
