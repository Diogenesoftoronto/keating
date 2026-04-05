import { localModel, type LocalModel } from '../stores/local-model';

const MODEL_OPTIONS = [
  { 
    id: 'browser', 
    name: 'Gemma 4 E4B (Browser)', 
    description: 'WebGPU - runs in browser, no setup', 
    requiresKey: false,
    category: 'browser'
  },
  { 
    id: 'local', 
    name: 'Local Server', 
    description: 'Ollama, llama.cpp, LiteLLM endpoint', 
    requiresKey: false,
    category: 'local'
  },
  { 
    id: 'google', 
    name: 'Google Gemini 2.5 Pro', 
    description: 'Cloud - most capable Gemini', 
    requiresKey: true,
    category: 'cloud'
  },
  { 
    id: 'anthropic', 
    name: 'Anthropic Claude', 
    description: 'Cloud - Claude Sonnet 4', 
    requiresKey: true,
    category: 'cloud'
  },
  { 
    id: 'openai', 
    name: 'OpenAI GPT-4o', 
    description: 'Cloud - OpenAI flagship', 
    requiresKey: true,
    category: 'cloud'
  },
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
          background: rgba(0, 0, 0, 0.6);
          z-index: 1000;
          font-family: 'Space Mono', monospace;
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
          width: 90%;
          max-width: 520px;
          max-height: 85vh;
          overflow-y: auto;
        }
        h2 {
          margin: 0 0 0.5rem;
          font-size: 1.25rem;
          font-weight: 600;
        }
        .subtitle {
          font-size: 0.75rem;
          color: #64748b;
          margin-bottom: 1rem;
        }
        .category {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #64748b;
          margin: 1rem 0 0.5rem;
          padding-top: 0.5rem;
          border-top: 1px solid #e2e8f0;
        }
        .category:first-of-type {
          margin-top: 0;
          padding-top: 0;
          border-top: none;
        }
        .models {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .model-option {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          border: 2px solid #e2e8f0;
          border-radius: 0.375rem;
          cursor: pointer;
          transition: all 0.15s;
        }
        .model-option:hover:not(.disabled) {
          border-color: #6366f1;
          background: #f8f7f4;
        }
        .model-option.selected {
          border-color: #6366f1;
          background: #f0eff8;
        }
        .model-option.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .model-radio {
          margin-top: 0.25rem;
        }
        .model-info {
          flex: 1;
          min-width: 0;
        }
        .model-name {
          font-weight: 600;
          font-size: 0.9rem;
        }
        .model-desc {
          font-size: 0.75rem;
          color: #64748b;
        }
        .badges {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.25rem;
          flex-wrap: wrap;
        }
        .badge {
          font-size: 0.65rem;
          padding: 0.125rem 0.5rem;
          border-radius: 9999px;
          font-weight: 500;
        }
        .badge-key {
          background: #fef3c7;
          color: #92400e;
        }
        .badge-browser {
          background: #10b981/10;
          color: #059669;
          background: #d1fae5;
        }
        .badge-local {
          background: #e0e7ff;
          color: #4338ca;
        }
        .status {
          font-size: 0.7rem;
          margin-top: 0.375rem;
        }
        .status-loading { color: #6366f1; }
        .status-loaded { color: #10b981; }
        .status-error { color: #ef4444; }
        .progress-bar {
          width: 100%;
          height: 4px;
          background: #e2e8f0;
          border-radius: 2px;
          margin-top: 0.375rem;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: #6366f1;
          transition: width 0.3s ease;
        }
        .buttons {
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
          margin-top: 1.25rem;
          padding-top: 1rem;
          border-top: 1px solid #e2e8f0;
        }
        button {
          padding: 0.5rem 1rem;
          border-radius: 0.375rem;
          border: 2px solid #1a1a1a;
          background: #f4f1ea;
          cursor: pointer;
          font-size: 0.85rem;
          font-family: inherit;
          transition: all 0.15s;
        }
        button:hover {
          background: #1a1a1a;
          color: #f4f1ea;
        }
        button.primary {
          background: #6366f1;
          color: white;
          border-color: #6366f1;
        }
        button.primary:hover {
          background: #4f46e5;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .help-link {
          display: block;
          text-align: center;
          margin-top: 0.75rem;
          font-size: 0.75rem;
          color: #6366f1;
          text-decoration: underline;
          cursor: pointer;
        }
        .help-link:hover {
          color: #4f46e5;
        }
      </style>
      <div class="dialog">
        <h2>Select Model</h2>
        <p class="subtitle">Choose how Keating runs AI inference</p>
        
        <div class="models">
          <div class="category">No Setup Required</div>
          ${this.renderModelOption(MODEL_OPTIONS.find(m => m.id === 'browser')!)}
          
          <div class="category">Requires Local Server</div>
          ${this.renderModelOption(MODEL_OPTIONS.find(m => m.id === 'local')!)}
          
          <div class="category">Cloud Providers</div>
          ${MODEL_OPTIONS.filter(m => m.category === 'cloud').map(opt => this.renderModelOption(opt)).join('')}
        </div>
        
        <div class="buttons">
          <button id="cancel">Cancel</button>
          <button id="select" class="primary">Select</button>
        </div>
        <a class="help-link" id="help-link">Need help? View setup guide</a>
      </div>
    `;

    this.bindEvents();
  }

  private renderModelOption(opt: typeof MODEL_OPTIONS[0]): string {
    const isBrowser = opt.id === 'browser';
    const isSelected = this.selectedModel === opt.id;

    let statusHtml = '';
    let isDisabled = false;

    if (isBrowser && this.localModelState) {
      if (this.localModelState.loading) {
        statusHtml = `
          <div class="status status-loading">Loading model... ${this.localModelState.loadingProgress}%</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${this.localModelState.loadingProgress}%"></div>
          </div>
        `;
        isDisabled = true;
      } else if (this.localModelState.loaded) {
        statusHtml = `<div class="status status-loaded">Model ready</div>`;
      } else if (this.localModelState.error) {
        statusHtml = `<div class="status status-error">Error: ${this.localModelState.error}</div>`;
      }
    }

    const badgesHtml = opt.requiresKey 
      ? '<span class="badge badge-key">API Key</span>'
      : opt.id === 'browser'
        ? '<span class="badge badge-browser">WebGPU</span>'
        : '<span class="badge badge-local">Endpoint</span>';

    return `
      <div class="model-option ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}"
           data-model="${opt.id}">
        <input type="radio" name="model" value="${opt.id}" class="model-radio"
               ${isSelected ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>
        <div class="model-info">
          <div class="model-name">${opt.name}</div>
          <div class="model-desc">${opt.description}</div>
          <div class="badges">${badgesHtml}</div>
          ${statusHtml}
        </div>
      </div>
    `;
  }

  private bindEvents() {
    this.shadowRoot?.querySelectorAll('.model-option').forEach(el => {
      el.addEventListener('click', (e) => {
        const modelId = (e.currentTarget as HTMLElement).dataset.model;
        if (modelId && !el.classList.contains('disabled')) {
          this.selectedModel = modelId;
          this.render();
        }
      });
    });

    this.shadowRoot?.querySelector('#cancel')?.addEventListener('click', () => {
      this.remove();
    });

    this.shadowRoot?.querySelector('#select')?.addEventListener('click', () => {
      // If browser model selected and not loaded, start loading
      if (this.selectedModel === 'browser' && !this.localModelState?.loaded && !this.localModelState?.loading) {
        localModel.load();
        return; // Keep dialog open while loading
      }
      
      this.dispatchEvent(new CustomEvent('model-selected', {
        detail: { model: this.selectedModel },
      }));
      this.remove();
    });

    this.shadowRoot?.querySelector('#help-link')?.addEventListener('click', () => {
      window.open('/tutorial.html', '_blank');
    });
  }
}

customElements.define('keating-model-selector', KeatingModelSelector);
