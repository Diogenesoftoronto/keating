# ==============================================================================
# Keating Review Timeline — Spaced Repetition & Retention Curves
#
# Inspects learner engagement history, estimated retention decay,
# and surfaces the queue of concepts due for spaced recall review.
# ==============================================================================

Output docs/assets/review-timeline.mp4

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

# 1. Inspect the overall engagement timeline and retention decay
Type "keating timeline"
Sleep 1500ms
Enter

# Give the viewer time to read topic retention bars and mastery scores
Sleep 5s

# 2. Check which concepts are due for spaced review right now
Type "keating due"
Sleep 1500ms
Enter

# Pause to inspect the due review priorities
Sleep 6s
