# Road to Keating 4.0

Status: proposed product roadmap  
Updated: 2026-08-26  
Surfaces: web, Electron desktop, Expo mobile, OpenTUI, and classic Pi shell

## Focus

Keating 4.0 is the release where the product loop becomes complete:

1. learners can see and celebrate meaningful progress through achievements;
2. the team can understand how every product surface is working through
   privacy-safe telemetry;
3. people can report problems through a welcoming product-feedback board and
   join an open Keating community without needing a GitHub account; and
4. learners can pay for hosted inference credits and successfully use what they
   bought.

These are the four 4.0 workstreams. Work outside them should be limited to
release blockers, regressions, accessibility, security, privacy, and changes
required to finish these flows.

## Product principles

- Reward learning evidence, not time spent, message volume, or compulsive
  streaks.
- Keep achievements local-first and portable. Telemetry observes achievement
  activity; it is never the source of truth for an unlock.
- Use one content-free event vocabulary across surfaces. Prompts, responses,
  notes, answers, files, provider keys, raw errors, and product-feedback text do
  not belong in product telemetry.
- Make product feedback available to ordinary learners. GitHub remains useful
  for maintainers and contributors, but it is not the primary support door.
- Give structured feedback and community conversation different homes:
  userinput.app owns intake, voting, and status; Roomy owns discussion, study
  groups, and community knowledge.
- Treat payment completion as the full commercial loop: checkout, signed
  webhook, wallet credit, hosted use, debit, receipt/history, and recovery.
- Do not make a disabled integration look available. Every unavailable state
  needs a truthful explanation and a useful next action.

## Current baseline

This is a source-level snapshot, not proof of current production configuration.

- Web already has extensive PostHog product and AI lifecycle instrumentation,
  privacy sanitization, consent controls, and an analytics operating plan.
  Desktop reuses the web product and should inherit that vocabulary, with its
  surface identified separately.
- Mobile has native sessions, learner feedback, goals, quizzes, decks, study
  evidence, usage records, and local persistence, but no equivalent product
  analytics client or complete event coverage was found in the mobile app.
- No learner achievement model or achievement UI currently exists. Existing
  durable learner records provide most of the evidence needed to derive one.
- Web chat and tutorial surfaces currently direct problem reports to GitHub.
  Mobile does not expose a dedicated product-problem entry in its More screen.
- Keating does not currently expose a first-party community destination.
- Web has a fail-closed Not Organic public client, PKCE/DPoP authorization,
  wallet and credit-pack UI, hosted inference wiring, and provider-hosted
  checkout code. Mobile currently hands credit purchase off to the web pricing
  page. Production payment readiness still requires live end-to-end proof.

## Workstream 1: Meaningful achievements

### Outcome

Learners can discover, unlock, inspect, and retain achievements that recognize
real progress in how they learn. Achievements appear consistently on web,
desktop, and mobile, with compact equivalents in terminal surfaces.

### Achievement model

Build a versioned shared achievement catalog and a deterministic evaluator over
the portable learner contract. Every definition needs:

- a stable ID and catalog version;
- learner-facing title, description, and explanation of why it unlocked;
- category, tier, and icon/art direction;
- an explicit evidence rule over durable learner records;
- progress semantics when partial progress is honest and useful;
- an unlock timestamp and evidence references;
- a privacy classification and telemetry-safe metadata; and
- migration behavior when a rule changes.

Unlocks must be idempotent and reconstructable from portable data. Import,
merge, retry, clock changes, app restarts, and cross-device transfer must not
duplicate or silently revoke an earned achievement.

### Initial catalog to review

The first catalog should be small enough that every achievement is legible and
worth earning.

| Category | Achievement | Evidence rule |
| --- | --- | --- |
| Begin | **Carpe Diem** | Complete the first successful teaching turn. |
| Reflect | **In Your Own Words** | Submit a reflection or restatement through a learner interaction. |
| Check | **Show Your Work** | Complete a question check with recorded evidence. |
| Recover | **Second Draft** | Revise an initially partial or incorrect answer and improve its assessed result. |
| Practice | **Back Again** | Complete a scheduled review on a later calendar day. |
| Remember | **Held Over Time** | Demonstrate the same topic successfully across separated review intervals. |
| Transfer | **A Different Angle** | Complete a transfer-level question or task for a learned topic. |
| Build | **Make Something** | Complete a project milestone or save a substantial learner-created artifact. |
| Teach | **O Captain! My Captain!** | Produce a teach-back that passes its question or rubric evidence. |
| Explore | **Constellation** | Build evidence across several distinct topics without treating topic count as mastery. |

Names and thresholds are proposals, not final copy. Before implementation,
review the catalog for pedagogical value, accessibility, localization,
achievability with local-only use, and resistance to farming. Do not add
achievements for raw message counts, spend, purchases, daily streak pressure,
or sharing private learning data.

### Learner experience

- Add an Achievements destination to the learner progress area on web and
  mobile, plus a compact terminal view.
- Show locked, in-progress, newly unlocked, and completed states without using
  hidden mystery requirements for educational outcomes.
- Explain the evidence behind every unlock in plain language.
- Use a quiet, dismissible unlock moment that never interrupts streaming,
  grading, error recovery, or an active learner interaction.
- Make reduced motion, screen readers, contrast, keyboard navigation, dynamic
  type, and offline behavior acceptance requirements.
- Include achievements in portable export/import without exporting private
  evidence content unnecessarily.

### Achievement telemetry

Emit exposure, progress, unlock, detail-view, and dismissal events with only
stable achievement ID, catalog version, category, tier, app surface, app
version, and coarse trigger type. Never send the learner's answer, topic,
artifact title, rubric text, or evidence payload.

### Definition of done

- Shared catalog and evaluator pass deterministic, migration, merge,
  idempotency, and property tests.
- A learner can unlock, inspect, export, import, and restore achievements while
  offline and with analytics disabled.
- Web, packaged desktop, physical Android, and terminal presentations have
  current interaction and accessibility evidence.
- Unlock events are inspected in the actual telemetry destination with safe
  payloads, not merely asserted in source.

## Workstream 2: Telemetry on every product surface

### Outcome

Keating can answer how learners move through the product, where they get
blocked, whether AI turns work, which features are discoverable, and whether
4.0 regresses—across web, desktop, and mobile—without collecting learning
content.

### Shared contract first

Extract or define one versioned product-event contract shared by web and
mobile. The contract owns event names, required properties, enumerations,
privacy rules, schema versioning, and tests. Platform adapters only deliver the
events.

Every event should carry, where applicable:

- `analytics_schema_version`, `app_version`, `app_surface`, build environment,
  platform, and installation channel;
- a locally generated anonymous installation identifier, unless a future real
  Keating account supplies a documented canonical identity;
- session/run correlation IDs that are never promoted into person identity;
  and
- stable outcome, duration, provider, model, feature, and error-category
  fields.

### Coverage matrix

| Journey | Required event coverage |
| --- | --- |
| Launch and onboarding | app opened, onboarding viewed/completed/skipped, tutorial opened, settings readiness |
| Activation | session started, composer ready, first message sent, first successful turn, activation stalled |
| AI lifecycle | turn started/completed/cancelled/failed, generation timing, time to first token, model/provider, token usage when reported, tool lifecycle |
| Learning | learner interaction shown/completed, quiz started/completed, review graded, goal progress, deck review, artifact saved, achievement lifecycle |
| Reliability | classified provider/auth/network/storage/rendering failures and recovery actions, never raw errors |
| Discovery | exposure and use for models, Live, voice, courses, artifacts, reviews, sharing, settings, feedback board, achievements, and pricing |
| Payments | pricing viewed, account connection, pack selected, checkout requested/returned, wallet refreshed, first hosted use, billing recovery |
| Retention | successful learning activity across later sessions and days, without equating app opens with learning value |

### Mobile parity

- Add a native analytics adapter with the same consent, opt-out, kill-switch,
  retry, and offline-queue semantics required by the web contract.
- Add a visible Privacy & telemetry setting and retain full app function when
  analytics is absent, blocked, offline, or disabled.
- Instrument native navigation and the native provider streaming lifecycle,
  rather than importing browser-only PostHog code into Metro.
- Bound and expire the offline queue. Never store prohibited content in queued
  payloads or logs.
- Distinguish `mobile`, `web`, and `desktop` in every analysis; desktop must not
  masquerade as ordinary browser traffic.

### Operating layer

Update the PostHog operating plan with the shared contract, mobile funnels,
cross-surface dashboards, release health, feedback-board conversion, payment
conversion, achievement usefulness, alerts, and event ownership. Remove events
that have no defined decision or consumer.

### Definition of done

- Contract tests prove required fields and reject prohibited data on all
  emitting surfaces.
- A synthetic journey is exercised on production web, packaged desktop, and a
  physical Android build; each event and payload is inspected in Live Events.
- Activation, reliability, achievement, feedback, payment, and release-health
  dashboards work across surface and version breakdowns.
- Opt-out, blocked-ingest, offline, queue-expiry, and telemetry-outage tests
  prove that product behavior is unchanged.

## Workstream 3: Product feedback and community

### Outcome

Every learner has an obvious, low-friction place to report a bug, describe a
problem, request a feature, vote, and see whether an item is planned, in
progress, or implemented. Learners also have a welcoming community space for
open-ended conversation, study groups, mutual help, and shared knowledge.
GitHub remains a secondary engineering channel.

[userinput.app](https://userinput.app/) currently presents public boards with
posts and discussions, voting, and visible status progression. The first
integration should therefore be a durable product link rather than assuming an
undocumented native SDK or embedding API.

[Roomy](https://roomy.space/) is an AT Protocol–based group-messaging and
community system built around "gardenable" conversations: messages and threads
can grow into longer-lived pages and documentation. That makes it a promising
home for Keating's community conversation, but not a replacement for structured
issue intake and status.

### Channel contract

| Destination | Primary job | Not its job |
| --- | --- | --- |
| **userinput.app** | Bug reports, feature requests, voting, deduplication, triage, and planned/in-progress/implemented status | General chat, study groups, or an unstructured community feed |
| **Roomy** | Community discussion, study groups, learner-to-learner help, events, design conversations, and community-authored knowledge pages | Canonical bug tracking, payment support records, security reports, or release acceptance |
| **GitHub** | Reproducible engineering issues, contributor coordination, and source-level discussion | The primary support door for ordinary learners |

When a Roomy conversation reveals a concrete bug or request, link or summarize
it into userinput.app with the participants' consent. When a userinput.app item
needs broad exploration, link to a Roomy discussion. Keep one canonical status
record rather than duplicating votes and progress across both systems.

### Setup

- Create and brand the Keating organization/board and choose its canonical
  handle and URL.
- Define categories for Bugs, Feature requests, Accessibility, Mobile,
  Payments, and Other product problems.
- Publish contribution guidance: search before posting, omit private learning
  content and secrets, describe expected versus actual behavior, and include
  app version and surface when safe.
- Define triage ownership, response targets, duplicate merging, moderation,
  status meanings, and the path from accepted feedback to engineering work.
- Seed the board with the four 4.0 themes so learners can vote and discuss
  rather than creating avoidable duplicates.

### Roomy setup

- Validate Roomy's current account, moderation, permissions, notification,
  export, accessibility, mobile-browser, data-retention, and custom-handle
  behavior before making it a required product dependency.
- Create and brand a Keating space with a stable canonical URL and clear code
  of conduct.
- Start with a small information architecture: Welcome, Help each other,
  Study groups, Show what you made, Product discussion, and Community notes.
- Publish boundaries for learning privacy, minors, harassment, academic
  integrity, medical/legal/safety claims, provider keys, payment problems, and
  security disclosures.
- Define moderators, escalation paths, retention/export expectations, and what
  happens if Roomy is unavailable or materially changes during its ongoing
  development.
- Use Roomy's page/document model to garden recurring answers and strong
  discussions into community-maintained guides. Product documentation remains
  canonical in the Keating repository until an explicit publishing workflow is
  approved.

### Product integration

- Replace primary **Report issue** links in web chat and tutorial/support
  surfaces with **Share feedback** or **Report a problem** links to the Keating
  board.
- Add the same destination to mobile More and Settings, desktop menus, and
  terminal resources/help.
- Add a distinct **Join the Keating community** destination for Roomy on web,
  mobile, desktop, and terminal help. Do not label Roomy as the place to report
  a bug.
- Keep a clearly labeled **Developer issue on GitHub** link in technical and
  contributor documentation.
- If userinput.app later documents safe prefill or embedding support, add a
  second phase that passes only allowlisted context such as app version,
  surface, operating-system family, and stable error category. Never attach
  prompts, replies, keys, full logs, filenames, course data, or raw errors by
  default.
- Track only feedback entry exposure and link opening in Keating telemetry.
  Feedback text belongs to userinput.app, not PostHog.
- Track only Roomy entry exposure and link opening in Keating telemetry. Do not
  copy Roomy messages, pages, identities, or membership into PostHog.

### Definition of done

- The public board is live, branded, seeded, moderated, and usable without
  GitHub knowledge.
- The Roomy space is live, branded, moderated, seeded with welcome/community
  guidance, and has a documented fallback if the service is unavailable.
- Every supported surface exposes the same canonical feedback destination with
  accurate labels and privacy guidance, plus a separately labeled community
  destination.
- Link behavior is verified from production web, packaged desktop, physical
  Android, and terminal help.
- A submitted test item completes the triage loop through response, status
  change, and closure.
- A test community discussion can be found, moderated, converted into a durable
  page, and—when it becomes a concrete request—linked to one canonical
  userinput.app item.

## Workstream 4: Payments and hosted-use completion

### Outcome

A learner can understand the offer, connect an account, select a credit pack,
pay once, return safely, see the credited wallet, use a hosted model, see the
debit and usage record, and recover from failure without being charged twice.

### Required commercial loop

1. Pricing explains credit packs, unit economics, provider relationship,
   expiry/refund terms, and the free bring-your-own-key path.
2. The learner connects to Not Organic through the public PKCE flow and a
   device-bound, non-extractable DPoP key.
3. Keating requests provider-hosted checkout using a stable `pack_id` and an
   idempotency key. Raw Creem product IDs and commercial secrets remain in the
   provider deployment.
4. Creem checkout succeeds or cancels and returns to an explicit result state.
5. A verified, replay-safe webhook credits the correct account wallet exactly
   once.
6. Keating refreshes wallet state and shows a receipt/usage path rather than
   treating browser return as proof of payment.
7. The learner completes hosted inference with a bounded reservation, receives
   the response, and sees the corresponding debit/reconciliation record.
8. Duplicate requests, stale webhooks, declined or abandoned checkout,
   insufficient balance, provider outage, refund, and disputed-payment paths
   fail safely and explain recovery.

### Cross-surface experience

- Web owns the complete first payment implementation.
- Desktop may reuse the web flow but must verify external checkout navigation
  and return behavior in the packaged app.
- Mobile may initially use a clearly labeled browser handoff that preserves a
  safe return path and refreshes wallet state. Native purchase parity is a
  separate decision subject to current store rules and provider support.
- Terminal surfaces show hosted-account and wallet status, then use an
  authenticated browser handoff for checkout. No payment secret or wallet
  authority moves into the terminal client.

### Payment telemetry

Measure the funnel from pricing exposure through first successful hosted use.
Record stable pack ID, surface, outcome, duration, and classified failure stage.
Do not send checkout URLs, capability tokens, wallet identifiers, payment
provider payloads, or personal data to product analytics. Browser return is
`checkout_returned`, not `payment_completed`; completion follows verified
provider state.

### Definition of done

- Focused code, contract, security, idempotency, and failure-path tests pass in
  Keating and the provider.
- A real low-value test purchase proves checkout -> signed webhook -> wallet
  credit -> hosted debit -> usage/reconciliation. Evidence is captured without
  secrets.
- Cancel, retry, duplicate-submit, insufficient-funds, webhook replay,
  delayed-webhook, refund, and provider-outage paths are exercised.
- Production DNS/TLS, CORS, redirect URIs, authorization metadata, scopes,
  secret storage, Creem catalog/webhook configuration, and kill switches are
  independently verified.
- Pricing and hosted UI remain fail-closed until the commercial proof passes.

## Delivery sequence

The workstreams can overlap, but this is the critical path:

1. **Freeze shared contracts.** Approve the achievement catalog, product-event
   schema, privacy rules, feedback-board URL/operations, and payment acceptance
   ledger.
2. **Ship the feedback and community doors early.** Create the userinput.app
   board and Roomy space, replace primary GitHub issue links, and expose a
   distinct community link so 4.0 development can receive ordinary-user input
   immediately.
3. **Build achievements and mobile telemetry together.** The shared learner
   evidence and event contracts should land before surface UI so web and mobile
   cannot drift.
4. **Complete and prove payments.** Finish external configuration and exercise
   the commercial loop while the new telemetry observes each non-sensitive
   stage.
5. **Run the 4.0 release gate.** Review achievements, event payloads,
   cross-surface support links, payment evidence, accessibility, privacy,
   upgrade/migration behavior, and release dashboards as one product journey.

## 4.0 release gate

Keating 4.0 is ready only when:

- the initial achievement catalog has been explicitly reviewed and every item
  is evidence-based, accessible, portable, and implemented across target
  surfaces;
- telemetry coverage and privacy tests pass on web, desktop, and mobile, and
  production event payloads and dashboards have been inspected;
- userinput.app is the primary learner-facing problem and feature-feedback
  destination on every product surface, with an exercised triage loop;
- Roomy is the learner-facing community destination, with moderation, privacy
  boundaries, a fallback plan, and an exercised path from conversation to a
  canonical userinput.app item;
- a real payment has produced wallet value and that value has funded a real
  hosted inference request with correct accounting;
- all four workstreams have current web, packaged-desktop, physical-mobile, and
  applicable terminal evidence;
- documentation, privacy language, support copy, changelog, and rollback/kill
  switches match the shipped behavior; and
- no code-only check, successful browser redirect, or enabled feature flag is
  presented as production proof on its own.

## Decisions still to make

- Approve or revise the first achievement names, evidence rules, and tiers.
- Choose the canonical userinput.app handle and whether anonymous posting is
  acceptable under the board's current moderation controls.
- Choose the canonical Roomy space/handle, account requirements, moderators,
  and fallback channel after the readiness review.
- Decide whether 4.0 requires terminal achievement UI or permits a documented
  post-4.0 follow-up after shared evaluation and web/mobile views ship.
- Confirm the credit packs, pricing copy, refund/expiry policy, and minimum real
  purchase used for acceptance.
- Decide which live-service owners receive analytics, feedback, payment, and
  privacy alerts after launch.
