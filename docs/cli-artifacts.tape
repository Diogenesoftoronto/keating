# ==============================================================================
# Keating CLI Artifacts — Deterministic Pedagogy Compilation
#
# Compiles inspectable lesson plans, Mermaid concept maps, and
# verification checklists, and inspects the trace trail.
# ==============================================================================

Output docs/assets/cli-artifacts.mp4

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

# 1. Compile a deterministic lesson plan artifact
Type "keating plan 'Special Relativity'"
Sleep 1500ms
Enter

# Give the viewer time to see the generated artifact path
Sleep 3s

# 2. Inspect the generated lesson plan in the terminal
Type "sed -n '1,18p' .keating/outputs/plans/special-relativity.md"
Sleep 1500ms
Enter

# Pause to let the viewer read the pedagogical sequence
Sleep 5s

# 3. Compile the companion Mermaid concept map
Type "keating map 'Special Relativity'"
Sleep 1500ms
Enter

Sleep 3s

# 4. Generate the fact-checking verification checklist
Type "keating verify 'Special Relativity'"
Sleep 1500ms
Enter

Sleep 3s

# 5. Inspect the persistent artifact trace trail
Type "keating trace special-relativity"
Sleep 1500ms
Enter

# Pause to let the viewer study the complete trace record
Sleep 6s
