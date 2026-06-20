# Output docs/assets/intro.mp4
Output docs/assets/intro.mp4

Set FontSize 18
Set Width 1200
Set Height 700
Set Padding 40
Set Theme "Catppuccin Mocha"

# Boot the Keating shell — the Pi extension load takes a few seconds,
# so give it a generous fixed sleep instead of failing flakily.
Type "just shell"
Enter
Sleep 6s

# Inspect the current teaching policy (instant — no LLM round-trip)
Type "/policy"
Enter
Sleep 3s

# List available slash commands so the help table renders on screen
Type "/help"
Enter
Sleep 4s

Ctrl+D
Sleep 1s
