# ==============================================================================
# Keating Quiz — Socratic Retrieval Practice Generation
#
# Generates deterministic active-recall, comprehension, and transfer
# questions with rubrics and answer keys saved in .keating/outputs/quizzes/.
# ==============================================================================

Output docs/assets/quiz.mp4

Require bun

Set Shell "bash"
Set FontSize 20
Set Width 1280
Set Height 720
Set Padding 40
Set Theme "Catppuccin Mocha"
Set WindowBar "Colorful"
Set WindowBarSize 40

# Slow down typing so commands are deliberate and easy to follow
Set TypingSpeed 75ms

# Configure clean local alias so the tape replays the canonical 'keating' command
Hide
Type "alias keating='bun src/cli/main.ts'"
Enter
Type "clear"
Enter
Show

# 1. Compile retrieval practice questions for a topic
Type "keating quiz 'Bayes Theorem'"
Sleep 1500ms
Enter

# Give the viewer time to see generated artifact paths
Sleep 3s

# 2. Inspect the generated question card and rubrics
Type "head -n 27 .keating/outputs/quizzes/bayes-theorem.md"
Sleep 1500ms
Enter

# Pause to let the viewer read the questions, rubrics, and answer choices
Sleep 6s
