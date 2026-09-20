# ==============================================================================
# Keating Policy — Active Socratic Teaching Configuration
#
# Prints the current pedagogy scalars: Socratic ratio, analogy density,
# formalism, retrieval practice weighting, and challenge rates.
# ==============================================================================

Output docs/assets/policy.mp4

Require bun

Set Shell "bash"
Set FontSize 22
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

# 1. Inspect the active Socratic teaching policy
Type "keating policy"
Sleep 1500ms
Enter

# Pause to let the viewer study the active pedagogical weights
Sleep 6s
