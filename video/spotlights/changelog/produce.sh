#!/usr/bin/env bash
# Rebuild locally from the canonical narration and warm speech cache. Never call paid APIs.
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-}" in ""|--no-render) ;; *) echo "Usage: ./produce.sh [--no-render]" >&2; exit 2;; esac
FILM_DIR="$PWD"
FILM_ID="$(basename "$FILM_DIR")"
OUTPUT=$(node -p 'require("./narration.json").output || "keating-spotlight-" + process.argv[1]' "$FILM_ID")
export KEATING_OFFLINE=1
export npm_config_cache="${npm_config_cache:-$FILM_DIR/.hyperframes/npm-cache}"
# Headless hosts can stall in the hardware probe; callers may opt into hardware.
export PRODUCER_BROWSER_GPU_MODE="${PRODUCER_BROWSER_GPU_MODE:-software}"
mkdir -p build
# HyperFrames disables compositing in software mode, forcing synchronous WebGL
# readbacks. Keep SwiftShader but let Chrome composite its textures directly.
# This wrapper changes the rendering path; it does not filter console warnings.
if [[ "$PRODUCER_BROWSER_GPU_MODE" == software ]]; then
  KEATING_CHROME_BINARY="${HYPERFRAMES_BROWSER_PATH:-${PRODUCER_HEADLESS_SHELL_PATH:-}}"
  if [[ -z "$KEATING_CHROME_BINARY" ]]; then
    KEATING_CHROME_BINARY=$(node --input-type=module - <<'JS'
import {globSync} from 'node:fs';
import {homedir} from 'node:os';
const paths=globSync(`${homedir()}/.cache/hyperframes/chrome/chrome-headless-shell/*/chrome-headless-shell-*/chrome-headless-shell`);
console.log(paths.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1) ?? '');
JS
)
  fi
  if [[ -n "$KEATING_CHROME_BINARY" ]]; then
    export KEATING_CHROME_BINARY
    cat > build/chrome-headless-shell <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args=()
for arg in "$@"; do
  [[ "$arg" == --disable-gpu-compositing ]] || args+=("$arg")
done
exec "$KEATING_CHROME_BINARY" "${args[@]}"
SH
    chmod +x build/chrome-headless-shell
    export HYPERFRAMES_BROWSER_PATH="$FILM_DIR/build/chrome-headless-shell"
    export PRODUCER_HEADLESS_SHELL_PATH="$HYPERFRAMES_BROWSER_PATH"
  fi
fi
HF=(npx --yes "$(node -p 'require("./package.json").scripts.check.match(/hyperframes@\S+/)[0]')")
# Full renders always refresh staged assets and execute the current shared pipeline.
if [[ "${1:-}" != "--no-render" ]]; then export FORCE=1; fi
../shared/scripts/stage-assets.sh "$FILM_DIR"
node ../shared/scripts/voice.mjs "$FILM_DIR"
node ../shared/scripts/build.mjs "$FILM_DIR"
npm run check -- --strict

# Early, middle, and late frames cover the dissolves, titles, and logo hold.
MIDS=$(node -p 'require("./build/timing.json").scenes.flatMap(s => [.2,.5,.82].map(f => (s.start+s.duration*f).toFixed(2))).join(",")')
"${HF[@]}" snapshot --at "$MIDS" --describe false
echo "[produce] Review snapshots/contact-sheet*.jpg"
[[ "${1:-}" == "--no-render" ]] && exit 0
mkdir -p renders
# System loader avoids a false Chrome preflight failure inside the Nix shell.
env -u LD_LIBRARY_PATH PATH="/usr/bin:$PATH" "${HF[@]}" render --quality delivery --fps 30 --output "renders/${OUTPUT}.mp4"
# Preserve the measured -14 LUFS music master through delivery. HyperFrames'
# audio assembly changes its level; remux the approved master without re-encoding picture.
TOTAL=$(node -p 'require("./build/timing.json").total')
ffmpeg -v error -y -i "renders/${OUTPUT}.mp4" -i assets/audio/mix.wav \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 320k -movflags +faststart \
  -t "$TOTAL" "build/${OUTPUT}-mastered.mp4"
cp "build/${OUTPUT}-mastered.mp4" "renders/${OUTPUT}.mp4"
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of compact "renders/${OUTPUT}.mp4"
