import { getProviders, type Api, type Model } from "@mariozechner/pi-ai";
import { localModel, type LocalModel } from "../stores/local-model";
import { getSelectableModels } from "../lib/provider-models";

const BROWSER_MODEL: Model<Api> = {
	id: "gemma-4-e4b",
	name: "Gemma 4 E4B (Browser)",
	api: "browser" as Api,
	provider: "browser",
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 0,
	maxTokens: 0,
};

type SelectableModel = {
	key: string;
	model: Model<Api>;
	group: "browser" | "cloud" | "custom";
};

function modelKey(model: Model<any>): string {
	return `${model.provider}::${model.api}::${model.id}`;
}

export class KeatingModelSelector extends HTMLElement {
	private currentModel: Model<Api> | null = null;
	private onSelect?: (model: Model<Api>) => void;
	private selectedKey = modelKey(BROWSER_MODEL);
	private localModelState: LocalModel | null = null;
	private webGpuAvailable = false;
	private searchQuery = "";
	private unsubscribe?: () => void;
	private loadingModels = true;
	private loadError = "";
	private models: SelectableModel[] = [];

	static async open(currentModel: Model<Api> | null, onSelect: (model: Model<Api>) => void) {
		const dialog = new KeatingModelSelector();
		dialog.currentModel = currentModel;
		dialog.onSelect = onSelect;
		dialog.selectedKey = currentModel ? modelKey(currentModel) : modelKey(BROWSER_MODEL);
		document.body.appendChild(dialog);
	}

	constructor() {
		super();
		this.attachShadow({ mode: "open" });
	}

	async connectedCallback() {
		this.webGpuAvailable = await this.checkWebGpu();
		this.unsubscribe = localModel.subscribe((state) => {
			this.localModelState = state;
			this.render();
		});
		await this.loadModels();
		this.render();
	}

	disconnectedCallback() {
		this.unsubscribe?.();
	}

	private async checkWebGpu(): Promise<boolean> {
		if (!navigator.gpu) return false;
		try {
			return (await navigator.gpu.requestAdapter()) !== null;
		} catch {
			return false;
		}
	}

	private async loadModels() {
		this.loadingModels = true;
		this.loadError = "";
		this.render();

		try {
			const models = await getSelectableModels();
			const knownProviders = new Set<string>(getProviders());
			const selectable: SelectableModel[] = models.map((model) => ({
				key: modelKey(model),
				model,
				group:
					model.provider === "browser"
						? "browser"
						: knownProviders.has(model.provider)
							? "cloud"
							: "custom",
			}));

			if (this.webGpuAvailable) {
				selectable.unshift({ key: modelKey(BROWSER_MODEL), model: BROWSER_MODEL, group: "browser" });
			}

			const deduped = new Map<string, SelectableModel>();
			for (const model of selectable) {
				deduped.set(model.key, model);
			}

			this.models = Array.from(deduped.values());
			if (!this.models.some((entry) => entry.key === this.selectedKey) && this.models[0]) {
				this.selectedKey = this.models[0].key;
			}
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
			this.models = this.webGpuAvailable
				? [{ key: modelKey(BROWSER_MODEL), model: BROWSER_MODEL, group: "browser" }]
				: [];
		} finally {
			this.loadingModels = false;
		}
	}

	private getFilteredModels(): SelectableModel[] {
		const query = this.searchQuery.trim().toLowerCase();
		if (!query) return this.models;

		return this.models.filter(({ model }) => {
			const haystack = `${model.name} ${model.id} ${model.provider}`.toLowerCase();
			return haystack.includes(query);
		});
	}

	private renderGroup(title: string, group: SelectableModel["group"], models: SelectableModel[]): string {
		if (models.length === 0) return "";

		return `
      <div class="category">${title}</div>
      ${models.map((entry) => this.renderModelOption(entry)).join("")}
    `;
	}

	private renderModelOption(entry: SelectableModel): string {
		const { model, key } = entry;
		const isSelected = this.selectedKey === key;
		const isBrowser = model.provider === "browser";
		const statusHtml = this.renderStatus(model);
		const disabled = isBrowser && !this.webGpuAvailable;
		const badges = [
			isBrowser ? '<span class="badge badge-browser">WebGPU</span>' : "",
			entry.group === "cloud" ? '<span class="badge badge-key">Cloud</span>' : "",
			entry.group === "custom" ? '<span class="badge badge-local">Custom</span>' : "",
			model.input.includes("image") ? '<span class="badge badge-vision">Vision</span>' : "",
			model.reasoning ? '<span class="badge badge-thinking">Thinking</span>' : "",
		]
			.filter(Boolean)
			.join("");

		const providerLabel = isBrowser ? "Runs in this browser" : `Provider: ${model.provider}`;
		return `
      <div class="model-option ${isSelected ? "selected" : ""} ${disabled ? "disabled" : ""}" data-model-key="${key}">
        <input type="radio" name="model" value="${key}" class="model-radio" ${isSelected ? "checked" : ""} ${disabled ? "disabled" : ""}>
        <div class="model-info">
          <div class="model-name">${model.name}</div>
          <div class="model-desc">${providerLabel}</div>
          <div class="model-id">${model.id}</div>
          <div class="badges">${badges}</div>
          ${statusHtml}
        </div>
      </div>
    `;
	}

	private renderStatus(model: Model<Api>): string {
		if (model.provider !== "browser") return "";
		if (!this.webGpuAvailable) return `<div class="status status-error">WebGPU not available</div>`;
		if (this.localModelState?.loading) {
			return `
        <div class="status status-loading">Loading browser model... ${this.localModelState.loadingProgress}%</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${this.localModelState.loadingProgress}%"></div>
        </div>
      `;
		}
		if (this.localModelState?.loaded) return `<div class="status status-loaded">Model ready</div>`;
		if (this.localModelState?.error) return `<div class="status status-error">${this.localModelState.error}</div>`;
		return `<div class="status">Loads on demand when selected</div>`;
	}

	private bindEvents() {
		this.shadowRoot?.querySelector("#cancel")?.addEventListener("click", () => this.remove());
		this.shadowRoot?.querySelector("#search")?.addEventListener("input", (event) => {
			this.searchQuery = (event.target as HTMLInputElement).value;
			this.render();
		});
		this.shadowRoot?.querySelector("#refresh")?.addEventListener("click", async () => {
			await this.loadModels();
			this.render();
		});
		this.shadowRoot?.querySelector("#select")?.addEventListener("click", async () => {
			const selected = this.models.find((entry) => entry.key === this.selectedKey)?.model;
			if (!selected) return;

			if (selected.provider === "browser" && !this.localModelState?.loaded) {
				await localModel.load();
				if (!localModel.getState().loaded) {
					this.render();
					return;
				}
			}

			this.onSelect?.(selected);
			this.remove();
		});

		this.shadowRoot?.querySelectorAll(".model-option").forEach((element) => {
			element.addEventListener("click", () => {
				if (element.classList.contains("disabled")) return;
				this.selectedKey = (element as HTMLElement).dataset.modelKey || this.selectedKey;
				this.render();
			});
		});
	}

	private render() {
		if (!this.shadowRoot) return;

		const filtered = this.getFilteredModels();
		const browserModels = filtered.filter((entry) => entry.group === "browser");
		const cloudModels = filtered.filter((entry) => entry.group === "cloud");
		const customModels = filtered.filter((entry) => entry.group === "custom");

		this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 1000;
          font-family: "Space Mono", monospace;
        }
        .dialog {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #f4f1ea;
          border: 2px solid #1a1a1a;
          border-radius: 0.5rem;
          padding: 1.5rem;
          width: min(720px, 92vw);
          max-height: 85vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        h2 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 600;
        }
        .subtitle {
          font-size: 0.75rem;
          color: #64748b;
          margin: 0;
        }
        .toolbar {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .toolbar input {
          flex: 1;
          min-width: 220px;
          padding: 0.75rem 1rem;
          border: 2px solid #1a1a1a;
          border-radius: 0.375rem;
          background: #fffdf8;
          font: inherit;
        }
        .toolbar button,
        .buttons button {
          padding: 0.75rem 1.25rem;
          border-radius: 0.375rem;
          border: 2px solid #1a1a1a;
          background: #f4f1ea;
          cursor: pointer;
          font: inherit;
        }
        .toolbar button:hover,
        .buttons button:hover {
          background: #1a1a1a;
          color: #f4f1ea;
        }
        .buttons button.primary {
          background: #d44a3d;
          border-color: #d44a3d;
          color: #fff;
        }
        .buttons button.primary:hover {
          background: #a33a30;
          border-color: #a33a30;
        }
        .content {
          overflow-y: auto;
          border: 1px solid #d6d3cc;
          background: #fffdf8;
          padding: 0.5rem 0;
        }
        .category {
          position: sticky;
          top: 0;
          z-index: 1;
          background: #fff8ef;
          border-top: 1px solid #d6d3cc;
          border-bottom: 1px solid #d6d3cc;
          padding: 0.5rem 1rem;
          font-size: 0.7rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #64748b;
        }
        .category:first-of-type {
          border-top: none;
        }
        .model-option {
          display: flex;
          gap: 0.75rem;
          align-items: flex-start;
          padding: 1rem;
          border-bottom: 1px solid #ece8de;
          cursor: pointer;
        }
        .model-option:hover:not(.disabled),
        .model-option.selected {
          background: #f7f2ea;
        }
        .model-option.disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .model-radio {
          margin-top: 0.25rem;
        }
        .model-info {
          min-width: 0;
          flex: 1;
        }
        .model-name {
          font-weight: 700;
          font-size: 0.95rem;
        }
        .model-desc,
        .model-id,
        .status {
          color: #64748b;
          font-size: 0.75rem;
          margin-top: 0.2rem;
          word-break: break-word;
        }
        .badges {
          display: flex;
          gap: 0.4rem;
          flex-wrap: wrap;
          margin-top: 0.4rem;
        }
        .badge {
          font-size: 0.65rem;
          padding: 0.125rem 0.5rem;
          border-radius: 9999px;
          font-weight: 600;
        }
        .badge-key {
          background: #e8ecff;
          color: #3043a6;
        }
        .badge-browser {
          background: #d1fae5;
          color: #047857;
        }
        .badge-local,
        .badge-vision,
        .badge-thinking {
          background: #f4e4d8;
          color: #8b4513;
        }
        .status-loading { color: #3043a6; }
        .status-loaded { color: #047857; }
        .status-error { color: #b91c1c; }
        .progress-bar {
          width: 100%;
          height: 4px;
          background: #e2e8f0;
          border-radius: 9999px;
          margin-top: 0.4rem;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: #3043a6;
        }
        .empty,
        .loading,
        .error {
          padding: 1rem;
          color: #64748b;
          font-size: 0.85rem;
        }
        .error { color: #b91c1c; }
        .buttons {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
        }
        @media (max-width: 640px) {
          .dialog {
            width: 95vw;
            padding: 1rem;
          }
          .toolbar {
            flex-direction: column;
          }
          .toolbar input {
            min-width: 0;
          }
          .buttons {
            flex-direction: column;
          }
        }
      </style>
      <div class="dialog">
        <div>
          <h2>Select Model</h2>
          <p class="subtitle">Built-in providers and discovered custom-provider models.</p>
        </div>
        <div class="toolbar">
          <input id="search" type="text" placeholder="Search models or providers" value="${this.searchQuery}">
          <button id="refresh" type="button">Refresh</button>
        </div>
        <div class="content">
          ${
						this.loadingModels
							? '<div class="loading">Loading models…</div>'
							: this.loadError
								? `<div class="error">${this.loadError}</div>`
								: filtered.length === 0
									? '<div class="empty">No models matched the current search.</div>'
									: `
                ${this.renderGroup("Browser", "browser", browserModels)}
                ${this.renderGroup("Cloud", "cloud", cloudModels)}
                ${this.renderGroup("Custom Providers", "custom", customModels)}
              `
					}
        </div>
        <div class="buttons">
          <button id="cancel" type="button">Cancel</button>
          <button id="select" class="primary" type="button">Use Selected Model</button>
        </div>
      </div>
    `;

		this.bindEvents();
	}
}

customElements.define("keating-model-selector", KeatingModelSelector);
