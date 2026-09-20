# Nono Sandbox Profiles for Keating & Antigravity

This directory contains secure, capability-based [nono](https://nono.sh) sandbox profiles tailored for Keating development, the Antigravity agent environment, Entire session tracking, GitNexus code intelligence, and Graft context graphs.

## Available Profiles

1. **`antigravity.json`** (Installed as `antigravity` in `~/.config/nono/profiles/antigravity.json`):
   - Configured specifically for **Antigravity** (`agy`), **Entire CLI** (`entire`), **GitNexus** (`gitnexus`), and **Graft** (`graft`).
   - Grants access to:
     - **Antigravity**: `$HOME/.gemini/antigravity-cli` (read/write for brain, conversations, tasks, transcripts) and `$HOME/.gemini` (read-only for global settings/skills).
     - **Entire CLI**: `$HOME/.config/entire` and `$HOME/.cache/entire` (read/write for session tracking, checkpoint search, tokens) and `$WORKDIR/.entire`.
     - **D-Bus Keyring**: `$XDG_RUNTIME_DIR/bus` (`/run/user/1000/bus`) for Entire CLI credentials.
     - **GitNexus**: `$WORKDIR/.gitnexus`, `$HOME/.gitnexus` (global registry), and `$HOME/.lbdb` (LadybugDB/DuckDB native extension cache).
     - **Graft**: `$WORKDIR/graft` and `$HOME/.graft` (telemetry & configs).
     - **Local Global Node packages**: `$HOME/.local/lib`, `$HOME/.local/node_modules`, `$HOME/.local/package.json`, `$HOME/.local/package-lock.json`.
     - **Development runtimes**: Bun (`bun_runtime`), Node.js (`node_runtime`), Nix / Devenv (`nix_runtime`), Python (`python_runtime`), and Git config (`git_config`).

2. **`keating.json`** (Installed as `keating` in `~/.config/nono/profiles/keating.json`):
   - Hardened proxy-filtered profile for repository building, local testing, and running Keating CLI/TUI.
   - Enforces strict L7 proxy domain allowlisting and local IPC port restrictions.

## Security Guarantees

- **Host Credential Isolation**: Denies access to system keyrings, SSH keys, GPG keys, AWS/GCP/Azure configs, `~/.git-credentials`, and cloud tokens via `deny_credentials`, `deny_keychains_linux`, and `deny_keychains_macos`.
- **Browser Protection**: Denies access to stored browser sessions, cookies, and saved passwords (`deny_browser_data_linux`, `deny_browser_data_macos`).
- **Shell Privacy**: Blocks shell configs (`~/.bashrc`, `~/.zshrc`) and command histories.
- **Environment Scrubbing**: Denies and strips sensitive host environment variables (`AWS_*`, `AZURE_*`, `GCLOUD_*`, `NOTORGANIC_*`, `GITHUB_TOKEN`, `SSH_*`, `VAULT_*`).
- **Rollback Exclusions**: Excludes heavy or sensitive directories (`.git`, `node_modules`, `dist`, `.output`, `.keating/outputs`, `.entire/metadata`, `.entire/tmp`, `.gitnexus`, `brain`) from rollback snapshots.

## Usage

```bash
# 1. Entire CLI operations inside the sandbox
nono run -p antigravity -- entire status
nono run -p antigravity -- entire recap
nono run -p antigravity -- entire search "checkpoint"

# 2. GitNexus operations inside the sandbox
nono run -p antigravity -- gitnexus status
nono run -p antigravity -- gitnexus context main
nono run -p antigravity -- gitnexus impact main

# 3. Graft operations inside the sandbox
nono run -p antigravity -- graft map
nono run -p antigravity -- graft ask "lesson plan"
nono run -p antigravity -- graft callers main

# 4. Keating CLI inside the sandbox
nono run -p antigravity -- bun src/cli/main.ts version
```
