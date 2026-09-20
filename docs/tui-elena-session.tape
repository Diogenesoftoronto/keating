# ==============================================================================
# Keating TUI Lesson — Learner Profile: Elena Chen
# Topic: Raft Consensus & Log Matching Invariant
#
# Elena Chen uses Keating's Terminal UI side-by-side with her editor.
# Exercises keyboard navigation, Ctrl+B action drawer, model inspection,
# and Socratic back-and-forth dialogue on distributed consensus.
# ==============================================================================

Output docs/assets/tui-elena-session.mp4

Require bun
Require curl
Require sed

Set Shell "bash"
Set FontSize 18
Set Width 1440
Set Height 900
Set Padding 28
Set Framerate 25
Set TypingSpeed 75ms
Set Theme "Catppuccin Mocha"

# Configure deterministic loopback test provider
Hide
Type "KEATING_CAPTURE_REPO=$PWD; KEATING_CAPTURE_TMP=$(mktemp -d); KEATING_DEMO_PORT=$((49152 + RANDOM % 10000)); mkdir -p $KEATING_CAPTURE_TMP/.keating/pi-config; sed s/58173/$KEATING_DEMO_PORT/ $KEATING_CAPTURE_REPO/docs/fixtures/tui-demo-models.json >$KEATING_CAPTURE_TMP/.keating/pi-config/models.json; cp $KEATING_CAPTURE_REPO/docs/fixtures/tui-demo-auth.json $KEATING_CAPTURE_TMP/.keating/pi-config/auth.json; cp $KEATING_CAPTURE_REPO/docs/fixtures/tui-demo-config.json $KEATING_CAPTURE_TMP/keating.config.json; bun $KEATING_CAPTURE_REPO/scripts/tui-demo-provider.mjs $KEATING_DEMO_PORT >$KEATING_CAPTURE_TMP/provider.log 2>&1 & KEATING_DEMO_PID=$!; KEATING_DEMO_READY=; for attempt in 1 2 3 4 5 6 7 8 9 10; do kill -0 $KEATING_DEMO_PID 2>/dev/null || break; if curl -fsS http://127.0.0.1:$KEATING_DEMO_PORT/health >/dev/null; then KEATING_DEMO_READY=1; break; fi; sleep 0.1; done; test $KEATING_DEMO_READY = 1 || { cat $KEATING_CAPTURE_TMP/provider.log; exit 1; }; trap 'kill $KEATING_DEMO_PID 2>/dev/null || true; wait $KEATING_DEMO_PID 2>/dev/null || true; case $KEATING_CAPTURE_TMP in /tmp/tmp.*) rm -rf -- $KEATING_CAPTURE_TMP;; esac' EXIT; cd $KEATING_CAPTURE_TMP"
Enter
Sleep 1s
Show

# 1. Launch Keating TUI with Elena's initial question on Raft consensus
Type "bun $KEATING_CAPTURE_REPO/src/cli/main.ts tui 'Explain Raft log matching invariant with a Socratic question.'"
Enter

# Give the tutor time to stream the Socratic challenge
Sleep 8s

# 2. Toggle the actions and navigation drawer with Ctrl+B
Ctrl+B
Sleep 2s

# 3. Navigate to MODELS to inspect active model selection
Down 2
Sleep 1s
Enter
Sleep 2s

# Return to chat view
Escape
Sleep 2s

# 4. Answer the Socratic question with Elena's reasoning
Type "Each node can only cast one vote per term, so two majorities cannot overlap."
Sleep 1s
Enter

# Allow viewer to observe the completed interaction turn
Sleep 6s
