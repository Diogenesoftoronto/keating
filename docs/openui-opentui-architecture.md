# Streamable learning interfaces

Keating treats understanding as the scarce resource. The interface should help a learner inspect, manipulate, resume, and discuss an explanation instead of turning every teaching move into an opaque tool call.

## Runtime shape

```text
learner request
  -> session-start hooks add learner, review, goal, and capability context
  -> agent teaches in Markdown and optionally emits a typed OpenUI document
  -> web renders the document incrementally and routes actions back to the agent
  -> lifecycle events record evidence without requiring model calls

optional work
  -> activate_capabilities loads one or more schema bundles
  -> consolidated operations dispatch to the existing deterministic implementations
```

The deterministic pedagogy engine remains below both user interfaces. OpenUI is a presentation protocol, not a replacement for learner state, grading, artifact generation, or policy safeguards.

## OpenUI document contract

The web agent receives the generated grammar for Keating's curated component library in its system prompt. It may mix ordinary Markdown with fenced `openui` programs. A fence carries one authoritative document envelope:

````text
```openui lifecycle=resumable id=fractions-check-1
root = LearningSurface({ ... })
```
````

Lifecycle meanings:

- `ephemeral`: useful only in the current teaching moment; state is message-local.
- `resumable`: an unfinished interaction that should survive leaving and returning to a session.
- `workspace`: a learner-owned artifact intended for longer-term inspection and reuse.

The initial renderer persists resumable and workspace state locally. Moving those two lifecycles to the session store and artifact store respectively is the next persistence migration; the envelope already keeps that change independent of the model grammar.

Legacy `<keating-*>` transcripts remain readable. New model-generated interactions should use OpenUI, while existing deterministic tools may continue producing legacy artifacts until their storage and grading contracts have migrated.

## Capability bundles and hooks

Baseline teaching keeps only frequently useful, low-risk schemas. Optional capabilities are discoverable in the session context and activated together with one `activate_capabilities` call:

| Bundle | Public operations | Purpose |
| --- | --- | --- |
| Media | `animate`, `generate_image` | Visual explanations and authored animations |
| Workspace | `workspace_inspect`, `workspace_change`, `workspace_exec` | Batched inspection, transactional changes, and execution |
| Improvement | `evaluate_teaching`, `request_teaching_improvement` | Evidence review and safeguarded evolution |
| Voice | `keating_voice` | Speech when the configured runtime enables it |

Hooks own deterministic reactions that should not consume an agent turn: session hydration, interaction evidence, persistence, and idle notifications. Tools remain appropriate when the model must choose an operation, supply authored content, cross a permission boundary, or consume a result.

The consolidated operations are the model-facing API. The older fine-grained tools remain internal adapters during migration so their tested implementations and artifact formats are not duplicated.

## OpenTUI boundary

`keating tui` is a separate OpenTUI host connected to the same Pi runtime through RPC. `keating shell` is unchanged, so existing Pi prompts, skills, extensions, sessions, provider configuration, and direct Pi workflows remain portable.

The alternate host supports the shared transcript, streaming responses, prompts and follow-ups, notifications, status, editor-text requests, and Pi extension dialogs. `/shell` switches into the classic Pi interface while preserving the exact Pi session.

OpenTUI now compiles supported browser OpenUI source through the trusted shared adapter, renders every canonical semantic node in terminal-safe form, exposes keyboard actions for stateful nodes, and journals action delivery durably. The remaining parity work is above basic rendering: materializing actions into shared learner records, restoring active document state and exact entered work across session/process restart, completing learner/session/course workflows, and opening context-preserving capable-surface handoffs. The current prioritized assessment is [OpenUI to OpenTUI portability gaps](plans/openui-opentui-portability-gaps.md). The classic shell remains the compatibility surface for third-party Pi packages and workflows outside the shared learner contract.

## Migration constraints

1. Keep lifecycle metadata at the document envelope and give every resumable or workspace document a stable ID.
2. Route interaction commits through typed host callbacks and lifecycle events; do not add global browser events.
3. Promote at most one active assessment into a focused surface at a time.
4. Preserve historical transcript rendering throughout the migration.
5. Store resumable state with its session and workspace state with exported artifacts before removing the local persistence adapter.
6. Build terminal components against the same semantic documents before claiming web/OpenTUI parity.
