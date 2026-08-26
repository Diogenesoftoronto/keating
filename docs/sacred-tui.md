# Sacred terminal surface

Keating adapts the interaction grammar of the official [Sacred Computer component catalog](https://www.sacred.computer/) to native OpenTUI renderables. It does not load Sacred's React runtime in the terminal. The adaptation keeps Keating's own paper, ink, phosphor, and amber semantic colors while preserving the parts that make Sacred useful: layered windows, exact selection state, compact avatars, mirrored messages, action bars, and tree lineage.

## Component map

| Sacred contract | Keating implementation |
| --- | --- |
| Avatar, Badge, ActionButton, ActionBar | `src/tui/sacred.ts` |
| Message, MessageViewer | `src/tui/sacred-transcript.ts` |
| SidebarLayout, ListItem, draggable handle | `src/tui/sacred-sidebar.ts` |
| TreeView | `src/tui/session-browser.ts` |
| Card, Window, Dialog, Popover behavior | `src/tui/opentui-host.ts` |

Opaque values such as session paths remain separate from bounded display labels. Every surface has a Unicode and ASCII presentation, exposes keyboard focus, and retains direct click behavior where the terminal reports mouse events.

## Portrait assets

The following original generated artwork is stored with the landing-page assets:

- `web/public/avatars/keatingbot-newsprint.png` — a style-preserving interpretation of the canonical `web/public/brand/mascot-head-v2.png`; the cream CRT housing, green screen, black bezel, side pods, and single antenna remain the identity anchors.
- `web/public/avatars/learner-newsprint.png` — an original fictional learner portrait.
- `web/public/avatars/tutor-newsprint.png` — an original fictional tutor portrait.

All three were generated for Keating on 2026-08-25. They use original or project-owned reference material and contain no stock photography or real-person likeness. The TUI mechanically reduces a learner-selected local image into an exact four-column by two-row Braille or ASCII avatar; it never fetches avatar URLs.

## Recorded proof

The landing-page tape deck uses two reproducible VHS recordings of the current `keating tui` source host:

| Flow | Recording source | Documentation master | Landing asset |
| --- | --- | --- | --- |
| Messages, model layer, and complete-branch fork | `docs/tui-collaborative.tape` | `docs/assets/tui-collaborative.mp4` | `web/public/tapes/tui-collaborative.mp4` |
| First-run name, portrait, local-image raster, and focus tour | `docs/tui-onboarding.tape` | `docs/assets/tui-onboarding.mp4` | `web/public/tapes/tui-onboarding.mp4` |

Still frames live in `docs/assets/screenshots/`. The onboarding sequence is preserved as direct application captures: `tui-startup-logo.png`, `tui-startup-compact.png`, `tui-onboarding-name.png`, `tui-onboarding-avatar.png`, `tui-onboarding-custom-avatar.png`, and `tui-onboarding-complete.png`. The onboarding tape deliberately starts without credentials, holds the full startup lockup until Enter, then records the real name and local-image path controls. The collaborative tape uses the loopback-only fixture in `scripts/tui-demo-provider.mjs` and `docs/fixtures/tui-demo-*.json`; it exercises the production transcript, model picker, session persistence, and fork tree without network access or operator secrets. Validate the sources with `vhs validate docs/*.tape` before recording them again.

## Upstream acknowledgment

The component behavior was studied from Sacred/SRCL's public component documentation and TypeScript sources, distributed under the MIT license. Keating's OpenTUI code is an independent adaptation and retains an acknowledgment in `src/tui/sacred.ts`.
