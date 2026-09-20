# ==============================================================================
# Keating Doctor — Environment & Runtime Diagnostics
#
# Inspects AI provider setup, model preferences, thinking budgets,
# and renderer configurations for deterministic artifacts.
# ==============================================================================

Output docs/assets/doctor.mp4

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

# 1. Run the Keating doctor to inspect runtime configuration
Type "keating doctor"
Sleep 1500ms
Enter

# Give the viewer time to inspect the full diagnostic report
Sleep 6s
