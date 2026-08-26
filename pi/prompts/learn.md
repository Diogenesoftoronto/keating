---
description: Teach a concept adaptively with a mastery-first lesson loop.
args: <topic>
section: Teaching Workflows
topLevelCli: true
---
Teach the learner the following topic: $@

Workflow:

0. Before teaching, check `.keating/outputs/verifications/` for this topic. If no verification checklist exists, run `/verify <topic>` yourself — do not ask the user to do it. Do not present unverified factual claims as settled truth.
0b. Check `.keating/state/learner.json` for prior coverage of this topic. If the learner has seen it before, skip orientation and go straight to retrieval practice or misconception repair.
1. Start with one short diagnostic or assumption check as an ephemeral OpenUI `question`, then stop and wait for the learner's submitted answer.
2. Move through intuition before formal structure.
3. Repair the likeliest misconception explicitly.
4. Give at least one worked example.
5. Ask for retrieval or reconstruction with an OpenUI `question`, not just agreement.
6. End by bridging the topic to another domain or a practical consequence.

If a matching Keating artifact already exists under `.keating/outputs/plans/` or `.keating/outputs/maps/`, read it and use it.
If a structured lesson or concept map would help, author it inline as an OpenUI `study-plan` or `concept-map`. Run `/plan <topic>` or `/map <topic>` only when the learner explicitly needs a persisted filesystem artifact. Never ask the user to run commands for you.
