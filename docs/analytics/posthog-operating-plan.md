# PostHog product analytics operating plan

This is the source of truth for Keating's web analytics. It turns product behavior into a small set of questions that can be answered repeatedly, while keeping learner and model-authored content out of PostHog.

## Outcomes

The primary activation outcome is a successful first AI turn, not a visit or a session object.

1. A visitor sees the landing page.
2. They choose **Start session**.
3. The chat composer becomes usable.
4. They send a first message.
5. Keating completes the turn successfully.
6. They return and complete another successful turn in a later session.

The 3.0.0 launch report exposed two separate failures that must not be merged: visitors who never enter chat, and chat visitors who never send a message. Keating now opens `/chat` directly at the composer and emits a dedicated stalled-activation signal after 45 visible seconds without a message.

## Privacy contract

- Do not send prompts, replies, titles, topics, uploaded content, tool arguments, tool results, provider keys, raw error messages, complete share links, or course/invite identifiers.
- Dynamic route IDs, query strings, and URL fragments are removed in `web/src/lib/analytics-privacy.ts`.
- Automatic exception messages are redacted. Exception type and stack structure remain available for grouping and source-map resolution.
- Session replay is a deploy-time opt-in and a user-controlled setting. It masks all text, inputs, and element attributes; excludes console logs; and strips dynamic routes and network bodies.
- The app remains fully functional after analytics opt-out or when a blocker prevents PostHog from loading.
- Arize AX is a separately configured observability destination with its own
  default-off browser consent. Its optional current-turn content contract is
  defined in the [Arize integration plan](arize-integration-plan.md); do not
  treat Arize content sharing as a PostHog property or route it through
  PostHog's ingest proxy.
- Keating has no general account identity. Keep visitors anonymous rather than calling `identify()` with a provider account, chat session ID, or device-generated UUID. Introduce identified users only if a real Keating account becomes the product's durable identity.

## Common properties

The PostHog client registers these on every event:

| Property | Meaning |
| --- | --- |
| `analytics_schema_version` | Event contract version. Increment for breaking semantic changes. |
| `app_version` | Keating release/build version used for regression comparisons. |
| `first_seen_app_version` | First release observed for this anonymous browser. |
| `app_surface` | `web`; reserve `cli` and `desktop` for future emitters. |
| `build_environment` | Vite mode such as `production` or `development`. |

Session-scoped events use `session_id` only for correlation inside the local learning session. AI turns add `turn_index`, `turn_number`, `model`, and `provider`. Never promote `session_id` to a person identity.

## Event contracts

### Activation

| Event | When | Required properties |
| --- | --- | --- |
| `$pageview` | PostHog history-change page view | Sanitized route and referrer |
| `start_session_clicked` | Any landing CTA is chosen | `source` |
| `chat_composer_viewed` | A session's composer is mounted | `session_id`, `activation_wait_ms` |
| `chat_activation_stalled` | No message after 45 visible seconds | `session_id`, `wait_ms`, `survey_trigger` |
| `session_started` | Initial or user-created session | `session_id`, `source`, `is_initial` |
| `message_sent` | Immediately before prompting the model | `session_id`, `turn_index`, `turn_number`, `model`, `provider` |
| `first_message_sent` | The first user turn | `session_id`, `model`, `provider` |

### AI lifecycle and observability

One user-visible run can contain multiple provider generations when tools are used. Product lifecycle events describe the whole run; PostHog `$ai_generation` events describe each provider call.

| Event | When | Required properties |
| --- | --- | --- |
| `agent_turn_started` | `agent_start` | `run_id`, `session_id`, `turn_index`, `turn_number`, `model`, `provider` |
| `$ai_generation` | Each provider `turn_end` | `$ai_trace_id`, `$ai_span_id`, `$ai_model`, `$ai_provider`, `$ai_latency`, `$ai_time_to_first_token`, `$ai_is_error`, `$ai_stop_reason`; token counts when available |
| `tool_invoked` | Tool execution ends | `run_id`, `tool_name`, `duration_ms`, `success`, `is_artifact` |
| `agent_turn_completed` | `agent_end`, including failures and cancels | `run_id`, `session_id`, `turn_index`, `turn_number`, `model`, `provider`, `duration_ms`, `success`, `outcome`, `error_type` when classified, `generation_count`, `tool_count` |

Do not set `$ai_input` or `$ai_output_choices`. Content-free traces still support latency, errors, cost/token trends, tool overhead, and model comparisons.

### Model, recovery, and feature adoption

| Event | Required breakdowns |
| --- | --- |
| `model_changed` | `from_model`, `to_model`, `from_provider`, `to_provider`, `during_turn`, `session_id` |
| `model_change_blocked` | attempted pair and `reason` |
| `api_error` | stable `error_type`, `provider`, status code when available, `session_id` |
| `auth_recovery_prompted` | `provider`, `session_id` |
| `auth_recovery_action` | `provider`, `outcome`, `session_id` |
| `starter_prompts_viewed` | prompt count, `model`, `provider` |
| `suggested_prompt_clicked` | stable label/domain/position, origin, `model`, `provider` |
| `quiz_started` / `quiz_completed` | question count, score, duration, stable structural properties only |
| `speech_toggled` | enabled state |
| `session_shared` / `session_forked` | mode/fallback or parent/new session IDs |
| `artifact_created` | tool name and session ID |
| `message_feedback_given` | signal and whether an optional comment exists, never the comment |

## Insights and dashboards

### 1. Launch and activation

Build one funnel with a one-hour conversion window:

1. `$pageview` where pathname is `/`
2. `start_session_clicked`
3. `chat_composer_viewed`
4. `first_message_sent`
5. `agent_turn_completed` where `success = true` and `turn_number = 1`

Break down by `app_version`, CTA `source`, device type, browser, referrer domain, and model. Keep both overall and unique-user views. The first tells us load; the second tells us people.

Create a sibling insight for `chat_activation_stalled / chat_composer_viewed`. Alert when the seven-day rate rises above 20% or doubles release over release.

### 2. AI reliability and latency

- P50/P75/P95 `duration_ms` from `agent_turn_completed`, broken down by model, provider, app version, success, and turn number.
- P50/P95 `$ai_time_to_first_token` and `$ai_latency` from `$ai_generation`.
- Error and cancellation rate by provider/model; alert on a rolling one-hour spike and on any release regression over the previous stable version.
- Stuck runs: `agent_turn_started` without `agent_turn_completed` within two minutes. This is distinct from slow successful runs.
- Tool overhead: total tool `duration_ms` and number of generations per run.
- Token/cost trends when providers expose usage; do not estimate missing data as zero.

### 3. Feature discovery

Use a weekly unique-user trend for model switch, quiz start/completion, speech enablement, share, fork, artifact creation, response comparison, and settings open. Pair each use event with its exposure event where one exists. A feature with no exposure cannot be labeled rejected; it is undiscovered.

For model switching, build a transition matrix from `from_model` to `to_model`, then split by whether the prior turn was slow or failed. This distinguishes preference from recovery behavior.

### 4. Retention and learning value

- Define an active learner as an anonymous user with at least one successful `agent_turn_completed` event.
- Track day 1, day 7, and weekly retention using successful turns as both start and return events.
- Add cohorts for first-turn success, quiz completion, artifact creation, and model switching. Compare retention, but do not infer causality from cohort differences.
- Use `message_feedback_given`, response comparisons, and the surveys below as quality signals beside operational success.

### 5. Release health

Create a release dashboard filtered and broken down by `app_version`: activation, first-turn success, error rate, P95 duration, stuck rate, and the top feature-adoption events. Pin a notebook for each release with the query definitions and decision log, not just screenshots.

## Surveys

Create these in PostHog so targeting, sampling, and copy can change without a deployment. Use one survey per purpose and keep free text optional.

| Survey | Trigger and sample | Question | Choices / follow-up |
| --- | --- | --- | --- |
| Chat activation blocker | `chat_activation_stalled`; once per user, 100% until 30 answers | “What is stopping you from asking your first question?” | Not sure what to ask; I need a model or key; I want to see an example first; I am unsure about privacy; something is not working; I am only browsing. Optional short detail. |
| First-turn effort | First successful turn, sample 30%, once per 30 days | “How easy was it to get useful help?” | 1 Very difficult to 5 Very easy. If 1–2, ask what got in the way. |
| Response value | Third successful turn, sample 20% | “Did that response move your understanding forward?” | Yes; partly; no. Optional “What was missing?” |
| Model-switch reason | Second `model_changed`, once per 30 days | “What made you switch models?” | Better quality; faster response; lower cost; longer context; provider preference; previous model failed; exploring. |
| Auth recovery | `auth_recovery_action` with `outcome = dismissed`, 100% until 20 answers | “What prevented sign-in?” | Error was unclear; callback did not finish; provider rejected access; I changed my mind; other. Include a retry/settings link. |
| Quiz usefulness | `quiz_completed`, sample 25% | “How useful was this quiz for finding gaps?” | 1–5, then difficulty: too easy / right level / too hard. |
| Feature discovery | Five successful turns and no quiz/speech/share/fork use, once | “What would you like to do next?” | Test myself; listen; share; branch an answer; create a visual; none of these. Use choices to prioritize contextual prompts. |
| Product-market fit | Five active days, once per 90 days | “How would you feel if you could no longer use Keating?” | Very disappointed; somewhat disappointed; not disappointed; no longer relevant. Ask what type of person benefits most. |
| Cancellation | `agent_turn_completed` with `outcome = cancelled`, sample 50% | “Why did you stop this response?” | Too slow; wrong direction; accidental; changed my question; output problem. |

Fatigue rules: never show more than one survey in a session, suppress for seven days after any response or dismissal, avoid surveys during streaming, and do not interrupt error recovery. Treat survey exposure, dismissal, and completion as separate events.

## Feature flags and experiments

Keep flags short-lived and name them after a decision, not a component.

1. **Landing proof before CTA**: compare the current hero with a compact interactive example. Primary metric: `start_session_clicked / landing pageview`; guardrails: bounce, page performance, and first-turn success.
2. **First-question scaffolding**: compare starter prompt arrangements and copy. Primary metric: first message within 60 seconds; guardrail: first-turn success and survey effort score.
3. **Contextual feature discovery**: after a successful first response, compare no nudge with one quiet next-action row for quiz, speech, and share. Primary metric: exposed-to-used conversion per feature; guardrail: continued messages and dismissal.
4. **Model choice framing**: compare provider-first and need-first model explanations. Primary metric: successful turn after a model change; guardrails: error rate and latency.

Use PostHog experiment exposure events and decide the sample size and minimum runtime before launch. Do not ship permanent forks guarded by stale flags. Record the decision and remove the losing branch.

## PostHog project setup

1. Add event definitions and descriptions using the contracts above. Mark content-like properties as prohibited in the data dictionary.
2. Build the five dashboards and activation actions. Save the launch report as a notebook with exact filters.
3. Configure surveys against the trigger events above.
4. Enable session replay only after confirming the deploy flag, masking, user controls, and `/privacy` text in production.
5. Configure exception tracking and upload production source maps with the Vite plugin. The build must stay valid when PostHog secrets are absent, and source maps must not remain in public assets after upload.
6. Set release and error alerts. Route auth and model-unavailable alerts separately because they have different recovery owners.
7. Validate in PostHog Live Events with a synthetic session: landing CTA, composer, first message, successful turn, model change, auth failure/recovery, tool use, quiz, share, and opt-out.
8. Inspect the actual event payload and replay, not only the code. Confirm there is no prompt text, reply text, title/topic, key, share ID, query string, or raw provider error.

## Deployment variables

| Variable | Purpose |
| --- | --- |
| `VITE_POSTHOG_PROJECT_TOKEN` | Public project ingest token. Analytics is inert when absent. |
| `VITE_POSTHOG_HOST` | PostHog UI host. Browser ingest remains same-origin through `/ingest`. |
| `VITE_POSTHOG_DISABLED` | Emergency client analytics kill switch. |
| `VITE_POSTHOG_SESSION_REPLAY` | Explicit build-time replay allow switch. Defaults off in Docker. |
| `POSTHOG_API_KEY` | Secret personal API key used only by the production build to upload source maps. |
| `POSTHOG_PROJECT_ID` | Project receiving source maps. |

Never prefix source-map credentials with `VITE_`; that would expose them to the browser bundle.

## Definition of done for analytics changes

- Event semantics and required properties are updated here.
- Content and dynamic identifiers are covered by sanitizer tests.
- The event is verified in a real browser and, when credentials are available, in PostHog Live Events.
- Funnel step names remain stable or the analytics schema version changes.
- Product behavior still works with PostHog blocked and after user opt-out.
- Dashboard, survey, alert, or experiment ownership is explicit. An event with no consumer is removed.
