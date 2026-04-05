import { localModel, type LocalModel } from '../stores/local-model';

const MODEL_OPTIONS = [
  { id: 'local', name: 'Gemma 4 E4B (Local)', description: 'Run locally in your browser via WebGPU', requiresKey: false },
  { id: 'google', name: 'Google Gemini 2.5 Pro', description: 'Google\'s most capable model', requiresKey: true },
  { id: 'anthropic', name: 'Anthropic Claude', description: 'Claude Sonnet 4', requiresKey: true },
  { id: 'openai', name: 'OpenAI GPT-4o', description: 'OpenAI\'s flagship model', requiresKey: true },
];

export class KeatingModelSelector extends HTMLElement {
  private selectedModel: string = 'google';
  private localModelState: LocalModel | null = null;
  private unsubscribe?: () => void;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.unsubscribe = localModel.subscribe(state => {
      this.localModelState = state;
      this.render();
    });

    // Subscribe to local model state
    this.render();
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  private render() {
    if (!this.shadowRoot) return;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 1000;
        }
        .dialog {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: white;
          border-radius: 1rem;
          padding: 1.5rem;
          width: 90%;
          max-width: 500px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        }
        h2 {
          margin: 0 0 1rem;
          font-size: 1.25rem;
          font-weight: 600;
        }
        .models {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .model-option {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          cursor: pointer;
          transition: all 0.15s;
        }
        .model-option:hover {
          border-color: #6366f1;
        }
        .model-option.selected {
          border-color: #6366f1;
          background: #f5f3ff;
        }
        .model-option.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .model-info {
          flex: 1;
        }
        .model-name {
          font-weight: 500;
        }
        .model-desc {
          font-size: 0.875rem;
          color: #64748b;
        }
        .key-badge {
          font-size: 0.75rem;
          background: #fef3c7;
          color: #92400e;
          padding: 0.125rem 0.5rem;
          border-radius: 9999px;
        }
        .local-status {
          font-size: 0.75rem;
          margin-top: 0.25rem;
        }
        .loading { color: #6366f1; }
        .loaded { color: #10b981; }
        .error { color: #ef4444; }
        .buttons {
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
          margin-top: 1rem;
        }
        button {
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          border: 1px solid #e2e8f0;
          background: white;
          cursor: pointer;
          font-size: 0.875rem;
        }
        button:hover {
          background: #f8fafc;
        }
        button.primary {
          background: #6366f1;
          color: white;
          border-color: #6366f1;
        }
        button.primary:hover {
          background: #4f46e5;
        }
      </style>
      <div class="dialog">
        <h2>Select Model</h2>
        <div class="models">
          ${MODEL_OPTIONS.map(opt => this.renderModelOption(opt)).join('')}
        </div>
        <div class="buttons">
          <button id="cancel">Cancel</button>
          <button id="select" class="primary">Select</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderModelOption(opt: typeof MODEL_OPTIONS[0]): string {
    const isLocal = opt.id === 'local';
    const isDisabled = isLocal && !this.localModelState?.loaded && !this.localModelState?.loading;
    const isSelected = this.selectedModel === opt.id;

    let statusHtml = '';
    if (isLocal && this.localModelState) {
      if (this.localModelState.loading) {
        statusHtml = `<div class="local-status loading">Loading model... This may take a few minutes.</div>`;
      } else if (this.localModelState.loaded) {
        statusHtml = `<div class="local-status loaded">✓ Model loaded and ready</div>`;
      } else if (this.localModelState.error) {
        statusHtml = `<div class="local-status error">Error: ${this.localModelState.error}</div>`;
      }
    }

    return `
      <div class="model-option ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}"
           data-model="${opt.id}">
        <input type="radio" name="model" value="${opt.id}"
               ${isSelected ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>
        <div class="model-info">
          <div class="model-name">${opt.name}</div>
          <div class="model-desc">${opt.description}</div>
          ${statusHtml}
        </div>
        ${opt.requiresKey ? '<span class="key-badge">Requires API Key</span>' : ''}
      </div>
    `;
  }

  private bindEvents() {
    this.shadowRoot?.querySelectorAll('.model-option').forEach(el => {
      el.addEventListener('click', (e) => {
        const modelId = (e.currentTarget as HTMLElement).dataset.model;
        if (modelId && modelId !== 'local' || this.localModelState?.loaded) {
          this.selectedModel = modelId || 'google';
          this.render();
        }
      });
    });

    this.shadowRoot?.querySelector('#cancel')?.addEventListener('click', () => {
      this.remove();
    });

    this.shadowRoot?.querySelector('#select')?.addEventListener('click', () => {
      if (this.selectedModel === 'local' && !this.localModelState?.loaded) {
        localModel.load();
      }
      this.dispatchEvent(new CustomEvent('model-selected', {
        detail: { model: this.selectedModel },
      }));
      this.remove();
    });
  }
}

customElements.define('keating-model-selector', KeatingModelSelector);
