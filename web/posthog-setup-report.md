# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Keating web app. The project already had `posthog-js` and `@posthog/react` installed and partially initialized. This run updated the existing setup to route events through a Vite reverse proxy (`/ingest`), enabled exception capture, and added 9 custom event captures across 6 files covering the full learner journey — from landing page CTA through quiz completion and paid access conversion.

## Events instrumented

| Event | Description | File |
|---|---|---|
| `cta_clicked` | User clicks a primary CTA button on the landing page (`Initialize_Session`, `Open_Web_Shell`) | `src/pages/Landing.tsx` |
| `install_command_copied` | User copies an install command from the landing page | `src/pages/Landing.tsx` |
| `chat_intro_dismissed` | User dismisses the chat intro overlay and begins a session | `src/pages/Chat.tsx` |
| `session_shared` | User successfully shares a tutoring session | `src/pages/Chat.tsx` |
| `session_started` | User creates a new tutoring session from within the chat UI | `src/hooks/useKeatingAgent.tsx` |
| `message_feedback_given` | User gives thumbs-up or thumbs-down feedback on a Keating response | `src/hooks/useKeatingAgent.tsx` |
| `quiz_completed` | User submits a quiz (retrieval practice), includes score and topic | `src/components/QuizRenderer.tsx` |
| `oauth_login_completed` | OAuth login flow completed for an AI provider (success or failure) | `src/pages/OAuthCallback.tsx` |
| `dio_access_claimed` | User successfully claims Dio paid access after checkout — key conversion event; also calls `posthog.identify()` with user email | `src/pages/DioSuccess.tsx` |

## Other changes

| File | Change |
|---|---|
| `vite.config.ts` | Added PostHog reverse proxy routes (`/ingest`, `/ingest/static`, `/ingest/array`) |
| `src/lib/posthog.ts` | Updated `api_host` to `/ingest`, added `ui_host`, `capture_exceptions: true`, `debug: import.meta.env.DEV` |
| `.env.local` | Created with `VITE_POSTHOG_PROJECT_TOKEN` and `VITE_POSTHOG_HOST` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard**: [Analytics basics (wizard)](https://us.posthog.com/project/473463/dashboard/1721611)
- **Funnel** — Landing-to-session conversion: [PMJgyiq5](https://us.posthog.com/project/473463/insights/PMJgyiq5)
- **Trend** — CTA clicks by location: [92vaapZ7](https://us.posthog.com/project/473463/insights/92vaapZ7)
- **Trend** — Quiz completions per day: [8odZ9bsi](https://us.posthog.com/project/473463/insights/8odZ9bsi)
- **Trend** — Dio access claimed (revenue): [cG1up9pR](https://us.posthog.com/project/473463/insights/cG1up9pR)
- **Trend** — Session engagement signals: [nBHrkts9](https://us.posthog.com/project/473463/insights/nBHrkts9)

## Verify before merging

- [ ] Run a full production build (`bun run build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite (`bun test`) — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `VITE_POSTHOG_PROJECT_TOKEN` and `VITE_POSTHOG_HOST` to `.env.example` (or any monorepo bootstrap scripts) so collaborators know what values to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or equivalent) into CI so production stack traces de-minify — this app ships a minified Vite bundle.
- [ ] Confirm the returning-visitor path also calls `identify` — currently `posthog.identify()` is only called on Dio claim; OAuth-authenticated returning users will remain on anonymous distinct IDs until they claim Dio again.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-react-tanstack-router-code-based/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
