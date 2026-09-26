# On-device model ledger

A static report covering every local-model measurement taken against this repository:
Needle 3, the potion static embedding family, KEV-0.8B, and hosted Jev. It also republishes
the preview post `docs/blog/needle-subject-routing.md` in full.

## Layout

| File | Role |
| --- | --- |
| `collect.py` | Reads each benchmark's result artifact into one canonical dataset. Raises on a missing input. |
| `markdown.py` | Small deterministic Markdown renderer for the published post. |
| `build.py` | Renders `public/` from the collected data. |
| `site.css` | Keating's paper/ink/phosphor palette, matching `web/public/reports/learning-to-teach/report.css`. |
| `Caddyfile`, `Dockerfile`, `railway.toml` | Static hosting with `/healthz`, matching `scripts/report-site/`. |

No figure in the rendered pages is typed by hand: `build.py` reads everything from
`collect.build()`, which reads the result files the harnesses wrote. If an artifact is
missing the build fails rather than shipping a gap.

## Build

```sh
rtk proxy python3 scripts/on-device-site/build.py
```

That writes `public/` with `index.html`, `methods/`, `blog/needle-subject-routing/`,
`data.json`, `site.css` and `robots.txt`.

## Regenerating the inputs

The harnesses live under `.keating/tmp/` because they need the pinned Needle runtime, a
real TypeSafe credential, or the real captured corpus. They are reproducible but are not
part of the deterministic test suite. `/methods` on the built site lists which harness
wrote each artifact.

## Deploy

```sh
rtk proxy railway up --service on-device-ledger --path-as-root scripts/on-device-site --detach
```

Poll to terminal `SUCCESS` before treating the deployment as live, then verify `/healthz`,
every page, and a known-missing path returning 404.

## Boundaries

Agreement between judges is agreement, not correctness. Benchmarks over archived
transcripts and synthetic learners do not establish human learning. Every page states
where its evidence stops; keep those statements when editing.
