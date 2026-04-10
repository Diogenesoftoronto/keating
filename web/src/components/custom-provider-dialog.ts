import { i18n } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { DialogBase } from "@mariozechner/mini-lit/dist/DialogBase.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { Label } from "@mariozechner/mini-lit/dist/Label.js";
import { Select } from "@mariozechner/mini-lit/dist/Select.js";
import { html, type TemplateResult } from "lit";
import { getAppStorage } from "@mariozechner/pi-web-ui";
import type { CustomProvider } from "@mariozechner/pi-web-ui";

export type KeatingCustomProviderType =
	| "ollama"
	| "llama.cpp"
	| "vllm"
	| "lmstudio"
	| "openai-completions"
	| "openai-responses"
	| "anthropic-messages"
	| "synthetic";

type KeatingCustomProvider = Omit<CustomProvider, "type"> & {
	type: KeatingCustomProviderType;
};

export class KeatingCustomProviderDialog extends DialogBase {
	private provider?: KeatingCustomProvider;
	private initialType?: KeatingCustomProviderType;
	private onSaveCallback?: () => void;

	private name = "";
	private type: KeatingCustomProviderType = "openai-completions";
	private baseUrl = "";
	private apiKey = "";

	protected modalWidth = "min(800px, 90vw)";
	protected modalHeight = "min(700px, 90vh)";

	static async open(
		provider: KeatingCustomProvider | undefined,
		initialType: KeatingCustomProviderType | undefined,
		onSave?: () => void,
	) {
		const dialog = new KeatingCustomProviderDialog();
		dialog.provider = provider;
		dialog.initialType = initialType;
		dialog.onSaveCallback = onSave;
		document.body.appendChild(dialog);
		dialog.initializeFromProvider();
		dialog.open();
		dialog.requestUpdate();
	}

	private initializeFromProvider() {
		if (this.provider) {
			this.name = this.provider.name;
			this.type = this.provider.type;
			this.baseUrl = this.provider.baseUrl;
			this.apiKey = this.provider.apiKey || "";
		} else {
			this.name = "";
			this.type = this.initialType || "openai-completions";
			this.baseUrl = "";
			this.updateDefaultBaseUrl();
			this.apiKey = "";
		}
	}

	private updateDefaultBaseUrl() {
		if (this.baseUrl) return;

		const defaults: Record<KeatingCustomProviderType, string> = {
			ollama: "http://localhost:11434",
			"llama.cpp": "http://localhost:8080",
			vllm: "http://localhost:8000",
			lmstudio: "http://localhost:1234",
			"openai-completions": "",
			"openai-responses": "",
			"anthropic-messages": "",
			synthetic: "https://api.synthetic.new/openai/v1",
		};

		this.baseUrl = defaults[this.type] || "";
	}

	private async save() {
		if (!this.name || !this.baseUrl) {
			alert(i18n("Please fill in all required fields"));
			return;
		}

		try {
			const storage = getAppStorage();

			const provider: KeatingCustomProvider = {
				id: this.provider?.id || crypto.randomUUID(),
				name: this.name,
				type: this.type,
				baseUrl: this.baseUrl,
				apiKey: this.apiKey || undefined,
				models: this.provider?.models || [],
			};

			await storage.customProviders.set(provider as any);
			if (this.provider?.name && this.provider.name !== this.name) {
				await storage.providerKeys.delete(this.provider.name);
			}
			if (this.apiKey) {
				await storage.providerKeys.set(this.name, this.apiKey);
			} else {
				await storage.providerKeys.delete(this.name);
			}

			this.onSaveCallback?.();
			this.close();
		} catch (error) {
			console.error("Failed to save provider:", error);
			alert(i18n("Failed to save provider"));
		}
	}

	protected override renderContent(): TemplateResult {
		const providerTypes: Array<{ value: KeatingCustomProviderType; label: string }> = [
			{ value: "ollama", label: "Ollama" },
			{ value: "llama.cpp", label: "llama.cpp" },
			{ value: "vllm", label: "vLLM" },
			{ value: "lmstudio", label: "LM Studio" },
			{ value: "openai-completions", label: "OpenAI Completions Compatible" },
			{ value: "openai-responses", label: "OpenAI Responses Compatible" },
			{ value: "anthropic-messages", label: "Anthropic Messages Compatible" },
			{ value: "synthetic", label: "Synthetic (OpenAI Compatible)" },
		];

		return html`
			<div class="flex flex-col h-full overflow-hidden">
				<div class="p-6 flex-shrink-0 border-b border-border">
					<h2 class="text-lg font-semibold text-foreground">
						${this.provider ? i18n("Edit Provider") : i18n("Add Provider")}
					</h2>
				</div>

				<div class="flex-1 overflow-y-auto p-6">
					<div class="flex flex-col gap-4">
						<div class="flex flex-col gap-2">
							${Label({ htmlFor: "provider-name", children: i18n("Provider Name") })}
							${Input({
								value: this.name,
								placeholder: i18n("e.g., My Ollama Server"),
								onInput: (e: Event) => {
									this.name = (e.target as HTMLInputElement).value;
									this.requestUpdate();
								},
							})}
						</div>

						<div class="flex flex-col gap-2">
							${Label({ htmlFor: "provider-type", children: i18n("Provider Type") })}
							${Select({
								value: this.type,
								options: providerTypes.map((pt) => ({ value: pt.value, label: pt.label })),
								onChange: (value: string) => {
									this.type = value as KeatingCustomProviderType;
									this.baseUrl = "";
									this.updateDefaultBaseUrl();
									this.requestUpdate();
								},
								width: "100%",
							})}
						</div>

						<div class="flex flex-col gap-2">
							${Label({ htmlFor: "base-url", children: i18n("Base URL") })}
							${Input({
								value: this.baseUrl,
								placeholder: "e.g., https://api.synthetic.new/openai/v1",
								onInput: (e: Event) => {
									this.baseUrl = (e.target as HTMLInputElement).value;
									this.requestUpdate();
								},
							})}
						</div>

						<div class="flex flex-col gap-2">
							${Label({ htmlFor: "api-key", children: i18n("API Key (Optional)") })}
							${Input({
								type: "password",
								value: this.apiKey,
								placeholder: i18n("Leave empty if not required"),
								onInput: (e: Event) => {
									this.apiKey = (e.target as HTMLInputElement).value;
									this.requestUpdate();
								},
							})}
						</div>
					</div>
				</div>

				<div class="p-6 flex-shrink-0 border-t border-border flex justify-end gap-2">
					${Button({
						onClick: () => this.close(),
						variant: "ghost",
						children: i18n("Cancel"),
					})}
					${Button({
						onClick: () => this.save(),
						variant: "default",
						disabled: !this.name || !this.baseUrl,
						children: i18n("Save"),
					})}
				</div>
			</div>
		`;
	}
}

customElements.define("keating-custom-provider-dialog", KeatingCustomProviderDialog);
