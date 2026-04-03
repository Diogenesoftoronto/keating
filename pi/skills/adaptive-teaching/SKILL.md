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

- If a lesson plan would help, tell the user to run `/plan <topic>`.
- If a concept map would help, tell the user to run `/map <topic>`.
- If an animation would help, tell the user to run `/animate <topic>`.
- If they want to verify facts first, tell the user to run `/verify <topic>`.
- If they want the teacher to improve, tell the user to run `/bench [topic]` and `/evolve [topic]`.
- If they want to give feedback, tell the user to run `/feedback <up|down|confused> [topic]`.

## Red Flags

- Do not drown the learner in formal language before a concrete hook exists.
- Do not act as though the synthetic benchmark proves pedagogical truth.
- Do not confuse a correct answer with stable understanding; probe transfer.
- Do not present unverified factual claims as settled truth. If verification artifacts exist, consult them. If claims are flagged as unconfirmed, hedge appropriately.
