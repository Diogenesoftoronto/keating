# ==============================================================================
# Keating Feedback — Session Annotations & Learner Signals
#
# Records explicit student signals (up, down, confused) with optional
# qualitative comments, updating topic engagement and review urgency.
# ==============================================================================

Output docs/assets/feedback.mp4

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

# 1. Record positive learner signal with rationale after a lesson turn
Type "keating feedback up 'Special Relativity' --comment='Clear intuition on frame transformations'"
Sleep 1500ms
Enter

# Give the viewer time to see the confirmation receipt
Sleep 4s

# 2. Check the updated timeline to see the recorded signal in context
Type "keating timeline"
Sleep 1500ms
Enter

# Pause to inspect the updated session count and status
Sleep 6s
