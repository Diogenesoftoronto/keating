# Similarity and Consolidation Report

## Scope

The Keating 3.0 release review used the checksum-verified official
`similarity-ts` v0.5.0 Linux binary. The historical npm invocation no longer
works because `similarity-ts` is distributed as a Rust binary rather than an
npm package.

```sh
similarity-ts src web/src --types --threshold 0.87 --min-lines 6 \
  --exclude node_modules --exclude dist --exclude styled-system
```

The review focused on voice, provider search, authorization, serializable UI, OpenUI, persistence, and the Pi/OpenTUI bridge. It did not treat a high AST score alone as evidence that two implementations share semantics.

The first 3.0 pass reported 19 direct function pairs and 53 type pairs. A later
working-tree scan reported 20 direct function pairs and 48 named-type pairs.
After the safe consolidations below, the same command now reports 10 direct
function pairs and 30 named-type pairs (plus one type-literal/type-definition
pair and six type-literal pairs). The large function clusters remain review
queues rather than duplicate counts: their members often share only
control-flow shape.

## Consolidation performed

### Runtime-neutral pedagogy contracts and engines

The exact benchmark contracts, real-outcome scoring, and deterministic teaching
simulation formerly duplicated by `src/core` and `web/src/keating/core.ts` now
live under `shared/pedagogy/`. Root and browser modules preserve their public
exports while consuming one runtime-neutral implementation.

Learner goal types and operations moved to the same boundary. Only topic
resolution remains surface-specific and is injected by the small root and web
facades. NodePod boot generation now includes `shared/`, so the browser sandbox
receives the same canonical modules as the host build.

### Live speech session lifecycle

Gemini Live and OpenAI Realtime retain provider-specific transports, payloads,
and readiness timing, but now share lifecycle, abort cleanup, completion,
first-audio/turn telemetry, and caller-owned video subscription routing through
`live-session-lifecycle.ts`. Their `startLiveSession` functions no longer form a
direct similarity pair at the report threshold.

### Focused same-runtime helpers

- Fork-map timestamps reuse the canonical relative-session date formatter.
- Evaluation and provider-completion telemetry share one OTLP span exporter.
- Root and themed TUI goal cards share goal body construction while retaining
  their distinct progress rendering.
- Fine-tune artifact/session builders share one initialized result structure.

### Course workspace state machine

`web/src/pages/CourseWorkspace.tsx` held load status, errors, saving state,
course snapshots, active lessons, modal state, and several coupled drafts in 19
independent `useState` calls. The page now uses a typed reducer for workspace
transitions and a second reducer for course/lesson edit drafts. Note and answer
synchronization remain separate so a remote note update cannot erase an
unsaved exercise response. The only remaining `useState` in the file is the
independent teacher-review draft map owned by `RoomView`.

### Flashcard domain contract

`web/src/keating/srs.ts` and `web/src/keating/storage.ts` independently defined
nearly identical card, deck, and scheduling state. They now re-export the
canonical definitions in `web/src/keating/flashcard-types.ts`, including the
optional Anki identities and persisted session id.

### Persisted settings subscriptions

Model preferences and UI settings duplicated the same custom-event plus
`storage` listener lifecycle. Both now use `subscribeLocalSetting()` from
`web/src/keating/local-setting.ts`. Their individual normalization and storage
formats remain separate.

### Storyboard scene contract

The renderer and browser animation tool had exact private copies of
`StoryboardScene`. Both now consume the runtime-neutral contract in
`web/src/keating/storyboard.ts`.

### Browser storage contract

`web/src/keating/openui/renderer.tsx` had a private `StorageLike` interface that duplicated the read/write subset of `web/src/keating/event-store/types.ts`.

OpenUI now derives its contract with `Pick<EventStoreStorage, "getItem" | "setItem">`. This keeps its deliberately smaller requirement while making the event-store interface the single browser-side definition. The Nodepod boot-file snapshot was regenerated after the source change.

## Intentional duplicates

### Root TUI and browser UI protocol shapes

`src/tui/ui/types.ts` and `web/src/keating/ui-protocol/types.ts` mirror the same versioned wire protocol, including `UiActionRequest`. They intentionally remain separate:

- Root uses NodeNext imports and must not depend on the web package.
- Web has richer discriminated document payloads and browser-only adapters.
- The TUI only needs the stable transport envelope and generic JSON-safe payloads.
- Moving these definitions into either runtime would create an invalid dependency direction; introducing a new shared package would be disproportionate for this release wave.

Compatibility is protected by focused protocol and OpenTUI tests. A future workspace-level protocol package is reasonable only if a third runtime begins consuming the contract.

### Browser legacy adapters and TUI tool-result adapters

`web/src/keating/ui-protocol/legacy.ts` decodes double-encoded custom tags and normalizes browser-era payloads. `src/tui/ui/adapter.ts` converts Pi tool results and already-serialized UI documents. Their output envelopes resemble each other, but their input grammars, fallback behavior, and runtime dependencies differ. Combining them would couple browser parsing to Pi or weaken one adapter into an overly generic converter.

### Provider search routing and search-result normalization

`web/src/keating/provider-web-search.ts` negotiates and injects provider-hosted request tools. `web/src/keating/search/provenance.ts` normalizes returned citations and emits untrusted-content provenance. These are complementary request- and response-side boundaries, not duplicate helpers. Keeping them separate makes it harder to accidentally treat enabling search as trusted search output.

### Voice compatibility preflight and shared authorization

`web/src/keating/integration/voice-permissions.ts` contains a small compatibility preflight for callers that need a synchronous answer. `web/src/keating/security/authorized-execution.ts` is the authoritative execution and confirmation boundary used by text and voice. The preflight does not execute tools or replace policy evaluation, so merging it into the executor would blur the distinction between UI capability hints and authorization.

### Remaining root/browser pedagogy ports

The scan continues to report near-exact families in `src/core` and
`web/src/keating/core.ts`, including quiz construction, engagement, MAP-Elites,
prompt evaluation, and export helpers. These are not all interchangeable:
engagement uses different timestamp/state models, MAP-Elites has persistent
asynchronous root behavior versus an in-memory browser runner, and the browser
quiz implementation is a feature superset. Move only independently proven pure
kernels into `shared/`; importing the Node core into the browser remains an
invalid dependency direction.

## False positives

The highest-scoring function pairs involving `createWorkspaceTools` are AST-size artifacts. The scanner compares its large function body with unrelated shorter functions such as SEO hooks, media-query hooks, OAuth setup, and conversation runtime creation. They do not share behavior or a useful extractable abstraction.

Other reported pairs such as conversation runtime versus project aggregation, quiz construction versus React hooks, and MCP serving versus gesture/import code similarly share common control-flow shapes rather than domain logic. No ignore comments were added because the current scan is still useful as a review queue and source annotations would not improve runtime clarity.

## Follow-up threshold

Create a runtime-neutral shared protocol package only when at least one of these becomes true:

1. A third independently built client consumes the UI contract.
2. Contract drift is observed despite compatibility tests.
3. The repository adopts workspace package boundaries that both root and web can consume without pulling runtime-specific dependencies.

Until then, wire-level tests are safer than forcing root and browser code into the same module graph.

## Remaining architectural signals

- The remaining engagement, MAP-Elites, quiz, retry, and policy shapes confirm
  that the hand-maintained browser port remains the largest duplication
  boundary. Continue moving only genuinely identical, runtime-neutral kernels;
  importing the Node core into the browser would violate the build contract.
- `src/core/export.ts` and `web/src/keating/export.ts` still contain a
  high-scoring session-conversation pair. Their source records and output
  contracts differ, so any shared extraction needs explicit cross-runtime
  fixtures rather than a shape-only merge.
- `src/tui/composer.ts` and `src/tui/search.ts` still report similar scoring
  functions. They belong to active TUI work and normalize inputs differently;
  consolidate them with ranking fixtures when that subsystem is integrated.
- The root and browser `ApiRetryPolicy` definitions are exact. They should join
  a future shared contracts package if retry behavior gains a third consumer.
- Small formatting and markdown pairs remain below the threshold for a new
  abstraction. Prefer an existing domain helper when editing them, but do not
  introduce a catch-all utility module solely to reduce the scanner count.
