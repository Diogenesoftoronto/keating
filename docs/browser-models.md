# Browser models

What ships in the model selector, what is queued behind it, and what has already
been ruled out. Every size below was measured from the Hugging Face blob API
(sum of the chosen dtype's `.onnx` plus its `.onnx_data*` chunks, plus tokenizer
and config files) — not read off a model card.

The registry lives in `web/src/stores/local-model.ts`. Read this file before
adding to it: most of the obvious candidates are already here with a reason.

## What a model needs to run here

Four things have to be true. Each has cost us a model.

1. **An ONNX export in the transformers.js layout.** `onnx/model_q4f16.onnx`
   for text models, or the four-way `embed_tokens` / `decoder_model_merged` /
   `vision_encoder` / `audio_encoder` split for multimodal Gemma. GGUF, MLX,
   safetensors, and onnxruntime-genai layouts are all unloadable — the loader
   fetches paths that do not exist and fails as a 404.
2. **Weights quantized to 4-bit or 8-bit.** ONNX Runtime's `MatMulNBits` kernel
   accepts nothing else; sub-4-bit weights fail at session creation with
   `bits must be 4 or 8`. That string lives in the ORT WASM binary, so no
   loader-side dtype config works around it. Ternary and q2 exports are out
   until onnxruntime-web adds support.
3. **An architecture transformers.js implements.** `lfm2`, `lfm2_moe`,
   `lfm2_vl`, `qwen3`, and the Gemma families are in; a `trust_remote_code`
   architecture with custom modeling files is not.
4. **A download and a VRAM footprint a browser can carry.** Roughly: the
   download is also what has to fit on the GPU.

Multi-part external data (`model_q4f16.onnx_data_1`, `_2`, …) is fine as long as
the repo declares chunk counts in `transformers.js_config.use_external_data_format`.
Both shipped exports do.

## Shipping

| Model | Repo | dtype | Download |
|---|---|---|---|
| LFM 2.5 2.6B | `LiquidAI/LFM2.5-2.6B-ONNX` | q4f16 | 1.55 GB |
| Gemma 4 E4B | `onnx-community/gemma-4-E4B-it-ONNX` | q4f16 | ~5.2 GB |
| Gemma 4 E2B | `onnx-community/gemma-4-E2B-it-ONNX` | q4f16 | ~3.4 GB |

LFM 2.5 2.6B is the best quality per byte available: LiquidAI's own export, and
the only LFM2.5 published as ONNX. The Gemma pair carry the multimodal path.

## Queued — verified loadable, not shipped

These meet all four requirements and were checked against the Hub. Adding one is
a registry entry and nothing more.

| Model | Repo | dtype | Download | Note |
|---|---|---|---|---|
| LFM2 1.2B | `onnx-community/LFM2-1.2B-ONNX` | q4f16 | 0.76 GB | Previous LFM generation. Smallest option found anywhere. |
| Bonsai 8B | `onnx-community/Bonsai-8B-ONNX` | q4f16 | 4.76 GB | `Qwen3ForCausalLM`. Wants a discrete GPU. |
| Bonsai 4B | `onnx-community/Bonsai-4B-ONNX` | q4f16 | 2.34 GB | Half the download of 8B. |
| Bonsai 1.7B | `onnx-community/Bonsai-1.7B-ONNX` | q4 | 1.13 GB | No f16 4-bit export in the repo. q4 is the one entry that would run on a GPU **without** `shader-f16`. |

## Ruled out

### Sub-4-bit — blocked by the ORT kernel

Revisit only if onnxruntime-web gains 2-bit support.

- `onnx-community/gemma-4-E2B-it-qat-mobile-ONNX` — publishes only q2f16 for
  `embed_tokens`, `decoder_model_merged`, and `audio_encoder` (`vision_encoder`
  is fp16). Shipped briefly and failed in production with `bits must be 4 or 8`.
- `onnx-community/Ternary-Bonsai-{1.7B,4B,8B}-ONNX` — q2/q2f16 only. The
  conversions exist; ternary is exactly what the kernel refuses.

### No usable export

- **Maple Preview** — `deepgrove/maple-preview` is 40.45 GB of bf16 safetensors
  across 9 shards, custom `MapleForCausalLM` with `trust_remote_code`, and no
  ONNX at all. Its ternary weights are stored unpacked, which is why 20B
  parameters occupy 40 GB. The only browser build is
  `ProCreations/maple-preview-webgpu(-v2)`: 5.31 GB in a custom `.mwg` format
  with a hand-rolled WebGPU runtime — not ONNX, not loadable here. A 4-bit ONNX
  re-export would land near 10 GB, *larger* than the 2-bit port it replaced.
- **Bonsai 27B** — GGUF, MLX, and AWQ only; no ONNX export exists from anyone.
  Converting the ternary weights would still require re-quantizing to q4
  (~14 GB) to clear the kernel limit, which is past what a browser should pull.
- **Gemma 12B** — two ONNX conversions exist, both in the onnxruntime-genai
  layout (`{precision}/{device}/{component}/model.onnx`), neither with a
  `transformers.js_config`:
  - `justinchuby/gemma-4-12b-onnx` — Q4_K_M at 7.3 GB decoder + 2.0 GB
    embedding ≈ 9.3 GB.
  - `Prince-1/Gemma-3-12b-pt-Onnx` — a single 25.7 GB graph, unquantized, and
    the base model rather than the instruction-tuned one.

  Even a correct 12B export would be ~7–9 GB of download needing ~8 GB of VRAM,
  against Gemma 4 E4B at 5.2 GB, which is already the heaviest thing we ship.

## Converting a model ourselves

Nobody is going to publish the exports we want, so this is on the table — but
not on a developer laptop. A 12B export means pulling ~24 GB of bf16 weights,
materializing the graph with roughly twice the model size resident, then a
separate quantization pass over a ~24 GB intermediate. That needs a GPU box or a
hosted runner; CPU-only with ~21 GB of RAM will thrash or OOM. Text models up to
about 2B are plausible locally, in hours.

The pipeline is `optimum-cli export onnx` followed by the transformers.js
quantization script, emitting the `onnx/model_q4f16.onnx` layout and a
`transformers.js_config` with correct chunk counts. Publishing is a separate
step and belongs to whoever owns the Hugging Face account — it pushes under
their name and needs their token via `huggingface-cli login`.
