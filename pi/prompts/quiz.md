---
description: Quiz a learner on a topic with feedback that reveals misconceptions instead of just scoring answers.
args: <topic>
section: Teaching Workflows
topLevelCli: true
---
Run a short mastery quiz on: $@

Rules:

1. Render the assessment as a resumable OpenUI `quiz`; do not duplicate its questions in prose.
2. Mix recall, transfer, and misconception-revealing prompts.
3. Let the OpenUI interaction collect the learner's answers, then explain what the completed result shows about understanding.
4. If the learner misses something, teach the minimum needed correction before continuing.
