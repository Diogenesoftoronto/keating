# Optional observer profiles

The generic `scripts/training/observer_extract.py` supports two exact frozen
observer/dictionary pairs. Omitting `--profile` keeps the existing 9B selection.

| Profile | Observer checkpoint | Qwen-Scope dictionary | Hidden / SAE width / Top-K | Layers |
| --- | --- | --- | --- | --- |
| `qwen3.5-9b-base` (default) | `Qwen/Qwen3.5-9B-Base` | `Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50` | 4096 / 65536 / 50 | 0–31 |
| `qwen3.5-27b` (optional) | `Qwen/Qwen3.5-27B` | `Qwen/SAE-Res-Qwen3.5-27B-W80K-L0_50` | 5120 / 81920 / 50 | 0–63 |

The [official 27B dictionary card](https://huggingface.co/Qwen/SAE-Res-Qwen3.5-27B-W80K-L0_50)
specifies this exact pair, dimensions and layer range. Its post-trained observer
checkpoint has **no `-Instruct` suffix**. The
[published config](https://huggingface.co/Qwen/Qwen3.5-27B/raw/main/config.json)
also declares a 5120-wide, 64-layer `qwen3_5_text` model. Metadata checked
2026-09-14; no 27B weights were downloaded or executed for this patch.

The observer is frozen with `requires_grad_(False)` and captured under the existing
inference-mode hook. The actor remains independently selected and trainable under
the existing contracts; choosing this observer does not choose or load an actor.
An actor such as `thinkingmachines/Inkling-Small` need not share the observer's
checkpoint, hidden size or SAE. This patch adds no actor integration.

## Generic extraction and validation

Use the existing projection JSON contract and supply actual immutable 40-character
model, tokenizer and SAE repository revisions plus the selected layer's 64-character
SHA-256. The parent-provided [27B candidate metadata](../scripts/training/observer-27b-candidate.json)
records actual Hub API revision/LFS metadata: model and tokenizer commit
`fc05daec18b0a78c049392ed2e771dde82bdf654`, SAE commit
`13d4221569f7ca5d3c1e605e3e3dc95117e4807c`, and `layer31.sae.pt`
(3,355,793,787 bytes) with the SHA-256 below. Its IDs, dimensions, layer/module,
and pins validate against the profile. No tensor bytes were checked locally.

Layer 31 is a mid-depth engineering candidate, with no held-out performance-based
selection. This JSON is **candidate metadata, not an extraction manifest**;
extraction and new probe fitting/calibration/evaluation remain pending. Pins are
explicit arguments, not new defaults. With the existing extraction dependencies:

```sh
rtk proxy python -B scripts/training/observer_extract.py INPUT.json OUTPUT.json \
  --profile qwen3.5-27b \
  --model-revision fc05daec18b0a78c049392ed2e771dde82bdf654 \
  --tokenizer-revision fc05daec18b0a78c049392ed2e771dde82bdf654 \
  --sae-revision 13d4221569f7ca5d3c1e605e3e3dc95117e4807c \
  --sae-sha256 5d0d9628059f55bf643c435409b62ac726737a5413492bb475545fd696a19053 \
  --layer 31 --module language_model.layers.31 --validate-only
```

`--validate-only` checks the profile, pin formats, exact module/layer and projection
before importing a tensor runtime. It reports the chosen identities and dimensions,
loads no weights and writes no artifact. Removing it uses cached pinned weights;
the existing `--allow-download` remains an explicit opt-in. Validation-only does
not establish that a revision belongs to a Hub repository or that cached bytes
match a hash. Actual loading resolves the selected repositories at those revisions,
checks the SAE file hash and all four tensor shapes, validates the model config,
and rejects incomplete checkpoint loads or a non-decoder module.

Model and tokenizer revisions remain independently pinned, as in the 9B path.
The hook stays exactly `language_model.layers.N` with `layerN.sae.pt`; signed
Top-K encoding, text serialization and pooling are unchanged. No chat template
is applied merely because the checkpoint is post-trained.

New manifests include `observer_profile` and SHA-256 pins for `observer_core.py`,
`observer_extract.py` and `observer_models.py`. The generic validator accepts
legacy 9B manifests with their original two-file implementation pin set. Missing
profile metadata defaults to 9B; it never infers 27B from shapes or model names.
Callers can explicitly require a pair and previously declared pins:

```python
from observer_report import validate_manifest

validate_manifest(manifest, profile="qwen3.5-27b", expected_pins={
    "observer_revision": model_commit,
    "tokenizer_revision": tokenizer_commit,
    "sae_revision": sae_commit,
    "sae_sha256": layer_sha256,
})
```

IDs, dimensions, layer, module, SAE filename and supplied expected pins must all
agree. The report CLI also accepts `--profile qwen3.5-27b` to constrain the
manifest in its existing four-file receipt-backed job format. It does not turn
a standalone extractor JSON file into a completed remote-job receipt.

**9B probes cannot be reused on 27B.** Re-extract observations and fit/calibrate
new probes against the exact 27B model/tokenizer/SAE revisions, layer, file hash,
serialization and feature dimensions. A shared coordinate number does not carry
shared meaning across dictionaries. Profile validation does not establish probe
validity, psychological meaning, human retention or transfer.

## Unsupported legacy job paths

This is generic local extraction/manifest support, not a complete 27B remote job.
Legacy remote behavior remains restricted to 9B:

- `observer_runpod.py`: `MODEL_REVISION`, `SAE_REVISION`, layer pins,
  `gpu_command`, the manager's expected 9B IDs/dimensions and row validation stay
  pinned to 9B. `SOURCE_NAMES` and the bootstrap archive allowlist now include
  `observer_models.py` alongside `observer_core.py` and `observer_extract.py`.
  The manager validates all three implementation pins.
- `observer_experiment.py`: `declaration` still requires the legacy 9B aliases,
  layers below 32 and coordinates below 65536.
- `observer_experiment_job.py`: `load_layer_reusing_model` and sweep execution
  still use `SAESpec()` (9B). Its source inventory and loader manifest validation
  now include the new module. Generation inherits the expanded source inventory.
- `observer_generation_job.py`: `verify_loaded_files` now requires all three
  extraction implementation pins; output-head and result validation still assume
  hidden size 4096.

Fresh legacy extraction, experiment and generation bundles carry the required module
and validate its hash. All four archive modes pass offline unpacking and isolated
import checks. Fixtures use three-file implementation pins and reject a missing or
altered module hash. This repairs packaging for the existing 9B paths; it does not
enable 27B remote jobs. Existing frozen bundles must not be silently rewritten;
prepare new source-pinned jobs for changed code.

## Local verification

`test_observer_models.py` exercises profile selection, mixed identity rejection,
dimensions, layer/module bounds, malformed/mismatched pins, high 27B coordinates,
preflight without runtime imports, and mocked loader/spec plumbing. It allocates
no model-sized fake weights. Existing `test_observer_core.py` exercises small CPU
tensors and a tiny Transformers wrapper; `observer_report.py --self-test` checks
authored receipt and plotting behavior. These checks do not prove real 27B
memory use, checkpoint execution, live remote deployment or learning effectiveness.
