# Julia local decisions

Julia-1 is a 144M-parameter multilingual encoder with a trained decision head. It scores closed Choice, ordered Score, and Noul questions. It does not generate chat replies. The tutor model and the decision model are selected separately.

This is an experimental local option. The pinned ONNX adapter achieved 457/972 (47.02%) authored-label accuracy with literal argmax on Keating's frozen comparison, below the retained Jev and Kev runs. See the [accuracy, latency, throughput, and protocol comparison](benchmarks/julia-1-keating-comparison.md). Functional local execution does not make it an equivalent default reviewer.

Keating installs the official [FP32 ONNX export](https://huggingface.co/SupersonicLabs/Julia-1-ONNX) at revision `82a2fadf8fccfccdc5fd4e1009ba8f1a265eb7a8`. The graph, adjacent external weights, tokenizer, and tokenizer configuration total **614,135,099 bytes**. The shared manifest pins each file's byte length and SHA-256; installation resumes partial downloads and verifies every completed file. Native loading rechecks those hashes before creating the session.

Desktop uses ONNX Runtime Node **1.29.0**, CPU execution, four inference threads, one inter-operation thread, a 2,048-token sequence budget, and a 512-token question/options budget. Explicit research callers may request up to 8,192 tokens. A decision has 2–20 options; each option must fit 48 tokens. Requests exceeding the complete head or context budget abstain. Evidence and criteria are never silently truncated. The JavaScript encoder uses `@huggingface/tokenizers` **0.1.3** with the documented Metaspace split adapter; its encoding version is recorded in the source.

The native artifact identity includes `/keating-scorer-v1/ort-1.29.0-cpu`, the exact encoder version, and `/context2048-head512`. Browser WASM and mobile CPU use different identities because runtime changes can affect probabilities. Their calibrations cannot authorize native decisions. Bounds and execution settings should also be recorded in evaluation receipts.

The model produces genuine logits for every supplied option. Keating applies stable softmax and keeps the full unrounded probabilities. It does not use upstream presentation rounding, confidence one-hot conversion, generated prose, or fabricated label scores. Noul preserves descriptive false/true poles; Choice preserves criterion order; Score preserves its ordered rubric.

The web app uses ONNX Runtime WASM **1.29.0**, one worker thread, and strict 2,048-token context / 512-token question-and-options limits. Explicit installation saves the verified weights in 32 MiB CacheStorage chunks and also caches both bundled runtime assets. A completion marker is published only after the complete file checksum passes; loading reconstructs and rechecks the files. Completed files are reused after a paused download, while an interrupted file restarts. Removal clears the model cache; the shared runtime assets remain available. The real browser installation, WASM inference, and a fresh page reload followed by inference with networking disabled were verified on Linux. This does not establish mobile-browser performance or Pixel inference.

In desktop Settings, download Julia independently from the tutor. The standard installer includes its runtime; the offline edition additionally includes the verified model and tokenizer under `resources/offline/julia-1`, together with the upstream model card. The packaged app includes ONNX Runtime's Node-API addon and shared libraries outside ASAR. Current release targets use upstream prebuilt CPU bindings: Linux x64/arm64, Windows x64, and macOS arm64. Linux native bindings require the platform C++ runtime. CPU inference has been exercised on Linux x64; this is not a claim of installer or device verification on other platforms.

Cancellation refuses a late decision, including one from the last question in a batch. An already executing native ONNX call runs to completion before unloading releases its session; the JavaScript API does not provide immediate preemption. The manager unloads Julia before tutor generation and before MiniCPM scoring. The explicit unload control releases its model memory without removing downloaded files.

For an explicit CLI installation or read-only preview, bundle the helper with Bun and run it with Node. This also avoids a bare Bun process failing to find the C++ runtime on Nix installations:

```sh
rtk bun build scripts/julia-local.ts --target node --format esm --external onnxruntime-node --outfile .keating/tmp/julia-local.mjs
rtk node .keating/tmp/julia-local.mjs install /path/to/julia-cache
rtk node .keating/tmp/julia-local.mjs status /path/to/julia-cache
rtk node .keating/tmp/julia-local.mjs probe /path/to/julia-cache request.json
```

`request.json` contains `state`, `question`, `type`, and descriptive `options`, for example:

```json
{"state":"The learner explains that a denominator counts equal parts of a whole.","question":"Is the explanation relevant to fractions?","type":"noul","options":["The explanation is not relevant to fractions.","The explanation is relevant to fractions."]}
```

The probe reports `unvalidated-preview` and performs no teaching action. `src/judgement/julia.ts` provides an explicit local tier factory for CLI callers. Its production calibration loader verifies the exact artifact file hash, rebuilds the fitting result, and requires a validated group for this exact model identity.

Installation does not establish calibration or learning effectiveness. Automatic decisions retain the existing router gates. Calibration requires independently observed labels, disjoint fit/validation groups, and sufficient independent observations per exact question. The frozen comparison corpus has 25 workflow families; translations of one family are dependent. It cannot provide the required minimum of 20 independent fit groups plus 20 independent validation groups for each question. Benchmark comparison and raw previews therefore do not grant production action thresholds.
