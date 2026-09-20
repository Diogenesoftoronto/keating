# Evidence audit: Learning from the next turn

Report boundary: 14 September 2026. This is a working-tree research snapshot, not a release or a complete implementation of Revision 2. Static packaging makes no provider calls. The repaired controlled-generation run yielded a validated six-task partial archive, followed by blinded output review.

## History reconstruction with Entire

Read-only Entire local session metadata and checkpoint records were inspected for session `01a09a1a-e577-7681-a64c-a576ae11485e`. The earlier Claude session is `e8d7a655-42f3-480a-8e5f-bb8a5724d167`; its conversation was imported into the later session. The earliest corroborated marimo request is 13 September 2026, 08:31 UTC. Imported session/model labels and repeated token totals do not prove independent work or compute use.

| Entire checkpoint | History it corroborates |
| --- | --- |
| `08fb9f1b3c8351d78db616f32db0c1bb9f126de2` | Sep 13: preserving 520 vanilla TutorMoments records and twelve synthetic ordinary/reopen episodes from six moments. |
| `a01e84ded12e959adec49c706f4004271cca84ad` | User supplies the Revision 2 manuscript: native scenarios, a separate learner simulator, frozen observer, feature/hindsight supervision, and staged evaluation. |
| `857bb44d131d9f0e41d2ff692d3585375a9cb8ab` | Five-source adapters, 826 development and 4,766 reference admissions, twenty plumbing executions, and the first rejected model episode. |
| `917c796c74d2d7a392f9849b94eb4f0022a7ea65` | Sep 14: native SAE-derived F-only update on fifty original completion tokens. |
| `a2138bb16e81d16e464a246e42dbd8bbb1d0df42` | Sep 14: matched F-only/S-only/F+S updates on 37 targets; preceding probe work and failed model-quality gates remain in the record. |

Fine-grained anchors in the last checkpoint's stored `full.jsonl`: line 3 (marimo), 893/924 (native adaptation and preservation of vanilla), 1181 (other datasets), 1465 (admissions), 1519 (plumbing receipts), 4121 (both broader canary arms fail), 5242 (SAE/rewards priority), 6267 (first F update), 6822 (three updates).

An authenticated Entire semantic query returned no hits for the combined phrase “TutorMoments SAE feature hindsight.” The local checkpoint records supply the chronology. Search absence is not history absence.

The fresh behavior responses were generated at 20:28–20:29 UTC on Sep 14, with their summary at 20:36 UTC. They postdate the last inspected checkpoint (20:16 UTC). Their completion is established by saved run results and locked review artifacts, not retroactively attributed to that checkpoint.

## What the evidence establishes

| Claim | Primary local source | Scope |
| --- | --- | --- |
| Five adapters and 826 / 4,766 admissions | `docs/native-scenario-adapters.md`, source cache and replay validation | Adapted starting states; counts are records with family overlap, not learners or executed lessons. |
| 20 plumbing executions | `docs/native-research-run.md`, saved production episode receipts | Real runtime with authored policies; assessments unknown. |
| Insufficient SAR labels; source-action probe; failed broader canaries | `docs/plans/native-research-completion-audit.md` | Historical Sep 13 snapshot, qualified by Sep 14 follow-ups. |
| Pinned observer and 19-weight readout | `docs/premature-answer-reward.md`, probe-summary.json | 120 authored contrasts, six test families, no human outcomes. |
| Three real updates | `docs/native-combined-results.md`, native-combined-update.json | Two native actions; one step per sibling arm; actual simulated consequences. |
| No improvement in fresh comparison | `docs/checkpoint-behavior-results.md`, feature-hindsight-evaluation.json | 64 responses; eight authored tasks; automated blinded grading. |
| Controlled generation | `premature-answer-generation-v2/runpod-job`, verified partial archive and bound review bundles | Six complete five-condition tasks; time-bound stop before two capability tasks. V1 failed before generation and remains preserved. |

The numerical files contain selected public summaries, attributed source/native examples and authored held-out probe records. They are not the complete private reproducibility archive. The build records their source-byte hashes. Full runtime requests, exact hosted sampler identities, raw source records and private grader mappings remain outside the package. Hashes establish identity with retained artifacts; they cannot make an unavailable private artifact independently inspectable.

## Controlled-generation attempts

The later controlled-generation worker completed dependency setup and loaded 759/759 backbone weight entries, then failed during output-head initialization. The preserved error is `ValueError: Expected bounded regular artifact` while reading `model.safetensors.index.json`. A verified Hugging Face cache path remained unresolved before a regular-file reader rejected its symlink form. The index size was 79,657 bytes, below the bound. The deleted pod prevents a direct postmortem inspection of its filesystem metadata.

The archive records zero forward passes, zero forward tokens and zero completed trials. This attempt supplies no intervention output. The supervisor terminated its pod at 21:42:13 UTC on 14 September. Independent authenticated provider reads at 21:45:24 UTC returned 404 for that pod and an empty pod list. Its $1.50 reservation remains in the shared ledger.

The sealed job hash is `f9ef8c2cf7ec2d8f22c5eee2c528d47929f9401a89bdb308c034eb31bcc258a3`; the archived output SHA256 is `e70ddcc91e7701839bcdad3682ad57d42ab264b6b26d8ed8b20e99cfa86983ed`. The behavior-review protocol was fixed before any generated output was inspected.

### Repaired worker and partial-run review

V2 retained the same model, SAE, layer, prompts, criteria, epsilon, controls and token limit. It resolved verified model-cache symlinks inside the pinned snapshot before the strict file read. Nineteen generation-job checks, including the real indexed-head symlink path and cache-escape rejection, passed before dispatch. All 31 fingerprinted V1 artifacts remained unchanged.

V2 began at 21:55:52 UTC and its supervisor terminated the pod at 22:37:52 UTC, reserving cleanup time inside the 45-minute allocation. The process exit was 124. The import reports `partial_valid=true`, `experiment_valid=false`, six complete trials, and no experiment validation error. The parent grant status remains `failed_unknown`; a usable partial archive does not change the full job into a success. A fresh authenticated provider inventory confirmed zero pods and the owned pod absent. The shared ledger has zero active grants.

The archive preserves 30 responses: four hint tasks and two worked-answer tasks, each under all five conditions. Both capability tasks are missing. Every response reached the 96-token limit. Twenty-four calibration forwards supplied a lower-median residual norm of 30.192398071289062. Unknown in-flight work remains unreported; completed groups establish lower bounds of six attempted families and 30 attempted responses.

Before output inspection, a policy at 22:12:37 UTC specified that only import-validated complete five-condition groups could enter a partial review. The original criterion wording and planned denominators remain unchanged. Preparation verified prompts and token IDs, then decoded the pinned tokenizer without removing special tokens or normalizing whitespace. Two separate agents received only opaque IDs, learner requests, frozen criteria and exact output. Exact duplicate triples were reviewed once per reviewer: eight unique triples expanded to all 30 original response IDs with hashed mappings. Both judgments and disagreements remain in the exported data.

Job SHA256: `45e061585cc101edf3bdf51e05cc7709dfadf3d37aa7fd2f662f62f3928959a0`.
Archive SHA256: `d8e258529753fcb482f3000ec4a525f8fcafa6b64e18f0377f8fdabe2a99eb72`.
Partial result SHA256: `7d5c48db660328ecd8baf2052567dcf39f96bc38d1e106af0a979fe7371c7b8a`.
Preparation audit: `1a5fbc933c7fb3bfd72547be007a92f8b4d49562c751aa5486eb7655aeafb419`.

The [public generation export](generation-examples.json) contains the exact authored requests, raw generations, original generated token IDs, two reviews and final provenance hashes. Eighteen focused review tests passed, including complete/partial admission, source binding, role separation and missingness. Neither reviewer had the condition mapping or intervention hypothesis.

The selected positive and negative directions changed 2/6 and 1/6 token sequences; the random and comparison directions changed none. All condition verdicts match baseline: 0/4 hint compliance, 3/6 correctness, 1/6 all-three. Both reviews agree on all 90 expanded criterion judgments. Review-summary audit: `8f670a128dabb3f21ed6c71b329ee6e6c149f5186769dc08c3e0c07627cb17ea`.

## Key execution hashes

- Observer base revision: `68c46c4b3498877f3ef123c856ecfde50c39f404`.
- Matching SAE revision: `7bb2370d360e566b2d8acb8b3d15a0b2b88f52a8`.
- Layer-12 SAE file SHA256: `2cea61ef74a4d33d59329f7e3d1ddfb4a8cdf3c24acdbc05fc26209679a262d8`.
- Probe report canonical SHA256: `674abbbc6e91809ea9e8ea633b19157991e64166f7b12d88c935bae30b9eeec6`.
- Three-arm update protocol: `16c4593e587bc03bb0fa78ebb9e6f8a694b65be6a2ea41e035cd0cbb34fd1916`.
- Verified three-arm analysis: `9f033f7e3f5ddbadc5f2a550ed10c00ca6bc1c051e7d2768f930dcbd4b6415bd`.
- Fresh behavior suite: `d000d74d00a02b26181d23b246bb3f31c2e6a567c829f34046a6842dfc079e10`.
- Actual behavior results: `244ae4a055bee3ab9188579b069b2576355da10d0a0e81d5e231605446fbc369`.
- Locked grades: `10d2e2697fac1c45b470aaa8b0c15f1bb99b87ca3f05dd73490004382b92b36b`.

## Interpretation and attribution

The research question, native-scenario direction, reference/native separation, proposed architecture, and budget were supplied by Keith Noel. Implementation, corpus construction, checks, model-assisted review and report preparation used coding agents. “Independent” reviewers were separate agents, not independent institutions or a human educator panel. The manuscript's “we” describes this collaboration.

The walkthrough quotes the two actual authored-scenario tutor replies. Learner turns and the initial request are explicitly marked as paraphrases. It is a recorded trace explorer, not an interactive simulation or a complete unredacted session.

No human learning, delayed transfer, causal teaching feature, successful browser assessment, full 180-episode pilot, Persimmon integration, Voxq population validation, or continual-learning benefit is established. No checkpoint was promoted. The common starting weights were already feature-updated, not an untouched base or qualified SFT baseline.

The $61.30 / $38.70 figures describe conservative reservations under the new shared $100 cap after two $1.50 controlled-generation allocations. The first allocation gave a historical $59.80 / $40.20 snapshot. The earlier checkpoint-comparison snapshot held $58.30 / $41.70. Failed grants remain counted. They are not invoices, available provider credit, or total project cost. The prior Learning to Teach budget is a different historical period.

## Publication boundaries

This report is packaged separately from the original Learning to Teach content and published as its companion. Deployment success is recorded separately after verification; a successful local build is not deployment evidence. The original report remains available. Repository paths may refer to files not yet pushed; the packaged narrative, metrics, and this audit stand alone. The inspection data retains source attribution, license, revision, and transformation descriptions for selected excerpts. Complete source datasets and model weights are excluded.


## V4 extension · latest saved evidence

The [new chapter](benchmark-frontier.html) and [extension evidence](evidence-notes.html#v4-extension) add actual source-document delivery, v4 runtime failure discovery and exact token contribution inspection. The earlier 64-response controlled comparison is unchanged. V4 is a separate development challenge with one tested family and incomplete paired coverage; it must not be used as a before/after training comparison. A separate model reviewer graded the completed episode 4/8, with exact original quotes and validated case/result hashes. This is not human or calibrated expert review.

The shared ledger was read after the v4 pilot: $68.30 reserved, $31.70 unallocated, no active grants. The pilot's $4 reservation remains counted. Offline replay and publication builds do not make research-provider calls. The 27B extraction and live sequential curriculum remain unrun.


## V4.1 and contextual training revision

The new [chapter and inspector](contextual-teaching.html) derive all 73 before/after learner turns directly from the frozen 4.0.0 and 4.1.0 case files. Packaging checks the source hashes, unchanged family membership and step kinds, and the changed message count. Both manifests and the exact authored case files are included. No new model output is fabricated or scored under the changed suite. Existing pilot, output-comparison and probe-span exports remain byte-identical.

Training verification from the implementation turn: `test_native_contextual_rewards.py` passed 13 tests in its pinned CPU Torch environment; `test_native_custom_update.py` passed 29; `test_native_feature_rewards_v2.py` passed 17 with NumPy and scikit-learn. These 59 checks include actual local loss gradients, prompt masking, preserved target IDs, protected families, reconstructed hashes and a subprocess classifier-to-plan round trip. The classroom labels and provider envelopes in those tests are authored fixtures. No hosted update or new fitted contextual probe resulted from these checks.

Entire status was checked for session continuity during publication preparation. Its aggregate imported token counter is not used as a measure of work or cost. Current source files, frozen manifests and saved experiment receipts establish the claims in this revision. The new reward illustration is labeled as authored and performs no inference.
