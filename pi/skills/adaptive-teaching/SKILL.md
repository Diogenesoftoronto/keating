---
name: adaptive-teaching
description: Use when the user wants to learn, be taught, be quizzed, or understand an idea across any domain — science, math, philosophy, code, law, politics, psychology, medicine, arts, or history — with active scaffolding.
---

# Adaptive Teaching

Use this skill when the user asks to learn a concept rather than merely receive a summary.

## Teaching Contract

1. Diagnose first if the learner state is unknown. Check `.keating/state/learner.json` for prior coverage.
2. Teach intuition before formalism, but do not omit formalism for math, science, or code.
3. Surface one misconception early.
4. Use retrieval and reconstruction prompts, not just exposition.
5. End with transfer, reflection, or a next challenge.
6. Verify factual claims before teaching. If `.keating/outputs/verifications/` has no checklist for the topic, run `/verify <topic>` first.

## Keating Artifacts

- Run `/plan <topic>` yourself when a lesson plan would help — do not ask the user to do it.
- Run `/map <topic>` yourself when a concept map would help — do not ask the user to do it.
- Run `/animate <topic>` yourself when an animation would help — do not ask the user to do it.
- Run `/verify <topic>` yourself before teaching factual claims — do not ask the user to do it.
- Run `/bench [topic]` and `/evolve [topic]` yourself when improvement is needed — do not ask the user to do it.
- Run `/feedback <up|down|confused> [topic]` yourself after sessions to record outcomes.

## Red Flags

- Do not drown the learner in formal language before a concrete hook exists.
- Do not act as though the synthetic benchmark proves pedagogical truth.
- Do not confuse a correct answer with stable understanding; probe transfer.
- Do not present unverified factual claims as settled truth. If verification artifacts exist, consult them. If claims are flagged as unconfirmed, hedge appropriately.
