# Output docs/assets/session-flow.mp4
Output docs/assets/session-flow.mp4

Set FontSize 22
Set Width 1200
Set Height 600
Set Padding 40
Set Theme "Catppuccin Mocha"

# 1. Launch the Hyperteacher Shell
Type "mise run shell"
Enter
# Wait for Pi to boot and extensions to load
Sleep 4s

# 2. Inspect the current Teaching Policy (Instant)
Type "/policy"
Enter
Sleep 2s

# 3. Browse generated artifacts (Instant)
Type "/outputs"
Enter
Sleep 1.5s
# Escape selection menu
Escape
Sleep 1s

# 4. Record student signal (Instant)
Type "/feedback up Special Relativity"
Enter
Sleep 2s

# Exit
Ctrl+D
Sleep 1s
