# Keating learner documentation

Independent static documentation for `https://docs.keating.help`. The working
app remains at `https://keating.help/chat`; developer documentation remains at
`https://dev.keating.help`. The learner tutorials live here.

## Build and preview

From the repository root, with the existing Bun 1.3.13 environment:

```sh
rtk bun scripts/docs-site/build.ts
```

Or use the coordinator-managed native Devenv task and Caddy service:

```sh
rtk devenv tasks run keating:docs-site-build
rtk devenv up caddy
```

Caddy serves the generated site at <http://localhost:4191>. Rebuild after
editing content or assets. No dependency installation is required for the site.
The build writes ignored `public/`; only the source assets are versioned.

## Content contract

The build reads `content/getting-started.json` and `content/learning.json` in
that order. Each is a nonempty array of:

```ts
type Page = {
  slug: string;
  title: string;
  description: string;
  group: string;
  sections: Section[];
};
type Section = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  code?: string;
  language?: string;
  links?: { label: string; href: string }[];
  screenshots?: Screenshot[];
};
type Screenshot = {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
};
```

All text is plain text, escaped by the builder. Markdown and HTML are not
interpreted. Use the links array for links and the code field for examples.
Keep product claims and visible UI labels grounded in the current source.
Installation, offline models, hosted services, and payment availability can
have different requirements; document those requirements explicitly.

Slugs use lowercase ASCII letters, numbers, and single hyphens between words.
Slugs must be unique, cannot collide with static infrastructure names, and
produce `/slug/` routes. `start-here` is required for the homepage action.
Groups retain first-appearance order; articles retain their order within each
group. The same order drives the sidebar, directory, and previous/next links.

Section anchors begin with `section-`, followed by a normalized heading.
Repeated or colliding headings receive `-2`, `-3`, and so on. For example,
`Your first lesson` becomes `#section-your-first-lesson`. Internal links must
point to a generated `/slug/` route, optionally with its exact fragment.
External links require HTTPS. Queries, unknown pages or anchors, malformed
content, unsafe slugs, and duplicate slugs fail the build.

The builder also checks generated HTML for duplicate IDs and broken navigation
links. It validates everything and stages complete output before replacing
the previous generated directory, so content errors leave the last build
intact. Changes to page headings can change section anchors; review linked
fragments when renaming headings.

## Screenshot contract

Place screenshots in the section where they explain a task or a visible state.
An optional `screenshots` array must contain at least one object:

```json
{
  "src": "/assets/screenshots/review-selection-menu.png",
  "alt": "Selected transcript text with Problem, Strength, Suggestion, and Rewrite actions.",
  "caption": "Earlier tutorial capture of selecting a passage to annotate.",
  "width": 1062,
  "height": 300
}
```

`src` must use `/assets/screenshots/lowercase-name.png`, with lowercase letters,
numbers, and single hyphens between words. External URLs, query strings,
fragments, traversal, and other formats are rejected. `alt` and `caption` are
required nonempty plain text and are escaped, including in accessible link
names. `width` and `height` are positive integer pixel dimensions matching the
original PNG. The build checks every generated asset reference, the PNG
signature and header, and its dimensions before replacing the last good output.
Missing files and mismatched dimensions fail the build.

Images render uncropped at the article width with their aspect ratio reserved,
lazy loading, and asynchronous decoding. Each semantic figure has a visible
caption and an ordinary **View full-size screenshot** link to the same original
PNG. This works without JavaScript and lets readers inspect small controls at
full resolution. Alt text and captions are included in the section search index.

The 14 PNGs in `assets/screenshots/` are unchanged copies of genuine captures
from `web/public/tutorial/`, selected after visual inspection. The build uses
only the copies inside this self-contained upload directory. Keep the originals
in `web/public/tutorial/` so old `/tutorial/` image URLs remain valid. The local
`assets/screenshots/.gitignore` makes these captures addable despite the root
PNG ignore rule. Do not generate, redraw, crop, or fabricate replacement screens.

These pictures come from the earlier tutorial, not a fresh capture of the
current release. Captions identify renamed controls, unavailable features,
empty or unfinished states, and other differences that matter for the task.
Authored prose remains the current instruction. In particular, the old model
picker says **Select Model**, the older question says **Submit answers**, and
the captured WebGPU warning does not diagnose a custom model server. There is
no old capture of the current custom-provider form, native offline download,
account/credit recovery, quiz grading, or course-delivery confirmation; do not
use a different screen as proof of those states.

The earlier page can be inspected read-only after its deletion with:

```sh
rtk proxy git show HEAD:web/src/pages/Tutorial.tsx
```

Eighteen inspected source PNGs are deliberately not copied:

- `surface-publishing`: an unavailable legacy blog, superseded by the new blog.
- `surface-bench`, `review-model-pools`, `review-model-results-empty`, and
  `review-model-results`: benchmark and comparison configuration are outside
  these learner guides; the result rows are still running, not completed work.
- `surface-courses`, `surface-usage`, `review-index`, and `surface-review`:
  overview or empty screens add less context than the chosen course builder,
  portable export, and populated review workspace. The review indexes duplicate
  the same empty state.
- `review-reading`, `review-raw-tools`, `review-rubric`, and `review-export`:
  additional views of the same lesson would turn the short review guide into a
  gallery. The chosen workspace, text selection, note draft, and pass menu cover
  the steps described; the rubric is unfinished and the raw tool call failed.
- `tui-startup-compact`, `tui-onboarding-name`, `tui-onboarding-avatar`,
  `tui-onboarding-custom-avatar`, and `tui-onboarding-complete`: detailed profile
  setup variants are outside the installation walkthrough. One terminal startup
  capture shows what the archive opens without duplicating that sequence.

## Design and implementation

The visual sources are `PRODUCT.md`, `scripts/dev-site/assets/site.css`, and
the existing developer site's `keatingbot.png`. Paper, ink, green, Space Mono
headings, and JetBrains Mono labels preserve the Keating identity. System sans
serif body text improves long-form reading. The homepage provides a first-lesson
action and a grouped directory, while articles have a sidebar, section contents,
and previous/next navigation. Mobile navigation uses native disclosure controls.

`assets/keatingbot.png` is an unchanged copy of the developer site's real mascot.
The local font files are the regular weights of the existing brand fonts,
downloaded from Google Fonts. Their accompanying SIL Open Font License files
are included. Font sources:

- [Space Mono](https://fonts.google.com/specimen/Space+Mono)
- [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono)

The site makes no third-party font requests. Navigation and articles work
without JavaScript. `assets/site.js` enhances them with full-content search
and current-section tracking. Search loads `search.json` on demand, ranks
titles ahead of matching contents, links to relevant sections, and reports
no matches or an unavailable index without inventing answers. Result text is
inserted with `textContent`. The slash shortcut focuses search; Tab and arrow
keys browse results; Escape closes them. Focus indicators, a skip link,
reduced motion, visible search status, and a no-JavaScript message are included.

## Railway and Railpack

Use service `keating-docs` with `scripts/docs-site` as its root. The coordinator
owns deployment and the `docs.keating.help` domain, targeting port 8080.

`Staticfile`, `railpack.json`, and `railway.toml` match the developer site's
native Railpack setup exactly. Bun 1.3.13 is pinned as a build-only package;
Railpack manages the production Caddy server. No custom Dockerfile or runtime
application server is needed. Keep the Bun package version and absolute build
executable path synchronized if upgrading both sites.

Validate the plan without deploying:

```sh
rtk proxy railpack prepare scripts/docs-site --plan-out /tmp/keating-docs-plan.json
```

The health check requests `/`. `index_fallback: false` preserves real HTTP 404
responses for unknown paths. The generated `404.html` contains recovery links
and `noindex`; the native server decides the missing-path response body. Do not
enable SPA fallback. The sitemap lists only the homepage and articles with
`https://docs.keating.help` canonical URLs; robots.txt points to that sitemap.

Before publishing, verify the real static server returns 200 for the homepage,
articles, fonts, mascot, and search index; returns 404 for a nonexistent route;
and remains usable with keyboard navigation and a narrow viewport. A successful
Bun build and Railpack plan do not prove DNS, TLS, deployment, or browser behavior.

Reference: [Railpack static sites](https://railpack.com/languages/staticfile/).
