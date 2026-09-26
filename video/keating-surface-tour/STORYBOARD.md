---
format: 1920x1080
duration: 32s
message: "Keating is more than a chat"
arc: Simulate → Code → Speak → Recall → Exam → Plan → Sessions → Desktop
audience: prospective self-directed learners and educators
mode: autonomous
music: none
rhythm: 8 × still-pan (4s each)
---

## Beat 1: Simulate

- status: animated
- src: index.html
- duration: 4s
- start: 0s
- transition_in: cut
- provenance: real Storybook capture
- story: learning-simulation--base-rate-neglect
- asset: assets/shots/simulation.png
- rail: SIMULATE / "Move the idea." / BASE-RATE MODEL, LIVE CHART
- scene: The base-rate simulation with its prevalence and specificity controls and the live chart.

## Beat 2: Code

- status: animated
- src: index.html
- duration: 4s
- start: 4s
- transition_in: cut
- provenance: real Storybook capture
- story: learning-labs--type-script
- asset: assets/shots/code-lab.png
- rail: CODE / "Write it, then test it." / TYPESCRIPT LAB, SAMPLE TESTS
- scene: The TypeScript lab: problem statement, editor, Run tests and the sample-test list.

## Beat 3: Speak

- status: animated
- src: index.html
- duration: 4s
- start: 8s
- transition_in: cut
- provenance: real Storybook capture
- story: learning-language-practice--pronunciation
- asset: assets/shots/pronunciation.png
- rail: SPEAK / "Say it out loud." / PRONUNCIATION, RECORD + COMPARE
- scene: Spanish pronunciation practice with Listen, Record yourself and compare.

## Beat 4: Recall

- status: animated
- src: index.html
- duration: 4s
- start: 12s
- transition_in: cut
- provenance: real Storybook capture
- story: artifacts-flashcards--phosphor-arena
- asset: assets/shots/flashcards.png
- rail: RECALL / "Remember on purpose." / FLASHCARD ARENA, SPACED REVIEW
- scene: The flashcard arena on a Bayes-rule deck, with the Reveal answer control.

## Beat 5: Exam

- status: animated
- src: index.html
- duration: 4s
- start: 16s
- transition_in: cut
- provenance: real Storybook capture
- story: learning-exam--in-progress
- asset: assets/shots/exam.png
- rail: EXAM / "Test under time." / TIMED EXAM, FLAG + REVIEW
- scene: An exam in progress: countdown, question navigator and Flag.

## Beat 6: Plan

- status: animated
- src: index.html
- duration: 4s
- start: 20s
- transition_in: cut
- provenance: real Storybook capture
- story: learning-nestedstudyplan--detailed-two-levels-with-plan-links
- asset: assets/shots/study-plan.png
- rail: PLAN / "See the whole path." / NESTED STUDY PLAN, LINKED LESSONS
- scene: A two-level study plan whose steps link to lessons, with Save & review plan.

## Beat 7: Sessions

- status: animated
- src: index.html
- duration: 4s
- start: 24s
- transition_in: cut
- provenance: real Storybook capture
- story: sessions-library--search-keeps-ancestry
- asset: assets/shots/sessions.png
- rail: SESSIONS / "Pick the thread back up." / SESSION SEARCH, FORK ANCESTRY
- scene: The session library filtered by search, still showing each fork's parent.

## Beat 8: Desktop

- status: animated
- src: index.html
- duration: 4s
- start: 28s
- transition_in: cut
- provenance: real Storybook capture
- story: workspace-desktop--run-and-stop
- asset: assets/shots/workspace.png
- rail: DESKTOP / "Run it on your machine." / LOCAL FILES, REAL PROCESSES
- scene: The desktop workspace with a working folder, command and time limit, and Run command.

## Motion (every beat)

At +0.2s the frame fades and scales in, and the rail and progress tab highlight.
From +0.5s the still is sized to 1010 px tall inside the 1492×836 stage. It pans
down by its overflow (about 174 px) and pushes in from 1.00 to 1.03 over 3.3 s
with sine.inOut, which is deterministic and seek-safe. `index.motion.json` checks that each
frame appears by +0.8s, that the frames appear in order, and that each stays in frame.
