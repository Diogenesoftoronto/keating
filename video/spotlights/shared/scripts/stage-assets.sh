#!/usr/bin/env bash
# Usage: stage-assets.sh <film-dir> (defaults to cwd). Existing assets are reused;
# FORCE=1 refreshes them. Source launch assets and narration are never modified.
set -euo pipefail
FILM="$(cd "${1:-.}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
LAUNCH="$REPO/video/keating-launch/assets"
STORYBOARD="$REPO/video/spotlights/storyboard"
MOTION="$REPO/video/spotlights/motion"
FILM_ID="$(basename "$FILM")"
SHOTS="$REPO/.keating/outputs/video/spotlight-$FILM_ID/public/shots"
mkdir -p "$FILM/assets/"{fonts,bot,brand,art,motion,shots,music}

fresh() { [[ "${FORCE:-0}" == 1 || ! -s "$1" ]]; }
copy() {
  [[ -s "$1" ]] || { echo "[stage] required asset missing: $1" >&2; return 1; }
  if fresh "$2"; then cp "$1" "$2"; fi
}

for family in fonts bot brand; do
  [[ -d "$LAUNCH/$family" ]] || { echo "[stage] launch assets missing: $LAUNCH/$family" >&2; exit 1; }
  for source in "$LAUNCH/$family/"*; do
    [[ -f "$source" ]] || continue
    copy "$source" "$FILM/assets/$family/$(basename "$source")"
  done
done

# Read only names in the film's canonical narration; adding a film needs no script edits.
mapfile -t ART_NAMES < <(node -e 'const s=require(process.argv[1]);for(const x of new Set(s.scenes.flatMap(x=>x.art||[])))console.log(x)' "$FILM/narration.json")
mapfile -t SHOT_NAMES < <(node -e 'const s=require(process.argv[1]);for(const x of new Set(s.scenes.flatMap(x=>x.shots||[])))console.log(x)' "$FILM/narration.json")
for name in "${ART_NAMES[@]}"; do copy "$STORYBOARD/$name.png" "$FILM/assets/art/$name.png"; done

# Only approved, top-level clips. Never recurse into motion/rejected or generate video.
for source in "$MOTION/"*.mp4; do
  [[ -f "$source" ]] || continue
  copy "$source" "$FILM/assets/motion/$(basename "$source")"
done

# Music is a pre-existing paid source; staging never generates or replaces it.
MUSIC="$REPO/video/spotlights/music/$FILM_ID.mp3"
if [[ -s "$MUSIC" ]]; then copy "$MUSIC" "$FILM/assets/music/$FILM_ID.mp3"; fi

capture=0
if (( ${#SHOT_NAMES[@]} == 0 )); then
  echo "[stage] $FILM_ID has no shots; capture skipped"
else
  for name in "${SHOT_NAMES[@]}"; do [[ -s "$SHOTS/$name.png" ]] || capture=1; done
  if [[ "$capture" == 1 ]]; then
    (cd "$REPO" && node video/shared/capture.mjs "video/spotlight-$FILM_ID/shots.json" "$SHOTS")
  fi
  for name in "${SHOT_NAMES[@]}"; do copy "$SHOTS/$name.png" "$FILM/assets/shots/$name.png"; done
fi
echo "[stage] $FILM_ID assets ready"
