Build the shared UI kit for a redesign of the Keating web app (React 19, TanStack Router, Panda CSS, Bun). You are lane F4 of a multi-agent build. Page lanes that start at the same time as you will import this kit using EXACTLY the contract below, so the export names and props are fixed. Deliver the kit FAST: get every export in place with correct types first (within your first minutes), then refine styling and tests.

REPO: /home/diogenes/.cache/keating-deploy/design-pass-20261119 (branch feature/design-pass, uncommitted work from several people). Work ONLY there. Read AGENTS.md first.

RULES (all lanes)
- Prefix shell commands with `rtk`. Web package is `web/`; `motion@14.14.0` is installed.
- NEVER commit, push, deploy, stash, reset, checkout or revert. Touch only your SCOPE; re-read a file right before editing it.
- No GitNexus index here: skip `impact`, use `rg` for callers.
- No new files under `web/src/keating/`. Avoid the string literals "image" and "default" as values in new non-test source (a config-hygiene test flags them) or add an ALLOWLIST row.
- Do NOT edit `web/panda.config.ts` or run `bun run panda`. Use one co-located stylesheet, `kit.css`, with `k-` prefixed class names.
- RESOURCE RULE: focused tests only (`rtk bun test <file>` from `web/`); `rtk bunx tsc --noEmit` from `web/` once near the end (baseline: 2 known errors in src/test/draft-gate-publication.test.ts, not yours). If tsc is killed (exit 137) wait a minute and retry once. No full suite, no production build.

DESIGN SOURCE
- docs/design/2026-11-19-review-chat-mockups/src/shared.css is the visual specification: the primitives are the rules for `.b` (+ .pri .acc .gh .ln .sm .off), `.ib`, `.chip`, `.seg`, `.tabs`, `.top`, `.sub`, `.ttl`, `.card` (+ .hardc), `.eb`, `.fld`, `.inp`, `.av`, `.d`, `.note`, `.hb`, `.prose`, `kbd`, `.sheet`, `.menu`, `.tile`, `.dlist`, `.find`, `.cnt`, `.lnk`, and the `.kt` / `.kt.dark` token block at the top. Mockup sizes are CSS px at the app's default root size; the app sets root font-size 130% (1rem = 20.8px), so write each size as rem = px / 20.8 (keep 1px and 1.5px borders in px).
- Tokens: use the app's existing CSS custom properties (see the `:root` block in web/panda.config.ts, read only): --paper, --paper-deep, --card, --ink, --ink-soft, --line, --line-soft, --green, --green-deep, --green-wash, --amber, --red, --mono-display, --mono-body, --font-ui. Define the few extras the mockup uses as kit-scoped variables in kit.css (for example --k-ink-faint, --k-hard-shadow: 3px 3px 0 var(--ink) with the dark variant from the mockup, --k-accent-fill #14743c light / #4be388 dark with its on-colour, and --k-reading: "Literata", Georgia, Cambria, serif).
- Reading face: add Literata (400, 600, 700, italic 400) to the existing Google Fonts link in web/index.html (additive edit of that one URL).
- Icons: `KeatingGlyph` from web/src/design-system/glyphs (already built by another lane; read its README).
- Motion constants: web/src/design-system/motion.ts (already built): SPRING, SOFT, EASE, motionAllowed/useMotionAllowed.

SCOPE (you own): web/src/design-system/kit/** (new), a Storybook story web/src/design-system/Kit.stories.tsx, tests web/src/test/kit-*.test.tsx, the one-line font edit in web/index.html, and ADDITIVE `export` keywords in web/src/components/Nav.tsx if you need its link definitions for AppMenu. Touch nothing else.

CONTRACT: web/src/design-system/kit/index.ts must export exactly these (all forward refs and spread remaining DOM props onto the root element; all accept className):
- `Button` props: variant?: "outline" | "primary" | "accent" | "ghost" | "line" (outline is the standard bordered button; line is the hairline version); size?: "sm" | "md"; busy?: boolean (sets aria-busy and disables); glyph?: GlyphName (leading icon); plus button props. Also `ButtonLink` with the same look for anchors/router links (accepts `to` for TanStack `Link` or `href`).
- `IconButton` props: label: string (required, becomes aria-label and title); glyph: GlyphName; size?: "sm" | "md"; bordered?: boolean; pressed?: boolean; plus button props.
- `Chip` props: selected?: boolean; count?: number | string; tone?: "neutral" | "inverse"; as?: "span" | "button"; children.
- `Segmented<T extends string>` props: label: string (accessible name); options: { value: T; label: ReactNode; hint?: string }[]; value: T; onChange(value: T): void; wide?: boolean; size?: "sm" | "md". Radiogroup semantics with roving tabindex and arrow keys. When the selected option has a hint, render it under the control.
- `Tabs` props: label: string; items: { id: string; label: ReactNode; count?: number | string; glyph?: GlyphName }[]; value: string; onChange(id: string): void; stretch?: boolean. Tablist semantics, arrow/Home/End keys, an underline that slides between tabs with Motion (instant when motion is not allowed). And `TabPanel` props: id, active, children.
- `AppBar` props: back?: { label: string; to?: string; onClick?(): void }; title: ReactNode; subtitle?: ReactNode; start?: ReactNode (between back and title, e.g. logo); children (right-aligned actions); menu?: boolean (default true: shows `AppMenu` at the far right). A 46px-tall bar (2.2rem at root scale) with a 1.5px ink bottom border; title ellipsizes; on narrow screens actions marked `data-collapse` hide their text.
- `AppMenu`: one "More" icon button opening a menu with the app's destinations (Chat, Courses, Rooms, Learning activity, Reviews, Settings where available) and the theme toggle. Reuse the link list and ThemeToggle from web/src/components/Nav.tsx / ThemeToggle.tsx rather than retyping them. Escape and outside click close it and return focus.
- `SubBar` props: children. A 38px row under the AppBar with a hairline bottom border; lays children out in a row with a gap; a child with `data-grow` takes the free space.
- `Card` props: tone?: "plain" | "hard" | "dashed" | "wash"; as?: any; children. `Eyebrow` props: muted?: boolean. `Field` props: label: ReactNode; hint?: ReactNode; error?: ReactNode; htmlFor?: string; children. `TextInput`, `TextArea`: native elements with the kit look. `SearchField` props: value, onChange(value), placeholder, label, shortcut?: string.
- `Avatar` props: name: string; size?: "sm" | "md" | "lg" | "xl"; src?: string (square, first letter fallback). `AvatarStack` props: names: string[]; max?: number.
- `StatusDot` props: tone: "ok" | "warn" | "idle" | "bad"; label?: string (visually hidden text when given). `Note` props: glyph?: GlyphName; tone?: "info" | "warn"; children. `Meter` props: value: number; max: number; label: string (accessible); tone?: "series1" | "series2" | "series3" | "ink" (thin horizontal bar; the fill animates in when motion is allowed). `Kbd`. `Prose` (reading wrapper: the serif face, 1.62 line height, max 34em paragraphs, styled code/blockquote/lists). `DefinitionList` props: items: { term: ReactNode; detail: ReactNode }[].
- `Sheet` props: open: boolean; onClose(): void; title: ReactNode; description?: ReactNode; footer?: ReactNode; side?: "center" | "right" | "bottom"; children. A modal dialog built on the native <dialog> element like the app's existing dialogs (find one and match its focus handling), closes on Escape and backdrop click, restores focus.
- `Menu` props: label: string; trigger: ReactElement; items: ({ id: string; label: ReactNode; description?: ReactNode; glyph?: GlyphName; disabled?: boolean; onSelect(): void } | "separator")[]. Menu-button semantics with arrow keys.
All interactive components need visible focus rings (the app uses 2px or 3px green outlines), minimum 44px touch targets on coarse pointers, and must not rely on colour alone.

TASKS
1. Create every export with correct types and a first-pass stylesheet immediately so other lanes compile.
2. Bring kit.css to match the mockup primitives in both themes (the app's dark theme is applied by a class or attribute on <html>; check web/src/theme-sync.ts) and respect `html[data-high-contrast]` if the app defines it (see web/src/learner-accessibility.css).
3. Story showing every component in both themes; tests for Segmented (keyboard, hint), Tabs (keyboard, aria), Sheet (open/close/focus restore), Menu (keyboard), Button busy state, AppBar back link.
4. A README.md in the kit folder (under 60 lines) listing each export with a one-line example.

DELIVERABLE: final message of at most 25 lines: files added/changed, tests and results, tsc result (errors not yours identified by file), any deviation from the contract (there should be none), deferred items.