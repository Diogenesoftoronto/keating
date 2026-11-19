# Keating design pass: rules for every page lane

You are one lane of a multi-agent build that implements a finished redesign in the Keating web app (React 19, TanStack Router, Panda CSS, Bun). Other lanes are editing OTHER files in the same checkout at the same time.

## Where
- Repo: `/home/diogenes/.cache/keating-deploy/design-pass-20261119` (branch `feature/design-pass`, uncommitted work from several people). Work ONLY there. Read its `AGENTS.md` first.
- `/home/diogenes/Projects/experiments/keating` is an OLD checkout. Never edit it. Some inventories cite line numbers from it; treat those as hints and locate the code in the repo above.

## Hard rules
- Prefix shell commands with `rtk`. Web package is `web/` with its own `node_modules`.
- NEVER commit, push, deploy, stash, reset, checkout or revert. Touch only the files in your SCOPE. Re-read a file right before editing it. If you need a change outside your scope, do not make it: list it under "needs from other lanes".
- No GitNexus index in this checkout: skip `impact`; before changing the signature or behaviour of an existing exported symbol, find its callers with `rg` and name them in your report.
- Do not ADD files under `web/src/keating/` (it is embedded in a size-limited boot bundle and the production build fails when it grows). Editing existing files there is fine if they are in your scope.
- A config-hygiene test flags the string literals `"image"` and `"default"` as values in new non-test source files. Avoid them or add an ALLOWLIST row with a reason.
- Do NOT edit `web/panda.config.ts` and do NOT run `bun run panda`. Style with the kit, plus one co-located `.css` file for your surface (class names prefixed for your surface, e.g. `rv-`, `rm-`, `cw-`), or Panda `css()` calls where the file already uses them (the coordinator regenerates Panda output at the end).
- No new dependencies.
- RESOURCE RULE: the machine is shared by many agents. Iterate with focused tests only (`rtk bun test <file>` from `web/`). Run `rtk bunx tsc --noEmit` from `web/` ONCE near the end (baseline has 2 known errors in `src/test/draft-gate-publication.test.ts`; errors in files outside your scope belong to other lanes: list them, do not fix them). If tsc is killed (exit 137), wait a minute and retry once. Never run the full test suite or a production build.

## What "implement the redesign" means
- The mockup is the target for layout, hierarchy, density, naming and motion. The existing code is the source of truth for behaviour, data, permissions and states.
- Keep EVERY existing feature, control, state, permission check, analytics call and keyboard behaviour reachable unless your brief says to remove or merge it. When you move a control, keep its handler. When the mockup does not show a state that exists (loading, error, empty, read-only, offline, busy), keep that state and restyle it in the same language.
- Keep existing English copy unless your brief renames something. If the files you edit use a translation helper, keep using it for new strings.
- Sizes: the app sets root font-size 130% (1rem = 20.8px). Mockup sizes are CSS px at that default; write them as rem = px / 20.8 so the text-size accessibility setting still scales them.
- Accessibility is not optional: labels on icon buttons, keyboard access, focus management for sheets and menus, no colour-only state, honour reduced motion.
- Mobile: follow the phone boards where your brief has one. Nothing may require horizontal page scrolling at 390px.
- Update or add tests for what you change. Tests that assert on moved or renamed UI should be updated to the new structure, not deleted.

## Shared building blocks (import, never copy or edit)
- UI kit: `web/src/design-system/kit` (being built right now by another lane; if a file is not there yet when you start coding, begin with reading and planning and check again). Exports: `Button`, `ButtonLink`, `IconButton`, `Chip`, `Segmented`, `Tabs`, `TabPanel`, `AppBar`, `AppMenu`, `SubBar`, `Card`, `Eyebrow`, `Field`, `TextInput`, `TextArea`, `SearchField`, `Avatar`, `AvatarStack`, `StatusDot`, `Note`, `Meter`, `Kbd`, `Prose`, `DefinitionList`, `Sheet`, `Menu`. Read `web/src/design-system/kit/README.md` and the component sources for props. If you need something the kit lacks, build it locally in your scope and list it under "needs from kit".
- Icons: `KeatingGlyph` from `web/src/design-system/glyphs` (README there). Replace Reicon/Lucide icons in the files you own with the matching glyph where one exists; keep the old icon where none does. Glyphs animate on hover/focus/press of their nearest interactive ancestor by themselves.
- Motion: constants and `useMotionAllowed()` from `web/src/design-system/motion.ts`; use the `motion` package (`motion/react` or the vanilla `animate`) for entrances and state changes described in your brief. Nothing may be hidden until an animation runs. Reduced motion: state changes instantly.
- Shaders: `ShaderSurface` from `web/src/design-system/shaders` (README there): `ink` behind a busy state or inside a progress fill, `field` behind an empty state. Decoration only.
- Chart colours: CSS variables `--series-1`, `--series-2`, `--series-3` (validated for colour-blind separation). Never use red and green as the only difference between two things; pair colour with shape or a label.
- Mascot: `KeatingBot` from `web/src/components/KeatingBot.tsx` has about 95 states now (see the list in that file). Use the state your brief names; pass `label=""` when nearby text already says it.

## Design source
- `docs/design/2026-11-19-review-chat-mockups/src/*.body.html`: the mockup markup for each board, followed by a numbered list of the reasons for each change. Read the board(s) named in your brief in full, including those lists.
- `docs/design/2026-11-19-review-chat-mockups/src/shared.css`: exact sizes, spacing and states for every class used in the mockups.
- `docs/design/2026-11-19-review-chat-mockups/src/ui-motion.js`: the entrance and interaction motion per board (`ENTER` table and the handlers below it).
- Inventories of the current screens (facts, with file references): `/tmp/keating-design-shots/*-map.md`.

## Deliverable
Final message of at most 35 lines: what you built per board; files added and changed; anything from the mockup you did not build and why; existing features you could not preserve (there should be none); tests and their results; tsc result with errors that are not yours identified by file; "needs from other lanes"; "needs from kit".

## Budget and resuming (added after an interruption)
- This account has a limited usage quota and an earlier run was cut off mid-edit. Work economically: read only what you need (`rg -n`, `sed -n 'a,bp'` on large files rather than whole-file reads), do not re-read files you just wrote, keep narration short, and land the most valuable changes first so an interruption leaves the tree compiling.
- Keep the tree compiling as you go: finish one file's change (and its direct dependents) before starting the next. Never leave a half-renamed prop or export.
- If your brief says RESUME: someone already started your lane and was interrupted. Begin with `rtk git status --short -- <your scope>` and `rtk git diff -- <file>` on the changed files to see what exists, keep what is good, finish what is half done, and do not start over.
- Baseline typecheck: 3 known errors in `src/test/draft-gate-publication.test.ts` (missing flue-host module). Not yours.
- The kit (`web/src/design-system/kit`: index.ts, primitives.tsx, selection.tsx, overlays.tsx, kit.css) has every export in place. Glyphs, shaders, motion constants, the companion and 64 new mascot states are finished.
