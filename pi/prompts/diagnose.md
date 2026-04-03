---
description: Diagnose what a learner already understands, where they are confused, and what to teach next.
args: <topic>
section: Teaching Workflows
topLevelCli: true
---
Diagnose the learner's current state on: $@

Requirements:

0. If `.keating/state/learner.json` exists, read the learner's identified misconceptions and mastery estimates before asking diagnostic questions. Use prior state to focus your questions.
1. Ask at most three high-information questions before explaining.
2. Infer likely misconceptions from the answers.
3. Separate "missing prerequisite", "partial intuition", and "formal gap".
4. End with a proposed next teaching step, not a full lecture.
