{ pkgs, lib, config, ... }:
{
  # Per-project devenv config. See https://devenv.sh
  # Provides Bun + all build/test/release tasks. Git hooks call
  # `devenv tasks run` directly — no separate task runner needed.

  packages = with pkgs; [
    bun
  ];

  # Expo SDK 56 / React Native 0.85 native Android toolchain. Keep these
  # versions aligned with react-native/gradle/libs.versions.toml.
  android = {
    enable = true;
    reactNative.enable = true;
    platforms.version = [ "36" ];
    # The app targets 36, while Expo SDK 56's Android library project still
    # resolves Build Tools 35 during dependency configuration.
    buildTools.version = [ "36.0.0" "35.0.0" ];
    cmake.version = [ "3.22.1" ];
    ndk = {
      enable = true;
      version = [ "27.1.12297006" ];
    };
    abis = [ "arm64-v8a" ];
    emulator.enable = false;
    sources.enable = false;
    systemImages.enable = false;
    googleAPIs.enable = false;
    googleTVAddOns.enable = false;
    extras = [ ];
  };

  # ── Install / bootstrap ─────────────────────────────────────────
  tasks."install" = {
    description = "Install dependencies (root + web workspaces)";
    exec = ''
      bun install
      cd web && bun install
    '';
  };

  # ── Version sync ────────────────────────────────────────────────
  tasks."bumpy" = {
    description = "Run bumpy (version bumper). Passes through args.";
    exec = ''
      bumpy_bin="$DEVENV_ROOT/node_modules/.bin/bumpy"
      if [ ! -x "$bumpy_bin" ]; then
        echo "bumpy is not installed. Run: bun install" >&2
        exit 1
      fi
      exec "$bumpy_bin" "$@"
    '';
  };

  tasks."bump-version" = {
    description = "Bump version and sync across manifests (e.g. bump-version version)";
    exec = ''
      if [ "$#" -eq 0 ]; then
        echo "usage: bump-version <bumpy args>" >&2
        echo "example: bump-version version" >&2
        exit 1
      fi
      bumpy_bin="$DEVENV_ROOT/node_modules/.bin/bumpy"
      if [ ! -x "$bumpy_bin" ]; then
        echo "bumpy is not installed. Run: bun install" >&2
        exit 1
      fi
      "$bumpy_bin" "$@"
      bun scripts/sync-version.ts
    '';
  };

  tasks."sync-version" = {
    description = "Sync version numbers across all manifests and source files";
    exec = ''
      bun scripts/sync-version.ts
    '';
  };

  tasks."check-version" = {
    description = "Verify all version strings are in sync (CI-friendly)";
    exec = ''
      bun scripts/sync-version.ts --check
    '';
  };

  # ── Build ───────────────────────────────────────────────────────
  tasks."build" = {
    description = "Build root TypeScript project (requires versions in sync)";
    exec = ''
      bun scripts/sync-version.ts --check
      bun x tsc -p tsconfig.json
      bun scripts/copy-core-templates.ts
    '';
  };

  tasks."generate-nodepod-boot" = {
    description = "Generate NodePod boot files from source tree";
    exec = ''
      bun scripts/generate-nodepod-boot-files.ts
    '';
  };

  tasks."build-all" = {
    description = "Sync versions, build root, generate nodepod boot, build web";
    exec = ''
      bun scripts/sync-version.ts
      bun x tsc -p tsconfig.json
      bun scripts/copy-core-templates.ts
      bun scripts/generate-nodepod-boot-files.ts
      cd web && bun run build
    '';
  };

  # ── Test ────────────────────────────────────────────────────────
  tasks."test" = {
    description = "Run the root test suite";
    exec = ''
      bun test ./test/*.test.ts
    '';
  };

  tasks."test-web" = {
    description = "Run the web test suite";
    exec = ''
      cd web && bun test
    '';
  };

  tasks."test-e2e" = {
    description = "Real Pi RPC + tool-loop smoke test (requires KEATING_E2E=1 and secrets)";
    exec = ''
      KEATING_E2E=1 bun test ./test/e2e/tui.e2e.test.ts
    '';
  };

  tasks."mutate" = {
    description = "Run mutation testing with Stryker against src/core/";
    exec = ''
      stryker run
    '';
  };

  # ── Mobile (Expo / React Native) ────────────────────────────────
  tasks."mobile" = {
    description = "Build, install, and launch the native Expo dev client on Android";
    exec = ''
      cd mobile && bun run android
    '';
  };

  tasks."mobile-start" = {
    description = "Start Metro for the installed native dev client";
    exec = ''
      cd mobile && bun run start
    '';
  };

  tasks."mobile-prebuild" = {
    description = "Generate the Android native project from Expo configuration";
    exec = ''
      cd mobile && bun run android:prebuild
    '';
  };

  tasks."mobile-prebuild-clean" = {
    description = "Regenerate the Android native project (clean)";
    exec = ''
      cd mobile && bun run android:prebuild:clean
    '';
  };

  tasks."mobile-apk" = {
    description = "Build a locally installable Android debug APK";
    exec = ''
      cd mobile && bun run android:apk
    '';
  };

  tasks."mobile-check" = {
    description = "Typecheck + test the React Native app";
    exec = ''
      cd mobile && bun run typecheck
      cd mobile && bun run test
    '';
  };

  tasks."mobile-export" = {
    description = "Produce a production Android JS bundle locally";
    exec = ''
      cd mobile && bun run export:android
    '';
  };

  # ── Web ─────────────────────────────────────────────────────────
  tasks."web" = {
    description = "Start the Keating web UI dev server (Vite on port 3000)";
    exec = ''
      cd web && bun run dev
    '';
  };

  tasks."web-build" = {
    description = "Build the Keating web UI for production (vite + nitro)";
    exec = ''
      cd web && bun run build
    '';
  };

  tasks."web-preview" = {
    description = "Build and preview the Keating web UI production build";
    exec = ''
      cd web && bun run build && bun run preview
    '';
  };

  tasks."storybook" = {
    description = "Launch the Storybook component explorer";
    exec = ''
      cd web && bun run storybook
    '';
  };

  # ── CLI shortcuts ───────────────────────────────────────────────
  tasks."shell" = {
    description = "Launch the hyperteacher shell";
    exec = ''
      bun src/cli/main.ts shell
    '';
  };

  tasks."doctor" = {
    description = "Run the hyperteacher doctor";
    exec = ''
      bun src/cli/main.ts doctor
    '';
  };

  tasks."bench" = {
    description = "Run benchmarks (e.g. bench linear-algebra)";
    exec = ''
      bun src/cli/main.ts bench "$@"
    '';
  };

  tasks."evolve" = {
    description = "Evolve the teaching policy (e.g. evolve linear-algebra)";
    exec = ''
      bun src/cli/main.ts evolve "$@"
    '';
  };

  tasks."prompt-evolve" = {
    description = "Evolve a prompt template (default: learn)";
    exec = ''
      bun src/cli/main.ts prompt-evolve "$@"
    '';
  };

  tasks."plan" = {
    description = "Generate a lesson plan for a topic";
    exec = ''
      bun src/cli/main.ts plan "$@"
    '';
  };

  tasks."map" = {
    description = "Generate a lesson map for a topic";
    exec = ''
      bun src/cli/main.ts map "$@"
    '';
  };

  tasks."verify" = {
    description = "Generate a fact-checking checklist before teaching";
    exec = ''
      bun src/cli/main.ts verify "$@"
    '';
  };

  tasks."animate" = {
    description = "Animate a teaching artifact for a topic";
    exec = ''
      bun src/cli/main.ts animate "$@"
    '';
  };

  tasks."trace" = {
    description = "Trace a teaching session (filter by substring)";
    exec = ''
      bun src/cli/main.ts trace "$@"
    '';
  };

  # ── Video ───────────────────────────────────────────────────────
  tasks."video-intro" = {
    description = "Render the narrated Keating intro video";
    exec = ''
      bun scripts/render-keating-intro.mjs
    '';
  };

  tasks."video-web-stitch" = {
    description = "Stitch captured web UI frames into docs/assets/web-*.mp4";
    exec = ''
      bun scripts/stitch-web-frames.mjs
    '';
  };

  # ── Git hooks ───────────────────────────────────────────────────
  git-hooks.hooks = {
    keating-version-check = {
      enable = true;
      name = "keating-version-check";
      entry = "devenv tasks run check-version";
      language = "system";
      pass_filenames = false;
      always_run = true;
      stages = [ "pre-commit" ];
    };

    keating-root-tests = {
      enable = true;
      name = "keating-root-tests";
      entry = "devenv tasks run test";
      language = "system";
      pass_filenames = false;
      always_run = true;
      stages = [ "pre-push" ];
    };

    keating-web-tests = {
      enable = true;
      name = "keating-web-tests";
      entry = "devenv tasks run test-web";
      language = "system";
      pass_filenames = false;
      always_run = true;
      stages = [ "pre-push" ];
    };
  };
}
