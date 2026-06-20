# Output docs/assets/session-flow.mp4
Output docs/assets/session-flow.mp4

Set FontSize 22
Set Width 1200
Set Height 600
Set Padding 40
Set Theme "Catppuccin Mocha"

# 1. Launch the Hyperteacher Shell. Pi boot is variable, so use a
#    generous fixed sleep instead of guessing a short window.
Type "just shell"
Enter
Sleep 6s

# 2. Inspect the current Teaching Policy (Instant — no LLM round-trip)
Type "/policy"
Enter
Sleep 3s

# 3. Browse generated artifacts (Instant — local fs scan)
Type "/outputs"
Enter
Sleep 2s
# Escape the selection menu once it has rendered
Escape
Sleep 1s

# 4. Record student signal (Instant)
Type "/feedback up Special Relativity"
Enter
Sleep 3s

# 5. Exit cleanly. Give the prompt a beat to return.
Ctrl+D
Sleep 1s
