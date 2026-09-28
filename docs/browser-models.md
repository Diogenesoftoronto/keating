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
| MiniCPM5 2B (default) | `RASMUS/MiniCPM5-2B-ONNX` | q4f16 | ~1.84 GB |
| LFM 2.5 2.6B | `LiquidAI/LFM2.5-2.6B-ONNX` | q4f16 | 1.55 GB |
| Gemma 4 E4B | `onnx-community/gemma-4-E4B-it-ONNX` | q4f16 | ~5.2 GB |
| Gemma 4 E2B | `onnx-community/gemma-4-E2B-it-ONNX` | q4f16 | ~3.4 GB |

MiniCPM5 2B is the default browser model. Its export includes the Transformers.js
external-data and fp16 KV-cache configuration, plus a compatible chat template.
The graph and weights total 1,834,210,185 bytes before tokenizer/config files.
The publisher reports WebGPU generation with Transformers.js 4.2.0; this is
publisher evidence, not a Keating browser smoke test. Requires `shader-f16`.
LFM 2.5 remains a smaller-download text alternative. MiniCPM5 and LFM are
text-only. Gemma E2B/E4B now forward actual image and audio data through their processor and encoder sessions; their reply is text.

## Diagnosing WebGPU failures

Browser-model load and generation failures preserve the original runtime error.
The console also emits a copyable JSON record tagged `[local-model] diagnostics`
with the model/dtype, runtime versions, phase, input-token count, output-token
limit, and ONNX's actual device features and buffer limits. These are device
limits, not a second adapter probe. Reports include device loss, the first error
observed on that device, and up to eight errors during the operation (with a
total count). Concurrent operations on a shared device can observe the same
GPU error. Keating does not explicitly collect prompts, replies, or tensor data
in these reports; original runtime error text is preserved.

For an `Invalid Buffer`/`mapAsync` failure, enable deeper runtime logging in
Keating's DevTools console **before reloading and loading the model**:

```js
localStorage.setItem("keating:local-model-debug", "1");
location.reload();
```

Enable **Preserve log** and all console log levels, reproduce once, and copy the
first runtime error plus the `[local-model] diagnostics` JSON. The debug flag
enables both Transformers.js session logging and ONNX debug/verbose logging.
Disable it afterward with `localStorage.removeItem("keating:local-model-debug")`
and reload. Debug logging can slow inference substantially.

Device observation starts after session creation exposes the runtime device;
initialization errors and errors captured internally by ONNX may only appear in
verbose logs. No captured GPU event means unknown, not that the GPU was healthy.
The diagnostic helper does not create another model or device and does not
override the runtime's error handler. A readback failure alone does not establish
unsupported WebGPU, missing FP16, or exhausted memory.

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

### MiniCPM5-2B LiteRT — browser runtime support pending

Checked September 10, 2026: [MiniCPM5-2B-LiteRT](https://huggingface.co/mlboydaisuke/MiniCPM5-2B-LiteRT)
is a text-generation export with int4 and int8 `.litertlm` bundles, not the
ONNX format used by this loader. We use the separate
[`RASMUS/MiniCPM5-2B-ONNX`](https://huggingface.co/RASMUS/MiniCPM5-2B-ONNX)
export of the same base checkpoint as the default instead.
The [LiteRT-LM JavaScript runtime](https://github.com/google-ai-edge/LiteRT-LM/blob/main/js/packages/core/README.md)
currently documents support only for the web-specific Gemma 4 E2B/E4B bundles;
general `.litertlm` files are not yet supported. Native CPU/GPU results in the
model card do not establish browser compatibility. Revisit the LiteRT option
after a compatible runtime is available. Treat this model as text-only: images need a vision model,
and audio needs an audio model or a successfully generated transcript.

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


## Gemma media path (September 28, 2026)

The pinned Transformers.js 4.2 runtime registers Gemma4ForCausalLM, whose multimodal forward path loads `vision_encoder` and `audio_encoder` sessions. The E4B ONNX artifact was checked through the Hugging Face blob API at revision `843f250f23bc91754def1e0f0db390dacd1e6b05`: both q4f16 encoder graphs and external weight files exist. Gemma input is rendered with the processor's own chat template and actual decoded images/audio. System, user and assistant turns are retained. Text-only browser models reject media instead of silently dropping it.

Bound the complete browser lesson to two images, one recording and 16 MiB of encoded media before decoding. The pinned Gemma processor extracts only the first audio waveform, so a second recording is rejected explicitly. Audio is decoded to mono 16 kHz with a 30-second limit and the decoder is closed. Text is bounded before decoding and the processor's actual input token count plus output allowance must fit a 4,096 token device budget. Output defaults to at most 512 tokens with thinking disabled. Video and generated speech are not implemented.

This remains the larger ONNX/WebGPU path, separate from the full native LiteRT model. LiteRT-LM's browser preview supports text-in/text-out only and uses a distinct web artifact; it does not establish native Gemma multimodal availability in a PWA. Pixel testing is deferred. Native host smoke verified actual Gemma text, image and WAV audio inference; browser media preprocessing/routing tests verify the integration boundary, not GPU inference or measured memory on Pixel. An actual AutoProcessor smoke with synthetic image and one-second audio emitted pixel_values, image_position_ids, input_features and input_features_mask alongside the tokenized prompt; no browser weights or GPU session were loaded.
