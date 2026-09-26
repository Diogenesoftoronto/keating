#!/usr/bin/env bash
# Copy/cut every asset the composition references into assets/ from the Keating repo.
# Idempotent: existing outputs are kept unless FORCE=1.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(git rev-parse --show-toplevel)"
BRAND="$REPO/web/public/brand"
TOUR="$REPO/video/keating-surface-tour/assets"
mkdir -p assets/bot assets/brand assets/stills assets/clips assets/fonts

fresh() { [[ "${FORCE:-0}" == 1 || ! -s "$1" ]]; }

# KeatingBot stop-motion atlases (1024x512, 4x2 frames, AVIF with alpha plane).
for s in body-waving body-thinking body-success body-understanding body-idle head-speaking head-listening; do
  fresh "assets/bot/$s.avif" && cp "$BRAND/stop-motion-v1/keatingbot-$s.avif" "assets/bot/$s.avif"
done

fresh assets/brand/logo-lockup.png && cp "$BRAND/logo-lockup-hd.png" assets/brand/logo-lockup.png
fresh assets/brand/logo-k.png && cp "$BRAND/logo-badge.png" assets/brand/logo-k.png

for s in feature-models feature-live feature-coming-up feature-courses; do
  fresh "assets/stills/$s.jpg" && cp "$TOUR/$s.jpg" "assets/stills/$s.jpg"
done

# Footage: re-timed so the interesting part fits a ~5 s beat. H.264, no audio, 30 fps.
cut() { # out src start speed
  fresh "assets/clips/$1.mp4" || return 0
  ffmpeg -v error -y -ss "$3" -i "$2" -an -vf "setpts=PTS/$4,fps=30,scale=1920:-2:flags=lanczos" \
    -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -movflags +faststart "assets/clips/$1.mp4"
}
cut classroom "$TOUR/web-classroom.mp4" 0 2.1
cut tui "$TOUR/tui-collaborative.mp4" 3 1.6
cut cli "$TOUR/cli-artifacts.mp4" 0 2.4
fresh assets/stills/web-classroom.jpg &&
  ffmpeg -v error -y -sseof -0.4 -i "$TOUR/web-classroom.mp4" -frames:v 1 -vf scale=1920:-2 -q:v 2 assets/stills/web-classroom.jpg

# Fonts: Keating's web fonts (Space Mono, JetBrains Mono, Roboto), latin subset, as local woff2.
if fresh assets/fonts/fonts.css; then
  UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
  css="$(curl -fsSL -A "$UA" "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=JetBrains+Mono:wght@400;500;700&family=Roboto:wght@500;900&display=block")"
  # Keep only the /* latin */ blocks, download each src, rewrite to local paths.
  echo "$css" | awk '/\/\* latin \*\//{p=1} p{print} /}/{if(p){p=0}}' >assets/fonts/fonts.css.tmp
  grep -o 'https://fonts.gstatic.com[^)]*' assets/fonts/fonts.css.tmp | sort -u | while read -r url; do
    f="assets/fonts/$(basename "$url")"; [[ -s "$f" ]] || curl -fsSL "$url" -o "$f"
  done
  sed -E 's#https://fonts.gstatic.com/[^)]*/([^/)]+)#\1#' assets/fonts/fonts.css.tmp >assets/fonts/fonts.css
  rm assets/fonts/fonts.css.tmp
fi
echo "[stage] assets ready"
