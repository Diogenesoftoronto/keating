#!/usr/bin/env bash
# Publishes rendered spotlights to the web: CRF 25 +faststart encode, a 1280-wide poster from the middle
# of the opening scene, and WebVTT captions from the word timings.
#   bash video/spotlights/publish.sh [judgements recall live onboarding manifesto lesson changelog]
set -euo pipefail
cd "$(dirname "$0")/../.."
T=web/public/tapes
for id in "${@:-judgements recall live onboarding}"; do
  for id in $id; do
    film=video/spotlights/$id
    [[ -f "$film/narration.json" ]] || { echo "skip $id (unknown film)"; continue; }
    output=$(node -e 'const s=require(process.argv[1]);console.log(s.output || `keating-spotlight-${process.argv[2]}`)' "./$film/narration.json" "$id")
    render=$film/renders/$output.mp4
    [[ -s "$render" ]] || { echo "skip $id (no render)"; continue; }
    mkdir -p "$T/posters" "$T/captions"
    ffmpeg -v error -y -i "$render" -c:v libx264 -crf 25 -preset slow -pix_fmt yuv420p -c:a aac -b:a 128k \
      -movflags +faststart "$T/$output.mp4"
    at=$(node -p "const s=require('./$film/build/timing.json').scenes[0]; (s.start+s.duration*0.6).toFixed(2)")
    ffmpeg -v error -y -ss "$at" -i "$render" -frames:v 1 -vf scale=1280:-2 -q:v 3 "$T/posters/$output.jpg"
    if [[ "$(node -p "require('./$film/narration.json').voice !== false")" == true ]]; then
      node video/shared/captions.mjs launch "$film/build/timing.json" "$T/captions/$output.vtt"
    fi
    seconds=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$T/$output.mp4")
    printf '%s %d:%02d\n' "$id" "$(( ${seconds%.*} / 60 ))" "$(( ${seconds%.*} % 60 ))"
  done
done
