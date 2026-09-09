# Named CLI learner profiles

Select a learner when starting either terminal interface:

```sh
keating shell --profile=ada
keating tui --profile=ada
```

`keating --profile=ada` also starts the shell. Both `--profile=ada` and `--profile ada` work; the option can appear before or after the command. It is consumed by Keating rather than becoming part of the learner's prompt. Names use 1–64 letters, digits, hyphens or underscores and begin with a letter or digit. Repeated selections and path-like names are rejected.

The learner file is **`.keating/profiles/ada.json`**. A new name creates a fresh learner. To provide background before starting, create that file with a small editable object:

```json
{
  "profile": {
    "background": "I repair bicycles and am learning ratios. I can compare gears by feel, but fractions on paper are unfamiliar."
  }
}
```

Missing profile fields receive the ordinary learner defaults. A full existing learner-state object is also supported, including `coveredTopics`, `identifiedMisconceptions`, `feedback`, `quizResults` and `sessions`. Normal state updates preserve the background and add the stored history to this file. Invalid named JSON or invalid supported field types produce an error rather than silently loading a different learner. Background is learner context, not system instructions or verified evidence of ability.

Each name has separate supporting files:

| Content | Path for `ada` |
| --- | --- |
| Learner background and recorded history | `.keating/profiles/ada.json` |
| Goals and other local state | `.keating/profiles/ada/state/` |
| Generated artifacts and traces | `.keating/profiles/ada/outputs/` |
| Pi conversation sessions | `.keating/profiles/ada/sessions/` |

The same flag works with local commands, for example `keating learner-state --profile=ada` and `keating feedback confused fractions --profile=ada`. Reopening a conversation retains the selected learner. Explicit session paths outside that named learner's session directory are rejected; use the corresponding profile to open another learner's session.

With no profile selected, Keating continues using `.keating/state/learner.json`, `.keating/state/`, `.keating/outputs/` and `.keating/sessions/`. Named profiles do not import that history automatically. The project configuration and provider credentials remain shared under their existing paths; profile selection separates learner records, not filesystem permissions or account access.

`keating profile --name=...` remains the command for the display name/avatar. Combining it with `--profile=ada` edits that named learner's TUI identity; it does not rename the learner file.

For programmatic callers, `withLearnerProfile(cwd, name, async () => ...)` from `src/core/learner-profile-selection.ts` scopes path helpers to one async operation. Wrap parent-side scaffolding and file inspection in the same scope. `launchShell` and `launchRpcClient` also consume a `--profile` argument and propagate the selection to the Pi child. Concurrent scoped calls do not modify the host environment or select one another's learner.

## Learning from ordinary conversations

The tutor can build the profile while the learner asks ordinary questions; no special “remember this” wording is required. `remember_learner_profile` stores a useful observation with an exact learner quote, the actual session/message IDs, its source and confidence. Observed inferences remain tentative. This checks provenance, not whether the model's interpretation is correct.

Active observations live in `.keating/profiles/<name>/state/learner-memory.json` and are included automatically in the next tutor context alongside the learner file, goals and learning history. Corrections can supersede a specific observation, and `forget_learner_profile` removes an active observation by ID. Removing an active observation does not erase the original conversation transcript.

The model should distinguish a current study topic from mastery, a worksheet scenario from personal identity, and a momentary difficulty from a lasting trait. The benchmark checks those decisions and later reuse; storing a quote alone does not establish good personalization.
