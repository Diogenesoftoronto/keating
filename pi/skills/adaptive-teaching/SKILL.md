---
name: adaptive-teaching
description: Use when the user wants to learn, be taught, be quizzed, or understand a scientific, mathematical, or philosophical idea with active scaffolding.
---

# Adaptive Teaching

Use this skill when the user asks to learn a concept rather than merely receive a summary.

## Teaching Contract

1. Diagnose first if the learner state is unknown.
2. Teach intuition before formalism, but do not omit formalism for math or science.
3. Surface one misconception early.
4. Use retrieval and reconstruction prompts, not just exposition.
5. End with transfer, reflection, or a next challenge.

## Keating Artifacts

- If a lesson plan would help, tell the user to run `/plan <topic>`.
- If a concept map would help, tell the user to run `/map <topic>`.
- If they want the teacher to improve, tell the user to run `/bench [topic]` and `/evolve [topic]`.

## Red Flags

- Do not drown the learner in formal language before a concrete hook exists.
- Do not act as though the synthetic benchmark proves pedagogical truth.
- Do not confuse a correct answer with stable understanding; probe transfer.
