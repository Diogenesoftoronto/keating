#!/usr/bin/env bash
set -euo pipefail
# Headless GPU compositing keeps the production flashcard's 3D faces readable.
# The shared video capturer passes --disable-gpu; replace that with SwiftShader.
capture_args=()
for capture_arg in "$@"; do
  if [ "$capture_arg" != "--disable-gpu" ]; then
    capture_args+=("$capture_arg")
  fi
done
exec google-chrome --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader "${capture_args[@]}"
