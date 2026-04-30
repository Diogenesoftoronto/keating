# Output docs/assets/improve-flow.mp4
Output docs/assets/improve-flow.mp4

Set FontSize 20
Set Width 1280
Set Height 720
Set Padding 40
Set Theme "Catppuccin Mocha"

# 1. Benchmark the current policy
Type "mise run bench"
Enter
Sleep 4s

# 2. Run the evolutionary policy search
Type "mise run evolve"
Enter
Sleep 5s

# 3. Evolve the underlying learn prompt
Type "mise run prompt-evolve"
Enter
Sleep 5s

# 4. Generate a self-improvement proposal
Type "keating improve"
Enter
Sleep 3s

# 5. Inspect the running history of proposals
Type "keating improve history"
Enter
Sleep 3s
