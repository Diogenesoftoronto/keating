// Dynamic imports used to keep @huggingface/transformers out of the main bundle
// This prevents build timeouts and ensures the ~100MB library is only loaded on demand.

// Configuration will be applied inside the async load() method

// ONNX model - Gemma 4 E4B (the only format Transformers.js supports)
const MODEL_ID = 'onnx-community/gemma-4-E4B-it-ONNX';

export interface LocalModel {
  loaded: boolean;
  loading: boolean;
  loadingProgress: number;
  error: string | null;
  model: any | null;
  processor: any | null;
  transformers: any | null; // Store transformers instance
}

class LocalModelStore {
  private state: LocalModel = {
    loaded: false,
    loading: false,
    loadingProgress: 0,
    error: null,
    model: null,
    processor: null,
    transformers: null,
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

    this.state = { ...this.state, loading: true, loadingProgress: 0, error: null };
    this.notify();

    try {
      console.log('Loading transformers.js and model:', MODEL_ID);

      // Dynamically import transformers.js
      const { AutoProcessor, AutoModelForCausalLM, env } = await import('@huggingface/transformers');
      
      // Ensure we NEVER try to load local models from the repo
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      // Load processor (tokenizer)
      const processor = await AutoProcessor.from_pretrained(MODEL_ID);

      // Load model with WebGPU and q4f16 quantization
      const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
        dtype: 'q4f16',
        device: 'webgpu',
        progress_callback: (progress: any) => {
          if (progress.status === 'progress' || progress.status === 'progress_total') {
            const pct = Math.round(progress.progress ?? 0);
            this.state = { ...this.state, loadingProgress: pct };
            this.notify();
            console.log(`Loading: ${pct}%`);
          }
        },
      });

      this.state = {
        loaded: true,
        loading: false,
        loadingProgress: 100,
        error: null,
        model,
        processor,
        transformers: { AutoProcessor, AutoModelForCausalLM, env },
      };
      this.notify();
      console.log('Local model loaded successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = {
        loaded: false,
        loading: false,
        loadingProgress: 0,
        error: message,
        model: null,
        processor: null,
      };
      this.notify();
      console.error('Failed to load local model:', message);
    }
  }

  async generate(
    prompt: string,
    options?: { max_length?: number; temperature?: number },
    onToken?: (token: string) => void
  ): Promise<string> {
    if (!this.state.model || !this.state.processor) {
      throw new Error('Model not loaded');
    }

    // Prepare messages in chat format
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    ];

    // Apply chat template
    const formattedPrompt = this.state.processor.apply_chat_template(messages, {
      add_generation_prompt: true,
    });

    // Tokenize input
    const inputs = await this.state.processor(formattedPrompt, {
      add_special_tokens: false,
    });

    // Dynamically import TextStreamer
    const { TextStreamer } = await import('@huggingface/transformers');

    // Generate with streaming
    const streamer = new TextStreamer(this.state.processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: onToken
        ? (text: string) => onToken(text)
        : undefined,
    });

    const outputs = await this.state.model.generate({
      ...inputs,
      max_new_tokens: options?.max_length ?? 512,
      temperature: options?.temperature ?? 0.7,
      do_sample: true,
      streamer,
    });

    // Decode output
    const decoded = this.state.processor.batch_decode(
      outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
      { skip_special_tokens: true }
    );

    return decoded[0] ?? '';
  }

  getState(): LocalModel {
    return this.state;
  }
}

export const localModel = new LocalModelStore();
