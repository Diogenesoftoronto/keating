#!/usr/bin/env bash
# Generate textless illustrations with Codex image generation.
# Cached: an image is regenerated only when its prompt file changes (hash stamp).
set -euo pipefail
cd "$(dirname "$0")/.."
REF="../../web/public/brand/mascot-full.png"
mkdir -p assets/gen
for prompt in prompts/images/*.txt; do
  name="$(basename "$prompt" .txt)"
  out="assets/gen/$name.png"
  hash="$(sha256sum "$prompt" | cut -c1-16)"
  if [[ -f "$out" && "$(cat "assets/gen/$name.hash" 2>/dev/null)" == "$hash" ]]; then
    echo "[images] $name cached"; continue
  fi
  echo "[images] generating $name via codex…"
  work="$(mktemp -d)"
  text="$(cat "$prompt")

Use your image generation tool. When done, copy the generated PNG into the current working directory as out.png (it is saved under \$CODEX_HOME/generated_images). Do not write anything else."
  # The prompt goes before --image: that flag is variadic and would swallow it.
  args=(exec --skip-git-repo-check --sandbox workspace-write -C "$work" "$text")
  grep -q "reference image" "$prompt" && { cp "$REF" "$work/reference.png"; args+=(--image "$work/reference.png"); }
  codex "${args[@]}" </dev/null >"$work/codex.log" 2>&1 || { tail -20 "$work/codex.log"; exit 1; }
  [[ -f "$work/out.png" ]] || { echo "codex produced no out.png ($work/codex.log)"; exit 1; }
  magick "$work/out.png" -resize 1920x1080^ -gravity center -extent 1920x1080 "$out"
  echo "$hash" >"assets/gen/$name.hash"
  rm -rf "$work"
done
