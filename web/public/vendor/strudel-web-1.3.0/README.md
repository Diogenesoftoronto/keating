# Strudel web runtime 1.3.0

Unmodified distribution files from `@strudel/web@1.3.0`, published by the Strudel project.

- Upstream: https://codeberg.org/uzu/strudel
- Package: https://unpkg.com/@strudel/web@1.3.0/
- Integration API: https://strudel.cc/technical-manual/project-start/
- Visual concepts: https://strudel.cc/learn/visual-feedback/
- License: AGPL-3.0-or-later, included in `LICENSE`.
- `index.js` SHA-256: `265cae9cf769a7dc2c1ac253784fce80fef5062db9a1aac5be7fa5f205af5e86`.

Keating loads the runtime only in an opaque sandboxed iframe. Examples use synthesizers and do not fetch samples. Audio starts only from the iframe's Play button. Source `web.mjs` is retained alongside the upstream bundle; the complete package source and its dependencies remain available from the upstream repository.

The compact web distribution does not include the website's drawing widgets. Keating draws the live pattern's `queryArc()` events and the runtime's `getAnalyzerData("time", 1)` samples directly. Scope patterns route through `.analyze(1)`; controls re-evaluate the same Strudel pattern with the selected numeric values. These views use actual scheduled notes and audio, without decorative or synthetic signal data.
