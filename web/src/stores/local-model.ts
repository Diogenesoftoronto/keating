import { pipeline, env } from '@huggingface/transformers';

// Configure Transformers.js
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = 'unsloth/gemma-4-E4B-it-GGUF';
const MODEL_FILE = 'gemma-4-E4B-it-UD-Q4_K_XL.gguf';

export interface LocalModel {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  generator: any | null;
}

class LocalModelStore {
  private state: LocalModel = {
    loaded: false,
    loading: false,
    error: null,
    generator: null,
  };

  private listeners: Set<(state: LocalModel) => void> = new Set();

  subscribe(listener: (state: LocalModel) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(l => l(this.state));
  }

  async load(): Promise<void> {
    if (this.state.loaded || this.state.loading) return;

    this.state = { ...this.state, loading: true, error: null };
    this.notify();

    try {
      console.log('Loading local model:', MODEL_ID);

      // Use text-generation pipeline with GGUF format
      const generator = await pipeline('text-generation', MODEL_ID, {
        progress_callback: (progress: any) => {
          if (progress.status === 'progress') {
            console.log(`Loading: ${Math.round(progress.progress)}%`);
          }
        },
        // @ts-ignore - GGUF-specific config
        dtype: 'q4',
        device: 'webgpu',
      });

      this.state = {
        loaded: true,
        loading: false,
        error: null,
        generator,
      };
      this.notify();
      console.log('Local model loaded successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = {
        loaded: false,
        loading: false,
        error: message,
        generator: null,
      };
      this.notify();
      console.error('Failed to load local model:', message);
    }
  }

  async generate(prompt: string, options?: { max_length?: number; temperature?: number }): Promise<string> {
    if (!this.state.generator) {
      throw new Error('Model not loaded');
    }

    const result = await this.state.generator(prompt, {
      max_new_tokens: options?.max_length ?? 512,
      temperature: options?.temperature ?? 0.7,
      do_sample: true,
      return_full_text: false,
    });

    return result[0]?.generated_text ?? '';
  }

  getState(): LocalModel {
    return this.state;
  }
}

export const localModel = new LocalModelStore();
