# Deterministic first-run capture against the current `keating tui` source host.
# Pi auth is intentionally isolated so the local-interface path is always
# available and the recording never reads or exposes real credentials.

Output docs/assets/tui-onboarding.mp4

Require bun

Set Shell "bash"
Set FontSize 18
Set Width 1440
Set Height 900
Set Padding 28
Set Framerate 25
Set TypingSpeed 30ms
Set Theme "Catppuccin Mocha"

# Prepare a clean project, a local portrait and an isolated `keating` command
# without showing temp/home paths. A clean Pi agent directory guarantees the
# no-provider onboarding branch; on camera only `keating tui` is typed.
Hide
Type "KEATING_CAPTURE_REPO=$PWD; KEATING_CAPTURE_TMP=$(mktemp -d); trap 'case $KEATING_CAPTURE_TMP in /tmp/tmp.*) rm -rf -- $KEATING_CAPTURE_TMP;; esac' EXIT; cd $KEATING_CAPTURE_TMP; cp $KEATING_CAPTURE_REPO/web/public/avatars/learner-newsprint.png ./portrait.png; keating() { env -i HOME=$HOME PATH=$PATH TERM=$TERM COLORTERM=$COLORTERM LANG=$LANG PI_CODING_AGENT_DIR=$KEATING_CAPTURE_TMP/pi bun $KEATING_CAPTURE_REPO/src/cli/main.ts $@; }; clear"
Enter
Show

Type "keating tui"
Enter
Sleep 7s

# The eight-step first-run tour advances with Space. The last step's Space
# opens profile setup with the learner-name field focused.
Sleep 2s
Space
Sleep 3s
Space
Sleep 2500ms
Space
Sleep 2500ms
Space
Sleep 2500ms
Space
Sleep 2500ms
Space
Sleep 2500ms
Space
Sleep 3s
Space
Sleep 2s

# Replace the default display name without relying on selection shortcuts.
Backspace 7
Type "Mina"
Enter
Sleep 2s

# Pause on every avatar choice, then exercise the user-supplied local-image
# path. The image is rasterized into the exact 4-column x 2-row terminal slot.
Sleep 2s
Down
Sleep 1s
Down
Sleep 2s
Enter
Type "./portrait.png"
Enter
Sleep 3s

# With auth isolated, continue through the local tour. Filtering by exact text
# is stable even if the menu gains more recovery actions later.
Type "Continue with local interface tour"
Sleep 2s
Enter
Enter
Sleep 2s

Type "medium"
Sleep 1s
Enter
Enter
Sleep 2s

Type "Recommended"
Sleep 1s
Enter
Enter
Sleep 4s

# Show the completed custom portrait and focus progression through the panel.
Ctrl+B
Sleep 2s
Ctrl+B
Sleep 3s
Tab
Sleep 3s
Escape

Ctrl+C
Sleep 1s
Hide
Type "cd /; case $KEATING_CAPTURE_TMP in /tmp/tmp.*) rm -rf -- $KEATING_CAPTURE_TMP;; esac; trap - EXIT"
Enter
