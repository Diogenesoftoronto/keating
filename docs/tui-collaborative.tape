# Sacred TUI product tour. This exercises the current `keating tui` source host
# in an isolated project with a deterministic, loopback-only OpenAI-compatible model.
# The fixture makes the capture repeatable without reading operator credentials.

Output docs/assets/tui-collaborative.mp4

Require bun
Require curl
Require sed

Set Shell "bash"
Set FontSize 18
Set Width 1440
Set Height 900
Set Padding 28
Set Framerate 25
Set TypingSpeed 28ms
Set Theme "Catppuccin Mocha"

# Keep transient sessions out of the repository and never show a home path.
Hide
Type "KEATING_CAPTURE_REPO=$PWD; KEATING_CAPTURE_TMP=$(mktemp -d); KEATING_DEMO_PORT=$((49152 + RANDOM % 10000)); mkdir -p $KEATING_CAPTURE_TMP/.keating/pi-config; sed s/58173/$KEATING_DEMO_PORT/ $KEATING_CAPTURE_REPO/docs/fixtures/tui-demo-models.json >$KEATING_CAPTURE_TMP/.keating/pi-config/models.json; cp $KEATING_CAPTURE_REPO/docs/fixtures/tui-demo-auth.json $KEATING_CAPTURE_TMP/.keating/pi-config/auth.json; cp $KEATING_CAPTURE_REPO/docs/fixtures/tui-demo-config.json $KEATING_CAPTURE_TMP/keating.config.json; bun $KEATING_CAPTURE_REPO/scripts/tui-demo-provider.mjs $KEATING_DEMO_PORT >$KEATING_CAPTURE_TMP/provider.log 2>&1 & KEATING_DEMO_PID=$!; KEATING_DEMO_READY=; for attempt in 1 2 3 4 5 6 7 8 9 10; do kill -0 $KEATING_DEMO_PID 2>/dev/null || break; if curl -fsS http://127.0.0.1:$KEATING_DEMO_PORT/health >/dev/null; then KEATING_DEMO_READY=1; break; fi; sleep 0.1; done; test $KEATING_DEMO_READY = 1 || { cat $KEATING_CAPTURE_TMP/provider.log; exit 1; }; trap 'kill $KEATING_DEMO_PID 2>/dev/null || true; wait $KEATING_DEMO_PID 2>/dev/null || true; case $KEATING_CAPTURE_TMP in /tmp/tmp.*) rm -rf -- $KEATING_CAPTURE_TMP;; esac' EXIT; cd $KEATING_CAPTURE_TMP"
Enter
Sleep 1s
Show

# An initial learner turn makes the outgoing message layer, phase-specific
# loader, streaming tutor layer, avatar, and activity stack visible together.
Type "bun $KEATING_CAPTURE_REPO/src/cli/main.ts tui 'In three sentences, explain why proof by contradiction works.'"
Enter
Sleep 4s
Sleep 14s

# Collapse and restore the layered side panel. Restoring it moves focus into
# ACTIONS, making keyboard selection visible without a mouse-only demo.
Ctrl+B
Sleep 2s
Ctrl+B
Sleep 2s

# ACTIONS starts on COMMANDS. Move to MODELS and activate it. The authenticated
# provider is sorted first; its current model is sorted first within the group.
Down 2
Sleep 1s
Enter
Sleep 3s
Enter
Sleep 3s

# Briefly highlight a second configured model when one exists, then retain the
# current model so the capture does not silently alter the operator's choice.
Down
Sleep 2s
Up
Enter
Sleep 2s
Escape

# A follow-up adds another outgoing/incoming pair and shows the loader phrases
# with the selected provider/model context still visible in the header.
Type "Give me one tiny numerical example."
Enter
Sleep 4s
Sleep 14s

# Open the production session browser, choose the active transcript, and clone
# its whole branch. Text filtering makes the action deterministic.
Ctrl+S
Sleep 2s
Enter
Enter
Sleep 2s
Type "Fork whole current branch"
Sleep 1s
Enter
Enter
Sleep 4s

# Focus the fork-aware SESSION TREE and highlight its child branch. The tree
# uses opaque session values, so no absolute session path is ever painted.
Tab
Tab
Tab
Sleep 2s
Down
Sleep 3s
Escape

Ctrl+C
Sleep 1s
Hide
Type "kill $KEATING_DEMO_PID 2>/dev/null || true"
Enter
Type "wait $KEATING_DEMO_PID 2>/dev/null || true; cd /; case $KEATING_CAPTURE_TMP in /tmp/tmp.*) rm -rf -- $KEATING_CAPTURE_TMP;; esac; trap - EXIT"
Enter
