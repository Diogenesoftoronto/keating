# ==============================================================================
# Keating Lesson Tour — Learner Profile: Elena Chen
# Topic: Raft Consensus & Distributed Log Replication
#
# Follows Elena Chen, a systems engineer learning distributed consensus.
# Elena configures her learner profile, inspects the active Socratic policy,
# generates concept maps and quizzes, and checks her spaced review schedule.
# ==============================================================================

Output docs/assets/lesson-elena-raft.mp4

Require bun

Set Shell "bash"
Set FontSize 19
Set Width 1280
Set Height 760
Set Padding 36
Set Theme "Catppuccin Mocha"
Set WindowBar "Colorful"
Set WindowBarSize 40

# Paced typing speed for clear readability
Set TypingSpeed 75ms

Hide
Type "alias keating='bun src/cli/main.ts'"
Enter
Type "clear"
Enter
Show

# 1. Set learner identity and profile context
Type "keating profile --name='Elena Chen'"
Sleep 1500ms
Enter
Sleep 2s

# 2. Inspect active hyperteacher policy (Socratic ratio, formalism, retrieval bias)
Type "keating policy"
Sleep 1500ms
Enter
Sleep 3500ms

# 3. Generate concept map artifact for Raft Consensus
Type "keating map 'Raft Consensus'"
Sleep 1500ms
Enter
Sleep 2500ms

# 4. Generate Socratic retrieval practice quiz and rubrics
Type "keating quiz 'Raft Consensus'"
Sleep 1500ms
Enter
Sleep 3s

# 5. Inspect generated quiz questions, answer keys, and grading rubrics
Type "head -n 26 .keating/outputs/quizzes/raft-consensus.md"
Sleep 1500ms
Enter
Sleep 5s

# 6. Check spaced retention timeline across learning topics
Type "keating timeline"
Sleep 1500ms
Enter
Sleep 4s

# 7. Check topics due for immediate active-recall review
Type "keating due"
Sleep 1500ms
Enter
Sleep 5s
