#!/usr/bin/env bash
# Keating 4.0 launch video — full reproducible pipeline.
#
#   ./produce.sh            stage → images → voice → motion → build → check → snapshots → render
#   ./produce.sh --no-render  stop after snapshots (fast iteration)
#
# Every network stage is cached (images by prompt hash, TTS/whisper by content hash),
# so a re-run only regenerates what changed. fal generates speech; OpenAI is used
# for Whisper word timings. Keys are read at runtime and never stored.
set -euo pipefail
cd "$(dirname "$0")"
HF="npx --yes hyperframes@0.8.74"

scripts/stage-assets.sh
scripts/gen-images.sh
node scripts/voice.mjs
node scripts/gen-motion.mjs   # H3 clips of the stills; needs timing.json
node scripts/build.mjs
npm run check

TOTAL=$(node -p 'require("./build/timing.json").total')
MIDS=$(node -p 'require("./build/timing.json").scenes.map(s => (s.start + s.duration * 0.7).toFixed(2)).join(",")')
rm -rf snapshots
$HF snapshot --at "$MIDS" --describe false
echo "[produce] snapshots/contact-sheet*.jpg — review before rendering (total ${TOTAL}s)"

[[ "${1:-}" == "--no-render" ]] && exit 0
mkdir -p renders
# Inside the Nix devenv shell, Nix's ldd (ignores /etc/ld.so.cache) makes HyperFrames'
# Chrome preflight report "missing system libraries" falsely; use the system loader view.
env -u LD_LIBRARY_PATH PATH="/usr/bin:$PATH" $HF render --quality delivery --fps 30 --output renders/keating-4-launch.mp4
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of compact renders/keating-4-launch.mp4
