# Keating terminal workshop

[Textbook](https://textbook.sh) provides the terminal equivalent of Storybook:
a searchable catalog with a live OpenTUI preview in the browser or a native
terminal. Keating's web stories remain in `web/`; terminal stories live here.

## Start

Install the root dependencies with `devenv tasks run keating:install`, then:

```bash
devenv tasks run keating:textbook
# Browser: http://127.0.0.1:6007
devenv tasks run keating:textbook-tui
devenv tasks run keating:check-textbook
```

`devenv up` includes the `textbook` process alongside `storybook` (6006).
For direct Bun use: `bun run textbook`, `bun run textbook:tui`, or
`bun run textbook:check` from the repository root. Use the individual task to
work on terminal components without starting the other development processes.

The scripts scope discovery to this directory, so React Storybook files are
never imported into the terminal workshop. The catalog uses production
`SacredTranscriptRenderable`, `createSacredSidebar`, and presentation profiles
with authored fixture data. It does not start Pi, call inference, load real
sessions, or require credentials. Selecting an action or session updates the
fixture preview; it does not invoke the application's account or file actions.

## Catalog

- Transcript: empty, teaching conversation, Markdown table/code, streaming,
  tool failure, light theme, and ASCII fallback.
- Sidebar: session branches, empty sessions, narrow layout, light theme, and
  ASCII fallback. Navigation and session activation update the preview.

Use Textbook's viewport controls to inspect narrow and wide terminals. Click
the preview to focus it; Tab and arrow keys explore interactive controls.

Textbook 0.2.0 declares OpenTUI 0.5.x; Keating uses 0.4.3. The root override
keeps the workshop and application on the same 0.4.3 runtime. The check task
loads every story and renders it at two sizes to catch incompatible APIs.
Recheck the workshop when upgrading either dependency. Workshop code is outside
`src/` and excluded from the shipped CLI build.

## Add a story

Create `*.stories.ts` in this directory, export metadata with `defineStories`,
then export named `story` definitions. Render the production component with
deterministic fixture state. Release event listeners and native styles when
its root is destroyed. Avoid real sessions, credentials, network calls, and
filesystem mutation. Run `keating:check-textbook` after changes.

## Documentation visual coverage

The learner guides now include 21 current captures: desktop and narrow web
classrooms, onboarding, model picker, custom provider, offline download and
ready states, credit recovery, graded quiz, flashcard review, assignment and
delivery indicators, workspace files, and three real terminal views
(conversation, model picker, and session tree). The
[terminal guide](../docs/sacred-tui.md#component-workshop-and-still-frames) also
displays the current TUI stills.

The [capture notes](../scripts/docs-site/README.md#screenshot-contract) and
[provenance manifest](../scripts/docs-site/assets/screenshots/captures.json)
identify the sources. Component screenshots use authored fixtures; classrooms
restore an authored lesson through local session storage; terminal screenshots
run the actual host with an isolated demo provider. Native desktop/mobile
captures and real payment, download, and course delivery verification remain
outside this set. Older review images retain historical captions.

Run `rtk devenv tasks run keating:docs-screenshots` to recapture the current set,
update the guides' image dimensions and capture dates, and rebuild the docs.

Existing tools can supply real captures: `video/shared/capture.mjs` captures
Storybook stories or app routes, `scripts/capture-web-clips.mjs` records web
fixture flows, and `docs/tui-collaborative.tape` / `docs/tui-onboarding.tape`
record the source TUI with VHS. Textbook adds a repeatable way to inspect
terminal component states; those previews are fixtures, not end-to-end app proof.

When refreshing docs images, record source commit, capture date, viewport,
surface, fixture/live status, and visible state alongside the image. Preserve
accurate captions and alt text. Current screenshot validation checks dimensions
and captions but does not establish release freshness. The workshop runs
locally; it does not publish a new service.
