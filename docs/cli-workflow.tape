# ==============================================================================
# Keating CLI Suite — Essential Learner Commands
#
# Covers key command-line workflows for learners who prefer terminal speed:
# session resumption, verification checklists, policy checks, spaced intervals,
# and session feedback.
# ==============================================================================

Output docs/assets/cli-workflow.mp4

Require bun

Set Shell "bash"
Set FontSize 19
Set Width 1280
Set Height 760
Set Padding 36
Set Theme "Catppuccin Mocha"
Set WindowBar "Colorful"
Set WindowBarSize 40

# Slow down typing so commands are readable and instructive
Set TypingSpeed 75ms

Hide
Type "alias keating='bun src/cli/main.ts'"
Enter
Type "clear"
Enter
Show

# 1. Verify pedagogical and algorithmic invariants for the topic
Type "keating verify 'Raft Consensus'"
Sleep 1500ms
Enter
Sleep 3s

# 2. Inspect the generated Chain-of-Verification checklist
Type "head -n 22 .keating/outputs/verifications/raft-consensus.md"
Sleep 1500ms
Enter
Sleep 4s

# 3. Inspect active hyperteacher teaching parameters
Type "keating policy"
Sleep 1500ms
Enter
Sleep 3s

# 4. Check topics due for active spaced-retrieval review
Type "keating due"
Sleep 1500ms
Enter
Sleep 4s

# 5. Record feedback on lesson clarity and Socratic scaffolding
Type "keating feedback up 'Raft Consensus' --comment='Clear Socratic hint on split votes'"
Sleep 1500ms
Enter
Sleep 4s
