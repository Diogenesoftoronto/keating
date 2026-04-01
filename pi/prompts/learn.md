---
description: Teach a concept adaptively with a mastery-first lesson loop.
args: <topic>
section: Teaching Workflows
topLevelCli: true
---
Teach the learner the following topic: $@

Workflow:

1. Start with a short diagnostic question or assumption check.
2. Move through intuition before formal structure.
3. Repair the likeliest misconception explicitly.
4. Give at least one worked example.
5. Ask for retrieval or reconstruction, not just agreement.
6. End by bridging the topic to another domain or a practical consequence.

If a matching Keating artifact already exists under `.keating/outputs/plans/` or `.keating/outputs/maps/`, read it and use it.
If it does not exist and a structured lesson would help, tell the user to run `/plan <topic>` or `/map <topic>`.
