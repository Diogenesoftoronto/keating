#!/usr/bin/env bash
# Rebuild the film from its canonical narration and template. Network work is cached.
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-}" in ""|--no-render) ;; *) echo "Usage: ./produce.sh [--no-render]" >&2; exit 2;; esac
FILM_DIR="$PWD"
FILM_ID="$(basename "$FILM_DIR")"
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
FORCE=1 ../shared/scripts/stage-assets.sh "$FILM_DIR"
# Tight, reproducible detail crops of the supplied captures; originals stay intact.
node --input-type=module - <<'JS'
import {execFileSync} from 'node:child_process';
const crops = {
 'welcome-detail': ['welcome',1068,115,90,100],
 'teach-ask': ['teach',1040,330,100,620],
 'teach-analogy': ['teach',1040,290,100,1180],
 'access-plain': ['access',1040,180,100,710],
 'access-captions': ['access',1040,180,100,1110],
 'access-type': ['access',1040,180,100,1310],
 'access-motion': ['access',800,50,125,1540],
 'pursuit-detail': ['pursuit',1040,490,100,450],
 'persona-detail': ['persona',1800,730,740,230],
 'tour-detail': ['tour',1040,360,100,450]
};
for (const [name,[source,w,h,x,y]] of Object.entries(crops)) {
 execFileSync('ffmpeg',['-v','error','-y','-i',`assets/shots/${source}.png`,'-vf',`crop=${w}:${h}:${x}:${y}`,'-frames:v','1','-update','1',`assets/shots/${name}.png`]);
}
JS
node ../shared/scripts/voice.mjs "$FILM_DIR"
node ../shared/scripts/build.mjs "$FILM_DIR"
npm run check

# Early, middle, and late proof frames cover art-to-product handoffs and the logo hold.
MIDS=$(node --input-type=module - <<'JS'
import {readFileSync} from 'node:fs';
const {scenes}=JSON.parse(readFileSync('build/timing.json','utf8'));
const cues={optional:['click'],dials:['ask','stuck','analogies'],access:['plain','captions','easier','less'],pursuit:["today's"],teacher:['voice'],tour:['Show']};
const norm=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const times=scenes.flatMap(s=>[...[.2,.5,.82].map(f=>s.start+s.duration*f),...(cues[s.id]??[]).map(c=>{const word=s.words.find(w=>norm(w.w)===norm(c));if(!word)throw Error(`Missing review cue ${s.id}/${c}`);return Math.min(word.s+.4,s.start+s.duration-.1)})]);
console.log([...new Set(times.map(t=>t.toFixed(2)))].sort((a,b)=>a-b).join(','));
JS
)
"${HF[@]}" snapshot --at "$MIDS" --describe false
echo "[produce] Review snapshots/contact-sheet*.jpg"
[[ "${1:-}" == "--no-render" ]] && exit 0
mkdir -p renders
# System loader avoids a false Chrome preflight failure inside the Nix shell.
env -u LD_LIBRARY_PATH PATH="/usr/bin:$PATH" "${HF[@]}" render --quality delivery --fps 30 --output "renders/keating-spotlight-${FILM_ID}.mp4"
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of compact "renders/keating-spotlight-${FILM_ID}.mp4"
