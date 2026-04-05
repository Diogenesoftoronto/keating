# Output docs/assets/teacher-flow.mp4
Output docs/assets/teacher-flow.mp4

Set FontSize 22
Set Width 1200
Set Height 600
Set Padding 40
Set Theme "Catppuccin Mocha"

# 1. Generate & Inspect Plan
Type "mise run plan -- 'Special Relativity'"
Enter
Sleep 1s
Type "head -n 12 .keating/outputs/plans/special-relativity.md"
Enter
Sleep 3s

# 2. Check Automated Verification
Type "mise run verify -- 'Special Relativity'"
Enter
Sleep 1s
Type "head -n 15 .keating/outputs/verifications/special-relativity.md"
Enter
Sleep 4s
