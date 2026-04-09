import { getAppStorage } from '@mariozechner/pi-web-ui';

const PROVIDERS = [
  { id: 'google', name: 'Google AI', keyPlaceholder: 'AIza...' },
  { id: 'anthropic', name: 'Anthropic', keyPlaceholder: 'sk-ant-...' },
  { id: 'openai', name: 'OpenAI', keyPlaceholder: 'sk-...' },
];

export class KeatingSettings extends HTMLElement {
  private keys: Record<string, string> = {};

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.loadKeys();
  }

  private async loadKeys() {
    const storage = getAppStorage();
    if (!storage) {
      this.render();
      return;
    }

    for (const provider of PROVIDERS) {
      const key = await storage.providerKeys.get(provider.id);
      this.keys[provider.id] = key ?? '';
    }
    this.render();
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
        .providers {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .provider {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        label {
          font-size: 0.875rem;
          font-weight: 500;
        }
        input {
          padding: 0.75rem 1rem;
          border: 1px solid #e2e8f0;
          border-radius: 0.375rem;
          font-size: 16px;
          min-height: 44px;
          width: 100%;
          box-sizing: border-box;
        }
        input:focus {
          outline: none;
          border-color: #6366f1;
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
        }
        .hint {
          font-size: 0.75rem;
          color: #64748b;
        }
        .buttons {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
          margin-top: 1.5rem;
        }
        @media (max-width: 480px) {
          .buttons {
            flex-direction: column;
          }
          .buttons button {
            width: 100%;
          }
        }
        button {
          padding: 0.75rem 1.25rem;
          border-radius: 0.5rem;
          border: 1px solid #e2e8f0;
          background: white;
          cursor: pointer;
          font-size: 0.875rem;
          min-height: 44px;
          min-width: 44px;
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
        <h2>API Keys</h2>
        <div class="providers">
          ${PROVIDERS.map(p => `
            <div class="provider">
              <label for="${p.id}">${p.name}</label>
              <input type="password" id="${p.id}"
                     placeholder="${p.keyPlaceholder}"
                     value="${this.keys[p.id] || ''}">
              <div class="hint">Your API key is stored locally in your browser</div>
            </div>
          `).join('')}
        </div>
        <div class="buttons">
          <button id="cancel">Cancel</button>
          <button id="save" class="primary">Save</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents() {
    this.shadowRoot?.querySelector('#cancel')?.addEventListener('click', () => {
      this.remove();
    });

    this.shadowRoot?.querySelector('#save')?.addEventListener('click', async () => {
      const storage = getAppStorage();
      if (!storage) {
        this.remove();
        return;
      }

      for (const provider of PROVIDERS) {
        const input = this.shadowRoot?.querySelector(`#${provider.id}`) as HTMLInputElement;
        if (input) {
          const key = input.value.trim();
          if (key) {
            await storage.providerKeys.set(provider.id, key);
          } else {
            await storage.providerKeys.delete(provider.id);
          }
        }
      }
      this.dispatchEvent(new CustomEvent('keys-saved'));
      this.remove();
    });
  }
}

customElements.define('keating-settings', KeatingSettings);
