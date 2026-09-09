# Keating surface tour

## Workflow

- Read the local [hyperframes skill](.agents/skills/hyperframes/SKILL.md) before composition work, then only the domain references it selects. Avoid loading the full workflow catalog.
- For footage or image treatments, use the local [media-use skill](.agents/skills/media-use/SKILL.md) and its `references/media-treatments.md`; keep motion seek-safe.
- Preserve the existing brief and authorized decisions. Use the parent [AGENTS.md](../../AGENTS.md) for general development instructions.
- Detailed workflow routing and maintenance notes are archived in [REFERENCE.md](REFERENCE.md); verify version-sensitive details against the installed CLI.

## Commands

Run from this directory. Package scripts pin HyperFrames; preserve that pin unless upgrading is part of the task.

| Task | Command |
| --- | --- |
| Preview | `rtk bun run dev` (keep the long-running process in the background) |
| Verify composition | `rtk bun run check` |
| Render MP4 | `rtk bun run render` |
| Publish, when authorized | `rtk bun run publish` |

After HTML composition changes, run the full check, fix errors, and review warnings before rendering.

## Composition contract

- `index.html` owns the root timeline; `compositions/` contains sub-compositions.
- Timed elements need `class="clip"`, `data-start`, `data-duration`, and `data-track-index`.
- Register paused GSAP timelines on `window.__timelines["composition-id"]`.
- Use muted video with a separate audio element.
- Reference nested HTML through `data-composition-src`.
- Keep rendering deterministic: no `Date.now()`, `Math.random()`, or runtime network fetches.
