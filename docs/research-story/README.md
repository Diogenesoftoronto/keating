# Learning from the next turn

Companion to Learning to Teach, reconstructed from Entire history and actual saved experiment records. The editable story, short funding brief, glossary, evidence audit and numeric probe summary live here. Visual source and allowlisted packaging scripts are in `scripts/report-site/`.

Build a fresh offline package:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script scripts/report-site/package_research_story.py --output-dir .keating/outputs/learning-from-next-turn-next
```

Open its `index.html` directly; fonts, scientific figures, trace controls and result filters work without network access. Use Print to produce the A4 layout. The full report includes 27 glossary entries. The dataset inspector includes attributed source excerpts beside native adaptations. The probe inspector exposes held-out authored records, fixed scores and a local decision-threshold control. No provider calls occur during packaging or inspection.

Optionally render the built `index.html` and `funding-brief.html` with headless Chrome, then make a final fresh package using `--pdf <report.pdf> --brief-pdf <brief.pdf>`. The PDFs become downloads with manifest hashes. The sibling ZIP is the complete portable package.

For Railway, compose the original verified deployed snapshot and this companion:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/report-site/compose_research_deployment.py --original .keating/outputs/railway-report-v17 --companion .keating/outputs/learning-from-next-turn-next --output .keating/outputs/railway-research-next
```

The composer verifies every input file against its snapshot, preserves the original report's data, scripts and styles, and changes one original header link to `/learning-from-next-turn/`. It copies only named verified files, never the research cache. `--live-index` can require the old snapshot to match a downloaded live index before composition.

Deploy only the composed snapshot to the dedicated `learning-to-teach-report` Railway service using explicit project/service/environment IDs and `--path-as-root --no-gitignore`. Verify deployment SUCCESS, both report pages, every public file hash, health, and missing-file 404. This command must never upload the repository root or target the main Keating application.

The manuscript leads with pipeline feasibility and an initial output check. Repeated qualifications are collected in its limitations section. The three-arm comparison preserves the recorded F/F+S verdicts and S-only regression.

The generation revision adds `generation-examples.json`: 30 actual continuations
from six complete paired tasks, original generated IDs and two blinded reviews.
The generation inspector filters task and intervention condition; its token-change
indicator is exact and its verdict table preserves both reviewers. The figures
compare controlled outcomes and published training exposure. See
`docs/controlled-generation-results.md` for the incomplete-run boundary and the
pinned review workflow. The corresponding notebook runs entirely on the saved
public export. Publication receipts are recorded in `PUBLICATION.md`.


The v4 extension adds `benchmark-frontier.md`, `frontier-example.json`,
`benchmark-diagnostics.json` and `probe-spans.json`. To rebuild those public
projections from the saved local pilot and measured probe artifact:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --no-project --with typer python scripts/report-site/curate_frontier.py
```

Then run the existing package command. Checked-in public projections allow the
report to build without private experiment caches. The workbench preserves exact
source choices and six actual response slices. Its controls make no model calls.
The separate contribution view reproduces a saved 49-token probe score. See
`PUBLICATION.md` for the live verification and PDF receipts. The stage table uses
the original contract/readout/intervention/baselines/continual milestone sequence.

The v4.1 revision adds `contextual-teaching.md`, the exact frozen v4.0/v4.1
case files and manifests, and generated `dialogue-revisions.json`. Packaging
verifies both source hashes and all 73 changed messages across twelve cases.
The case selector exposes every before/after pair; the printed report shows
the first case. A second interactive example demonstrates context-dependent
reward signs using explicitly authored labels. It makes no classifier calls.
The original v4.0 pilot retains its historical results. The contextual training
chapter describes the locally tested integration, separately from future
readout fitting and hosted updates.
