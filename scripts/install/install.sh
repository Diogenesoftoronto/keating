#!/bin/sh

set -eu

VERSION="${1:-latest}"
INSTALL_BIN_DIR="${KEATING_INSTALL_BIN_DIR:-$HOME/.local/bin}"
INSTALL_APP_DIR="${KEATING_INSTALL_APP_DIR:-$HOME/.local/share/keating}"
SKIP_PATH_UPDATE="${KEATING_INSTALL_SKIP_PATH_UPDATE:-0}"
path_action="already"
path_profile=""

step() {
  printf '==> %s\n' "$1"
}

run_with_spinner() {
  label="$1"
  shift

  if [ ! -t 2 ]; then
    step "$label"
    "$@"
    return
  fi

  "$@" &
  pid=$!
  frame=0

  set +e
  while kill -0 "$pid" 2>/dev/null; do
    case "$frame" in
      0) spinner='|' ;;
      1) spinner='/' ;;
      2) spinner='-' ;;
      *) spinner='\\' ;;
    esac
    printf '\r==> %s %s' "$label" "$spinner" >&2
    frame=$(( (frame + 1) % 4 ))
    sleep 0.1
  done
  wait "$pid"
  status=$?
  set -e

  printf '\r\033[2K' >&2
  if [ "$status" -ne 0 ]; then
    printf '==> %s failed\n' "$label" >&2
    return "$status"
  fi

  step "$label"
}

normalize_version() {
  case "$1" in
    "")
      printf 'latest\n'
      ;;
    latest | stable)
      printf 'latest\n'
      ;;
    v*)
      printf '%s\n' "${1#v}"
      ;;
    *)
      printf '%s\n' "$1"
      ;;
  esac
}

download_file() {
  url="$1"
  output="$2"

  if command -v curl >/dev/null 2>&1; then
    if [ -t 2 ]; then
      curl -fL --progress-bar "$url" -o "$output"
    else
      curl -fsSL "$url" -o "$output"
    fi
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    if [ -t 2 ]; then
      wget --show-progress -O "$output" "$url"
    else
      wget -q -O "$output" "$url"
    fi
    return
  fi

  echo "curl or wget is required to install Keating." >&2
  exit 1
}

download_text() {
  url="$1"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -q -O - "$url"
    return
  fi

  echo "curl or wget is required to install Keating." >&2
  exit 1
}

add_to_path() {
  path_action="already"
  path_profile=""

  case ":$PATH:" in
    *":$INSTALL_BIN_DIR:"*)
      return
      ;;
  esac

  if [ "$SKIP_PATH_UPDATE" = "1" ]; then
    path_action="skipped"
    return
  fi

  profile="${KEATING_INSTALL_SHELL_PROFILE:-$HOME/.profile}"
  if [ -z "${KEATING_INSTALL_SHELL_PROFILE:-}" ]; then
    case "${SHELL:-}" in
      */zsh)
        profile="$HOME/.zshrc"
        ;;
      */bash)
        profile="$HOME/.bashrc"
        ;;
    esac
  fi

  path_profile="$profile"
  path_line="export PATH=\"$INSTALL_BIN_DIR:\$PATH\""
  if [ -f "$profile" ] && grep -F "$path_line" "$profile" >/dev/null 2>&1; then
    path_action="configured"
    return
  fi

  {
    printf '\n# Added by Keating installer\n'
    printf '%s\n' "$path_line"
  } >>"$profile"
  path_action="added"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required to install Keating." >&2
    exit 1
  fi
}

warn_command_conflict() {
  expected_path="$INSTALL_BIN_DIR/keating"
  resolved_path="$(command -v keating 2>/dev/null || true)"

  if [ -z "$resolved_path" ]; then
    return
  fi

  if [ "$resolved_path" != "$expected_path" ]; then
    step "Warning: current shell resolves keating to $resolved_path"
    step "Run now: export PATH=\"$INSTALL_BIN_DIR:\$PATH\" && hash -r && keating"
    step "Or launch directly: $expected_path"

    case "$resolved_path" in
      *"/node_modules/@diogenesoftoronto/keating/"* | *"/node_modules/.bin/keating")
        step "If that path is an old global npm install, remove it with: npm uninstall -g @diogenesoftoronto/keating"
        ;;
    esac
  fi
}

resolve_release_metadata() {
  normalized_version="$(normalize_version "$VERSION")"

  if [ "$normalized_version" = "latest" ]; then
    release_page="$(download_text "https://github.com/Diogenesoftoronto/keating/releases/latest")"
    resolved_version="$(printf '%s\n' "$release_page" | sed -n 's@.*releases/tag/v\([0-9][^"<>[:space:]]*\).*@\1@p' | head -n 1)"

    if [ -z "$resolved_version" ]; then
      echo "Failed to resolve the latest Keating release version." >&2
      exit 1
    fi
  else
    resolved_version="$normalized_version"
  fi

  bundle_name="keating-${resolved_version}-${asset_target}"
  archive_name="${bundle_name}.${archive_extension}"
  download_url="${KEATING_INSTALL_BASE_URL:-https://github.com/Diogenesoftoronto/keating/releases/download/v${resolved_version}}/${archive_name}"

  printf '%s\n%s\n%s\n%s\n' "$resolved_version" "$bundle_name" "$archive_name" "$download_url"
}

case "$(uname -s)" in
  Darwin)
    os="darwin"
    ;;
  Linux)
    os="linux"
    ;;
  *)
    echo "install.sh supports macOS and Linux. Use install.ps1 on Windows." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64)
    arch="x64"
    ;;
  arm64 | aarch64)
    arch="arm64"
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

require_command mktemp
require_command tar

asset_target="$os-$arch"
archive_extension="tar.gz"
release_metadata="$(resolve_release_metadata)"
resolved_version="$(printf '%s\n' "$release_metadata" | sed -n '1p')"
bundle_name="$(printf '%s\n' "$release_metadata" | sed -n '2p')"
archive_name="$(printf '%s\n' "$release_metadata" | sed -n '3p')"
download_url="$(printf '%s\n' "$release_metadata" | sed -n '4p')"

step "Installing Keating ${resolved_version} for ${asset_target}"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

archive_path="$tmp_dir/$archive_name"
step "Downloading ${archive_name}"
if ! download_file "$download_url" "$archive_path"; then
  cat >&2 <<EOF
Failed to download ${archive_name} from:
  ${download_url}

The ${asset_target} bundle is missing from the GitHub release.
This usually means the release exists, but not all platform bundles were uploaded.

Workarounds:
  - try again after the release finishes publishing
  - install via pnpm instead: pnpm add -g @diogenesoftoronto/keating
  - install via bun instead: bun add -g @diogenesoftoronto/keating
EOF
  exit 1
fi

mkdir -p "$INSTALL_APP_DIR"
rm -rf "$INSTALL_APP_DIR/$bundle_name"
run_with_spinner "Extracting ${archive_name}" tar -xzf "$archive_path" -C "$INSTALL_APP_DIR"

mkdir -p "$INSTALL_BIN_DIR"
step "Linking keating into $INSTALL_BIN_DIR"
cat >"$INSTALL_BIN_DIR/keating" <<EOF
#!/bin/sh
set -eu
exec "$INSTALL_APP_DIR/$bundle_name/keating" "\$@"
EOF
chmod 0755 "$INSTALL_BIN_DIR/keating"

add_to_path

case "$path_action" in
  added)
    step "PATH updated for future shells in $path_profile"
    step "Run now: export PATH=\"$INSTALL_BIN_DIR:\$PATH\" && hash -r && keating"
    ;;
  configured)
    step "PATH is already configured for future shells in $path_profile"
    step "Run now: export PATH=\"$INSTALL_BIN_DIR:\$PATH\" && hash -r && keating"
    ;;
  skipped)
    step "PATH update skipped"
    step "Run now: export PATH=\"$INSTALL_BIN_DIR:\$PATH\" && hash -r && keating"
    ;;
  *)
    step "$INSTALL_BIN_DIR is already on PATH"
    step "Run: hash -r && keating"
    ;;
esac

warn_command_conflict

printf 'Keating %s installed successfully.\n' "$resolved_version"
printf 'Run "keating" to start the hyperteacher shell.\n'
printf 'Or visit https://keating.help to use in browser.\n'
