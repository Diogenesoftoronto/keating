# Storage, AT Protocol, and Educator Tools Roadmap

## Purpose

Keating v1 makes the agent runtime mode explicit: browser-only, remote, or cloud. The next architecture question is where learner state, curriculum artifacts, classroom data, and public educational outputs should live.

This document separates three storage concerns that should not be collapsed:

1. **Private learning state**: learner goals, misunderstandings, feedback, API keys, draft conversations, and self-improvement traces.
2. **Portable public artifacts**: lesson plans, concept maps, quiz templates, rubrics, educator-shared resources, and learner-owned portfolio items.
3. **Operational sandbox state**: snapshots, remote execution logs, checkpoints, and mutation registries.

## AT Protocol Fit

AT Protocol repositories are public, signed, content-addressed data repositories. The official repository spec describes each account repository as public and verifiable, with the account's current authoritative repository location declared through its PDS in the DID document: https://atproto.com/specs/repository

The official data repository guide describes repo updates as signed, self-authenticating records arranged in a Merkle Search Tree: https://atproto.com/guides/data-repos

Lexicon is the schema system for atproto records and XRPC endpoints: https://atproto.com/specs/lexicon

That makes atproto a good fit for **portable public educational records**, not for private tutoring memory by default.

## Proposed Storage Model

| Storage layer | Owner | Best for | Not for |
|---|---|---|---|
| Browser IndexedDB | learner | free-tier sessions, local goals, local settings, browser-only self-improvement snapshots | cross-device sync without export/import |
| Local `.keating/` filesystem | learner/developer | CLI artifacts, reproducible traces, source-edit snapshots, benchmark and evolution reports | hosted classroom collaboration |
| Keating Cloud database | Keating service or self-hosted operator | authenticated sync, class groups, educator dashboards, remote sandbox metadata | public portability by itself |
| AT Protocol PDS | learner, educator, school, or organization | public lesson packs, rubrics, concept maps, portfolio artifacts, published benchmark summaries, social discovery | secrets, raw private transcripts, minors' private progress records |
| Remote sandbox snapshot store | Keating server or self-hosted operator | microVM/NodePod snapshots, mutation registries, rollback history | user-facing social data |

## Candidate AT Protocol Lexicons

Keating should define narrow lexicons that publish educational artifacts without leaking private tutoring state:

```text
help.keating.lessonPlan
help.keating.conceptMap
help.keating.quiz
help.keating.rubric
help.keating.curriculumPath
help.keating.educatorProfile
help.keating.classResource
help.keating.portfolioArtifact
```

Each record should include:

- `title`
- `summary`
- `topic`
- `domain`
- `createdAt`
- `keatingVersion`
- `license`
- `artifactCid` or embedded compact content
- optional `sourceTraceCid` for reproducibility when safe to publish

Records should not include:

- raw chat transcripts by default
- API keys or provider metadata
- learner confusion history
- private goals
- classroom roster data
- personally identifying student analytics

## PDS Integration Sequence

1. **Export first**
   - Add export shapes that can be converted into atproto records without requiring login.
   - Keep raw private data out of the export by default.

2. **Schema package**
   - Add a small lexicon package or `docs/lexicons/` directory.
   - Validate generated records against the lexicons before publishing.

3. **Optional identity connection**
   - Let educators and learners connect an atproto account.
   - Store auth/session material in the safest available layer for the serving mode.

4. **Publish artifacts**
   - Publish lesson plans, maps, quiz templates, rubrics, and portfolio artifacts to the user's PDS.
   - Link back to Keating artifacts with stable CIDs or signed record URIs.

5. **Import and discovery**
   - Read public Keating lexicon records from followed educators, schools, or curated feeds.
   - Treat imported artifacts as source material, not as trusted private state.

6. **Migration and backup**
   - Use CAR export/import concepts for public artifact portability where appropriate.
   - Keep private Keating Cloud data export separate from public PDS publication.

## Educator Tool Direction

Educator tools should be explicit products, not hidden tutor-agent behaviors.

### Core educator workflows

- Build a lesson plan from a standard, objective, or topic.
- Generate concept maps, quizzes, rubrics, and project briefs.
- Adapt a lesson for grade level, accessibility needs, time constraints, or prior misconceptions.
- Create classroom-safe Socratic question sequences.
- Compare learner responses against a rubric without exposing private model traces.
- Publish reusable public resources to a PDS or Keating resource library.
- Assign goals or review topics to a class while preserving learner privacy.

### Educator-facing artifacts

- `LessonPack`: plan, map, quiz, rubric, timing, prerequisite list.
- `MisconceptionBank`: common wrong models and repair prompts.
- `ClassGoal`: shared objective with differentiated steps.
- `ReviewSet`: spaced-repetition queue for a group.
- `RubricRun`: assessment result with rubric evidence and redacted learner identifiers.
- `PortfolioArtifact`: learner-approved public work, optionally published through atproto.

### Privacy line

Keating should default to learner-owned private state. Educator visibility should be deliberate, scoped, and explainable:

- Class-level analytics can aggregate confusion patterns.
- Individual learner data should require explicit sharing or institutional authorization.
- Public PDS publication should be opt-in and reviewed before posting.
- Remote sandbox logs should be operational records, not educator analytics.

## Serving Implications

`keating web --browser-only-agent`:

- Store learner state in IndexedDB.
- Permit local export.
- Disable remote educator dashboards and PDS publishing unless the learner connects a PDS directly from the browser.

`keating web --remote`:

- Allow a self-hosted institution to connect its own database, PDS policy, and sandbox fleet.
- Keep sandbox execution behind the configured remote endpoint.
- Let the operator decide whether educator dashboards are enabled.

`keating web --cloud`:

- Use `keating.help` as the canonical backend for sync, educator tooling, and remote execution.
- Keep PDS publishing as user-owned public publication, not as the only source of truth.

## Open Questions

- Should Keating ship first with Bluesky/atproto account publishing, or with a generic record-export package that can publish later?
- Should public educator resources use a Keating-owned AppView/feed, or rely on existing atproto discovery first?
- What is the minimum classroom model: single educator workspace, class groups, or assignment objects?
- Which artifacts are safe to publish by default, and which require a redaction/review step?
- Should remote sandbox mutation registries ever be publishable, or only summarized as public benchmark reports?

