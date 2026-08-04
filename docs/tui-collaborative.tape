# Output docs/assets/tui-collaborative.mp4
Output docs/assets/tui-collaborative.mp4

Set FontSize 20
Set Width 1280
Set Height 720
Set Padding 28
Set Theme "Catppuccin Mocha"

# Launch the collaborative OpenTUI host backed by Pi RPC with an initial prompt.
# Passing the prompt at launch is reliable across terminal keyboard protocols.
Type "bun src/cli/main.ts tui 'Why do cities form where they do?'"
Enter
Sleep 14s

Ctrl+C
Sleep 1s
