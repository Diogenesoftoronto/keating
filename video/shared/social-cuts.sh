#!/usr/bin/env bash
# Renders every social cut of the published films into .keating/outputs/video/social.
#   bash video/shared/social-cuts.sh
# Cut windows are seconds into the web encodes in web/public/tapes; re-check them after a re-render.
set -euo pipefail
cd "$(dirname "$0")/../.."
T=web/public/tapes
O=.keating/outputs/video/social
mkdir -p "$O"
cut() { node video/shared/social.mjs "$@"; }

LAUNCH=("$T/keating-4-launch.mp4")
LAUNCH_CC=--captions=$T/captions/keating-4-launch.vtt
cut "${LAUNCH[@]}" "$O/launch-full-9x16.mp4" "$LAUNCH_CC"
cut "${LAUNCH[@]}" "$O/launch-full-1x1.mp4" "$LAUNCH_CC" --aspect=1:1
cut "${LAUNCH[@]}" "$O/launch-full-4x5.mp4" "$LAUNCH_CC" --aspect=4:5
cut "${LAUNCH[@]}" "$O/launch-hook-9x16.mp4" "$LAUNCH_CC" --to=11.9 --title="Seen this before?"
cut "${LAUNCH[@]}" "$O/launch-new-in-4-9x16.mp4" "$LAUNCH_CC" --from=39.2 --to=61.4 --title="New in Keating 4.0"

INTRO=("$T/keating-intro.mp4" --captions=$T/captions/keating-intro.vtt --label="KEATING // INTRO")
cut "${INTRO[@]}" "$O/intro-full-9x16.mp4"
cut "${INTRO[@]}" "$O/intro-full-1x1.mp4" --aspect=1:1
cut "${INTRO[@]}" "$O/intro-climb-9x16.mp4" --to=9.4 --title="Answers are cheap now."

TOUR=("$T/keating-surface-tour.mp4" --label="KEATING // TOUR")
cut "${TOUR[@]}" "$O/tour-9x16.mp4" --title="More than a chat."
cut "${TOUR[@]}" "$O/tour-1x1.mp4" --aspect=1:1

for id in judgements recall live onboarding; do
  label=$(node -p "require('./video/spotlights/$id/narration.json').label")
  cut "$T/keating-spotlight-$id.mp4" "$O/spotlight-$id-9x16.mp4" --captions=$T/captions/keating-spotlight-$id.vtt --label="$label"
done
