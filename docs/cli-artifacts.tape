# Output docs/assets/cli-artifacts.mp4
Output docs/assets/cli-artifacts.mp4

Set FontSize 20
Set Width 1280
Set Height 720
Set Padding 40
Set Theme "Catppuccin Mocha"

# Build a real study artifact with the current Bun entrypoint.
Type "bun src/cli/main.ts plan 'Special Relativity'"
Enter
Sleep 2s

# Read the generated lesson plan in the same terminal.
Type "sed -n '1,18p' .keating/outputs/plans/special-relativity.md"
Enter
Sleep 4s

# Generate the companion map and verification checklist.
Type "bun src/cli/main.ts map 'Special Relativity'"
Enter
Sleep 2s
Type "bun src/cli/main.ts verify 'Special Relativity'"
Enter
Sleep 2s

# Finish by showing the inspectable artifact trail.
Type "bun src/cli/main.ts trace special-relativity"
Enter
Sleep 4s
