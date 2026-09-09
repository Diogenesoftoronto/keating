# Learning to teach report

Public URL: https://learning-to-teach-report-production.up.railway.app/

The report is a dedicated Railway service (`learning-to-teach-report`), separate from the main Keating app. Only the allowlisted static snapshot is deployed. No account credentials, original learner conversations, model credentials, or checkpoint paths are in the public bundle.

Build the isolated interactive previews from Keating's actual OpenUI compiler:

```sh
rtk proxy bun build scripts/report-site/openui-preview.ts --target browser --format esm --minify --outfile web/public/reports/learning-to-teach/openui-preview.js
rtk proxy env UV_CACHE_DIR=/tmp/keating-uv-cache UV_PROJECT_ENVIRONMENT=/home/diogenes/Projects/keating/.keating/training-venv uv run --project scripts/training --locked --no-sync python scripts/report-site/package.py --output-dir .keating/outputs/railway-report-next
```

Use an unused output directory; packaging checks the downloadable synthetic catalog matches the source and explorer conversations. Deploy the snapshot to the report service using the authenticated Railway CLI or the equivalent upload API, then verify deployment SUCCESS, HTTPS root, health, all public file hashes, and missing-file 404. Never deploy this snapshot to the main Keating service.

For CLI uploads use `railway up <snapshot> --path-as-root --no-gitignore` with the explicit report project, environment and service IDs. Disabling gitignore is appropriate only for this already allowlisted snapshot; otherwise inherited ignore rules can omit the packaged mascot. Do not use this flag to upload the repository root.

The three-arm comparison is `.keating/outputs/training/three-arm-comparison/comparison.json`: seven predeclared scenarios, 21 traces, 33 completions. `scripts/training/compare_checkpoints.py` uses uv/Typer, identical current prompt/tools, and the shared $100 pilot reservation ledger. It makes inference requests only and stops at native tool requests. These checkpoints predate the new OpenUI interaction dataset. Public report observations include failures as returned by the native renderer.

Preview controls are a small report renderer over canonical compiled documents, not the full application UI. They use local component state only, do not execute tools or call a model, and cannot establish browser persistence or model improvement. All authored OpenUI messages compile in tests; a browser interaction pass still needs an available browser session.

## Recorded prompt context

Run `update_prompt_context.py` through the locked training uv environment after refreshing interaction data. It verifies the historical prompt hash against all three evaluation arms and the OpenUI compilation manifest, and publishes only the exported default prompt without learner, startup, course or runtime data. The later application revision is labeled separately and must never replace historical context. Each comparison column and the training conversation explorer can expand the associated prompt. The discussion section distinguishes experiment rationale, observations, untested DPO/KTO alternatives, and estimated costs.

## Current v3.2 cohort

`export_benchmark_v3.py --cohort <run-root> [--cohort <additional-root> ...] --output web/public/reports/learning-to-teach/benchmark-v3-results.json` exports the recorded CLI episodes, exact applied prompts, tool receipts, synthetic learner state and independently validated reviews. Pass original, resumed and explicit retry roots in that order, followed by the Tinker cohort and supplement roots. An exact subset of the frozen 23 cases can be merged only when every complete case object agrees. A completed answer cannot be replaced by a later attempt; only explicit provider failures can be superseded. The host interruption and superseded attempts remain disclosed.

The chronology is training → v1 contracts → v2 multi-turn probes → v3.0 real CLI → v3.1 ordinary dialogue → v3.2 profiles built from interactions. It is not a comparable score curve across changing definitions. Charts identify model developers separately from their serving transport. Numbers expose coverage and measurement details by hover, focus or tap; all conversation views retain prompt expanders and terminal interface receipts.

Native Tinker cache hits are unmeasured. Its uncached tariff scenario stays separate from cache-adjusted cost comparisons. Output-limited episodes retain their original reviews but have no aggregate semantic score. API and supplemental agent reviews have separate provenance and are uncalibrated. Interface rejection and saved learner feedback are inspectable independently of teaching scores. The current cohort contains base models and makes no new training calls.
