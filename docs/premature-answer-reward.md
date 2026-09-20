# Measured premature-answer readout

The first operational feature head is now fitted to real Qwen activations:
**premature answer delivery under an explicit hint-only request**. The frozen
layer-12 SAE readout passed the acceptance criteria declared before extraction.
This is a small authored-concept experiment, not a human-learning result.

## Exact observer

Use `Qwen/Qwen3.5-9B-Base` at
`68c46c4b3498877f3ef123c856ecfde50c39f404`, with
`Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50` at
`7bb2370d360e566b2d8acb8b3d15a0b2b88f52a8`.
The selected file is `layer12.sae.pt`, SHA256
`2cea61ef74a4d33d59329f7e3d1ddfb4a8cdf3c24acdbc05fc26209679a262d8`.
The hook is `language_model.layers.12`, residual after the block. Hidden width is
4,096; dictionary width is 65,536. Encoding is affine followed by signed TopK50,
without an added ReLU or centering step. This follows the
[published dictionary convention](https://huggingface.co/Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50).

The run used actual CUDA BF16 computation, Torch 2.8.0+cu128 and Transformers
5.3.0. All 120 forwards completed; exact tokenizer IDs and offsets matched the
local preflight. The Runpod pod was terminated and a subsequent GET returned 404.

## What was measured

Thirty self-contained authored tasks each have four contrasts: the same worked
answer and the same hint, each under a hint-only request and a worked-solution
request. Only the answer under a hint-only request is positive. A hint under a
worked-solution request is negative for premature delivery; that does not mean it
fulfills the request. Independent agent review found no label disagreements or
mathematical errors. These are not copied TutorMoments records or human annotations.

All four examples from a task remain together. A hash ordering fixed 18 training,
six calibration and six test families before label assignment: 72/24/24 records.
The author knew the experimental design; this is not blinded annotation. Domains
and request vocabulary overlap across partitions.

Text sees the full allowed learner request plus response. Raw and SAE features
pool only the actor's response tokens, conditioned on that same prefix. All three
use the existing fixed L1 logistic C=1 recipe, train-only preprocessing, and
calibration-only sigmoid fitting. No layers, thresholds or examples were selected
from test results.

| Readout | Test Brier ↓ | AUC ↑ | Accuracy at 0.5 | Nonzero weights |
| --- | ---: | ---: | ---: | ---: |
| Text | 0.18750 | 0.5000 | 18/24 | 0 |
| Raw activation | 0.07621 | 0.9722 | 20/24 | 33 |
| SAE | **0.03806** | **1.0000** | **23/24** | **19** |

The text fit collapsed to its intercept under this recipe. This is not a claim
that SAE features outperform a well-tuned text classifier. The SAE's calibration
error was 0.09086; its family-bootstrap 95% Brier interval was [0.01695, 0.05668].
Six test families give limited uncertainty resolution. The missed example was
the hint-only division answer (probability 0.454).

For every held-out task, changing the request from worked solution to hint only
increased the score on the identical worked answer. For example, the fraction
reduction answer moved from 0.154 to 0.996. Hints remained below 0.5 in both
contexts. This demonstrates contextual classification in this corpus; it does not
establish a causal feature, artifact transfer, or general pedagogical quality.

## Reward and training boundary

[The v2 producer](../scripts/training/native_feature_rewards_v2.py) implements
one action-level penalty:

`reward = -penalty × explicit_hint_only_gate × calibrated_probability`

It requires a cited original request, independently checked correctness, a frozen
reward card, actual measured native features, and replay of the exported probe's
prediction. Missing evidence abstains. It emits the existing F+S consumer envelope
without changing actor token IDs or giving learner/tool tokens a policy loss.
The [API contract](native-feature-rewards-v2.md) describes the exact inputs.

Before fitting, this experiment required Brier ≤0.18, ECE ≤0.20, AUC ≥0.75 and at
least six held-out task families. The fitted head passes. Application remains
restricted to the reviewed text scope; a low penalty is not a positive teaching
or learning reward.

The later [matched three-arm experiment](native-combined-results.md) completes
F-only, S-only and F+S updates from one starting checkpoint on two further native
actions, with actual subsequent simulated feedback and a numerical notebook.

On 14 September, the measured feature reward first reached a hosted **F-only + anchor
update** on an actual native tutor action. The learner requested a starting hint
for `63 - 28`, leaving the difference unstated. The selected response explained
subtracting 30 and adding back 2, then asked the learner to calculate `63 - 30`.
Independent model review accepted its arithmetic and answer withholding. It was
longer than the requested one sentence; this narrow feature does not score brevity.

The frozen observer processed 156 input tokens and selected 49 response tokens.
Their signed TopK features pooled to 1,204 distinct coordinates. The calibrated
head returned **0.08369225**, producing action advantage **−0.08369225** under the
previously frozen penalty rule. This small negative value is a residual risk
penalty, not a claim that the correct hint is a bad teaching action.

Tinker acknowledged one optimizer step over the **50 original actor completion
tokens**, with F=1, S=0, anchor=0.1 and learning rate `1e-5`. The feature loss was
0.08367753; the weighted anchor contributed 0.00006140, giving total loss
0.08373893. All 1,385 context targets had exactly zero log-probability gradient.
Independent arithmetic replay matched the logged completion gradients within
`1.37e-10`. Importance ratios ranged from 0.89176 to 1.16199, inside the declared
clipping interval. Both training and sampling checkpoint receipts were saved.

The old initial checkpoint had expired. This run created a fresh rank-32 initial
adapter from the same base, retained the original behavior probabilities, and
passed the unchanged log-ratio bound of 2 before optimization. It is a distinct
initialization, not a continuation of the previous S-only checkpoint.

The separate S+anchor update used 196 actor tokens and feature weight zero. No
later learner event exists for this new selected hint, so S stayed zero here.
The first 512-token capture failed to finish; the second capture's first hint had
unknown correctness. Both remain archived and excluded from this update. The
mixed tutor/simulator journal was bound by actual tutor response IDs; simulator
tokens were not relabeled as tutor targets.

![Measured native feature-reward update](../.keating/native-learning/premature-answer-native-measurement-v1/native-feature-update.png)

Open [the offline marimo workbench](../analysis/premature_answer_reward.py) with
`uv run --with marimo==0.23.1 marimo edit --sandbox analysis/premature_answer_reward.py`.
It reads these actual results and lets you vary the feature and anchor weights
against recorded gradients. Its controls never invoke a provider or change the
saved model. The notebook declares NumPy, pandas and Matplotlib inline and passed
an end-to-end script smoke check.

The native GPU job completed and its pod was terminated; a fresh provider GET
returned 404. The training supervisor confirmed no remaining child processes.
The shared ledger reserves **$51.90 of $100**, including failed earlier grants;
this is conservative allocation accounting, not an invoice. No improvement,
transfer, retention, or combined F+S result follows from this one-action update.

## Local reproducibility artifacts

Generated data and runtime receipts are intentionally ignored by Git. On the
research workstation they are under `.keating/native-learning/`:

- `premature-answer-probe-v1/`: authored source, frozen splits, label provenance,
  checks and independent review.
- `premature-answer-execution-v1/`: exact observer plan, protocol, acceptance
  criteria, imported feature rows, exported coefficients, held-out predictions,
  and `probe-comparison.{png,svg}` / `request-contrast.{png,svg}`.
- `premature-answer-execution-v1/runpod-job/outputs.tar`: actual extraction
  archive, SHA256 `4caabc615df5d5d63ec22a643f9f4854686fde97013acbf3b0c5ece0f3246619`.
- Probe report canonical SHA256:
  `674abbbc6e91809ea9e8ea633b19157991e64166f7b12d88c935bae30b9eeec6`.
- `premature-answer-native-measurement-v1/`: actual per-token features,
  `measurement.json`, `reward-audit.json`, `update-plan.json`, `analysis.json`,
  `native-feature-update.{png,svg}` and `feature-update/consumer/result.json`.
  Update result hash:
  `25d1b1f364d932781f0bf7e54b4074cc731bb7b8eff98d8c15f5f0f61fe952ab`.
- `premature-answer-native-measurement-v1/feature-update/sampler-adapter.tar`:
  downloaded adapter weights and config, 378,419,200 bytes, SHA256
  `fbbfebc27ed09ba35afd7f9570170468ea90819621e1d34cec05a37cd6c51ac4`.
  This local copy survives hosted checkpoint expiry; it does not include optimizer state.

Next acceptance work remains the paired native pilot, a reliable learner model,
independent behavioral interventions, same-action F+S with actual subsequent
learner evidence, and held-out transfer/retention evaluation. The feature head
has earned a narrow offline experiment, not a deployment or general reward claim.

Relevant checks completed: 60 observer helper/manager tests, six corpus tests,
17 reward-v2 tests and 15 native-capture stage tests. The GPU extraction and
held-out metrics above are actual execution evidence, separately from those
deterministic tests. No human learning, retention, or checkpoint promotion is
claimed.
