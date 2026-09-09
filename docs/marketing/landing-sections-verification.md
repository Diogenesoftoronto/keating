# Problem-first landing sections

Implemented 2026-09-09 in `web/src/components/LandingLearning.tsx`, following the
existing interactive lesson and preceding the closing CTA.

1. Direction: finding a route through a subject is work. An interactive preset
   demonstrates depth, practice method, and lesson order; the CTA carries those
   choices to the chat composer as an editable request.
2. Continuity: re-explaining learning context. An explicitly labeled example
   connects goals and prior practice to a next teaching question.
3. Shared courses: turning knowledge into something others can follow, and
   giving a group's questions a place to meet. The preview switches between
   lessons and discussion. Course creation uses the existing chat creation mode;
   invitations retain the existing invitation-link flow.

Theme: existing Space Mono/JetBrains Mono, paper/ink/green semantic tokens,
square outlines, hard offset shadows, original Keatingbot. UI remains semantic
HTML/CSS; generated concept images are not used as interactive UI.

## Verification

- Focused strict TypeScript check of `LandingLearning.tsx` and
  `useLandingAnalytics.ts` passed, including their direct dependencies.
- Existing analytics privacy, preferences, and diagnostics tests: 14 passed,
  0 failed (39 assertions).
- Playwriter headless Chrome: isolated real-component preview at 1440×1000,
  768×1024, and 390×844; light and dark themes; keyboard course-preview selection.
- Changed depth, practice method, and order and inspected the updated lesson
  preview. Followed the chat CTA and verified the selected options in `ask`.
- Switched course previews and followed the creation CTA to
  `/chat?courseMode=create`.
- Verified section-view deduplication and expected demo/CTA events using a
  capture double in the existing PostHog provider. No learner-authored content
  appears in the new event properties.
- Corrected paragraph specificity in the terminal preview and the global
  mobile-button cascade after visual inspection.
- Scoped `git diff --check` passed.

## Boundaries

The browser preview used the actual new components, generated project styles,
and a lightweight router with destination placeholders. This verifies these
sections and their handoff URLs, not the complete chat experience or inference.

The full web typecheck is blocked by pre-existing empty modules including
`web/src/keating/storage.ts`, `web/src/pages/Pricing.tsx`, and
`packages/learner-contracts/src/index.ts`. The full Vite/Nitro build is blocked by
the pre-existing empty `desktop/package.json`; Nitro was not reached. Those
unrelated files were not restored or changed by this task.

The existing Keating PostHog project (473463) was checked through its connector
and contains product events. New landing events were checked with a local
capture double, not sent as fabricated production traffic. Production receipt
must be checked after deployment. Event definitions and funnel guidance are in
`docs/analytics/posthog-operating-plan.md`.

No deployment, domain migration, commit, or release was performed.
