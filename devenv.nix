{ pkgs, lib, config, ... }:
let
  similarityTsVersion = "0.5.0";
  similarityTsTarget =
    if pkgs.stdenv.hostPlatform.isLinux && pkgs.stdenv.hostPlatform.isx86_64 then
      "x86_64-unknown-linux-gnu"
    else if pkgs.stdenv.hostPlatform.isDarwin && pkgs.stdenv.hostPlatform.isAarch64 then
      "aarch64-apple-darwin"
    else
      throw "similarity-ts ${similarityTsVersion} has no upstream binary for ${pkgs.stdenv.hostPlatform.system}";
  similarityTsHash =
    if similarityTsTarget == "x86_64-unknown-linux-gnu" then
      "sha256-Kv2mIBtq+x7jbBzlG5WlOOyZMQx59mGQVTbZF0cKQGo="
    else
      "sha256-1aarz5FbhwYYV8I6GTSIOpm5OXCmbGJ8yLfzKGwLqRY=";
  similarityTs = pkgs.stdenvNoCC.mkDerivation {
    pname = "similarity-ts";
    version = similarityTsVersion;

    src = pkgs.fetchurl {
      url = "https://github.com/mizchi/similarity/releases/download/v${similarityTsVersion}/similarity-v${similarityTsVersion}-${similarityTsTarget}.tar.gz";
      hash = similarityTsHash;
    };

    sourceRoot = "similarity-v${similarityTsVersion}-${similarityTsTarget}";

    installPhase = ''
      runHook preInstall
      install -Dm755 similarity-ts "$out/bin/similarity-ts"
      runHook postInstall
    '';
  };
in
{
  # Per-project devenv config. See https://devenv.sh
  # Provides Bun + all build/test/release tasks. Git hooks call
  # `devenv tasks run` directly — no separate task runner needed.

  packages = with pkgs; [
    bun
    gcc
    gnumake
    (python3.withPackages (pythonPackages: [ pythonPackages.setuptools ]))
    similarityTs
    typst
  ];

  # `devenv up` is an interactive, all-surface development workspace. The two
  # terminal clients need real PTYs, so use process-compose rather than the
  # non-interactive native log viewer.
  process.manager.implementation = "process-compose";
  process.managers.process-compose.tui.enable = true;

  processes = {
    terminal-shell = {
      exec = "bun src/cli/main.ts shell";
      process-compose.is_interactive = true;
    };

    tui = {
      exec = "bun src/cli/main.ts tui";
      process-compose.is_interactive = true;
    };

    web = {
      exec = "bun run dev";
      cwd = "./web";
      ready = {
        http.get.port = 3000;
        timeout = 120;
      };
    };

    desktop = {
      exec = "bun run dev";
      cwd = "./desktop";
      after = [ "devenv:processes:web" ];
    };

    mobile-web = {
      exec = "bun run web";
      cwd = "./mobile";
      ready = {
        http.get.port = 8081;
        timeout = 120;
      };
    };

    storybook = {
      exec = "bun run storybook";
      cwd = "./web";
      ready = {
        http.get.port = 6006;
        timeout = 120;
      };
    };
  };

  # ---------------------------------------------------------------------------
  # Non-secret build/runtime configuration.
  #
  # devenv.nix is committed, so ONLY non-secret defaults belong here. Secrets
  # (PostHog project token, OAuth client secrets, provider API keys) live in
  # web/.env.local, which is gitignored. web/.env.example documents every
  # variable, secret or not.
  #
  # Not Organic hosted access -- the hosted model, credit packs, course
  # workspaces, and hosted notebooks -- is OFF by default. Setting these flags
  # to "true" is necessary but NOT sufficient to authenticate anyone: the Nitro
  # server also needs a NotOrganicSessionAdapter registered on each authenticated
  # request, and nothing in the repo registers one outside tests. Until that
  # exists, every hosted call returns 503 notorganic_auth_adapter_unavailable.
  # That is intentional -- see web/src/notorganic-provider/OPERATIONS.md.
  #
  # This block, web/.env.example, and OPERATIONS.md must agree. That is enforced:
  #   devenv tasks run keating:check-env
  env = {
    # Server-side gate for the hosted provider routes under
    # web/server/api/notorganic/**.
    NOTORGANIC_ENABLED = "false";

    # Client-side gate. Vite exposes VITE_-prefixed shell variables on
    # import.meta.env, so this value reaches the browser bundle. While it is
    # "false" the hosted UI stays hidden instead of rendering dead controls.
    VITE_NOTORGANIC_ENABLED = "false";

    # Browser-to-provider OAuth/DPoP contract. Deployment-specific values stay
    # blank so a local shell cannot accidentally advertise working checkout.
    VITE_NOTORGANIC_PUBLIC_ISSUER = "";
    VITE_NOTORGANIC_AUTHORIZATION_URL = "";
    VITE_NOTORGANIC_CLIENT_ID = "";
    VITE_NOTORGANIC_REDIRECT_URI = "";
    VITE_NOTORGANIC_SCOPE = "wallet:read usage:read billing:checkout infer:balanced realtime:connect";

    # Browser inference reservation ceiling (100000 micro-USD = $0.10).
    VITE_NOTORGANIC_MAX_COST_MICROUSD = "100000";

    # HTTPS gateway origin. Must have no /v1 path, query, or fragment; the
    # server rejects anything else at startup.
    NOTORGANIC_ISSUER = "https://api.notorganic.info";

    # Positive per-request reservation ceiling in micro-USD (50000 = $0.05).
    NOTORGANIC_MAX_COST_MICROUSD = "50000";
  };

  # Stryker is a project dependency so its version stays pinned in bun.lock.
  # Expose that local executable in the devenv shell like a system package.
  scripts.stryker.exec = ''
    stryker_bin="$DEVENV_ROOT/node_modules/.bin/stryker"
    if [ ! -x "$stryker_bin" ]; then
      echo "Stryker is not installed. Run: devenv tasks run keating:install" >&2
      exit 1
    fi
    exec "$stryker_bin" "$@"
  '';

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
  tasks."keating:install" = {
    description = "Install dependencies (root + web workspaces)";
    exec = ''
      # node-pty is compiled on Linux. Do not leak foreign toolchain include
      # paths into node-gyp's reproducible devenv build.
      env -u CPLUS_INCLUDE_PATH -u C_INCLUDE_PATH -u LIBRARY_PATH bun install
      cd web && bun install
    '';
  };

  # ── Version sync ────────────────────────────────────────────────
  tasks."keating:version" = {
    description = "Show the current version and Bun version commands";
    exec = ''
      bun pm version
    '';
  };

  tasks."keating:bump-version" = {
    description = "Bump with bun pm version and synchronize every version surface";
    input.version = "";
    exec = ''
      release_version="$(bun -e 'const input = JSON.parse(process.env.DEVENV_TASK_INPUT ?? "{}"); process.stdout.write(typeof input.version === "string" ? input.version : "")')"
      if [ -z "$release_version" ]; then
        echo "usage: devenv tasks run keating:bump-version --input version=<patch|minor|major|version>" >&2
        exit 1
      fi
      bun pm version "$release_version" --no-git-tag-version
      bun scripts/sync-version.ts
    '';
  };

  tasks."keating:sync-version" = {
    description = "Sync version numbers across all manifests and source files";
    exec = ''
      bun scripts/sync-version.ts
    '';
  };

  tasks."keating:check-version" = {
    description = "Verify all version strings are in sync (CI-friendly)";
    exec = ''
      bun scripts/sync-version.ts --check
    '';
  };

  tasks."keating:check-env" = {
    description = "Verify Not Organic config docs agree (devenv.nix, .env.example, OPERATIONS.md)";
    exec = ''
      bun scripts/check-env-docs.ts
    '';
  };

  tasks."keating:check-atlas" = {
    description = "Verify the artifact atlas archetypes, modes, presets, and folded map still behave";
    exec = ''
      bun scripts/check-artifact-atlas.mjs
    '';
  };

  # ── Build ───────────────────────────────────────────────────────
  tasks."keating:build" = {
    description = "Build root TypeScript project (requires versions in sync)";
    exec = ''
      bun scripts/sync-version.ts --check
      bun x tsc -p tsconfig.json
      bun scripts/copy-core-templates.ts
    '';
  };

  tasks."keating:generate-nodepod-boot" = {
    description = "Generate NodePod boot files from source tree";
    exec = ''
      bun scripts/generate-nodepod-boot-files.ts
    '';
  };

  tasks."keating:build-all" = {
    description = "Sync versions, build root, generate nodepod boot, build web";
    exec = ''
      bun scripts/sync-version.ts
      bun x tsc -p tsconfig.json
      bun scripts/copy-core-templates.ts
      bun scripts/generate-nodepod-boot-files.ts
      cd web && bun run build
    '';
  };

  tasks."keating:study-analysis" = {
    description = "Regenerate the versioned paper analysis artifacts";
    exec = ''
      bun scripts/study-analysis.mjs
    '';
  };

  tasks."keating:paper" = {
    description = "Regenerate the study analysis and build the published paper PDF";
    exec = ''
      bun scripts/study-analysis.mjs
      typst compile --diagnostic-format short docs/study.typ web/public/keating-metaharness.pdf
    '';
  };

  tasks."keating:paper-check" = {
    description = "Compile the paper to a temporary PDF without replacing the published asset";
    exec = ''
      typst compile --diagnostic-format short docs/study.typ /tmp/keating-study-check.pdf
    '';
  };

  # ── Test ────────────────────────────────────────────────────────
  tasks."keating:test" = {
    description = "Run the root test suite";
    exec = ''
      bun test ./test/*.test.ts
    '';
  };

  tasks."keating:test-web" = {
    description = "Run the web test suite";
    exec = ''
      cd web && bun test
    '';
  };

  tasks."keating:test-e2e" = {
    description = "Real Pi RPC + tool-loop smoke test (requires KEATING_E2E=1 and secrets)";
    exec = ''
      KEATING_E2E=1 bun test ./test/e2e/tui.e2e.test.ts
    '';
  };

  tasks."keating:mutate" = {
    description = "Run mutation testing with Stryker against src/core/";
    exec = ''
      stryker run
    '';
  };

  # ── Mobile (Expo / React Native) ────────────────────────────────
  tasks."keating:mobile" = {
    description = "Build, install, and launch the native Expo dev client on Android";
    exec = ''
      cd mobile && bun run android
    '';
  };

  tasks."keating:mobile-start" = {
    description = "Start Metro for the installed native dev client";
    exec = ''
      cd mobile && bun run start
    '';
  };

  tasks."keating:mobile-web" = {
    description = "Start the React Native app in Expo's web runtime (port 8081)";
    exec = ''
      cd mobile && bun run web
    '';
  };

  tasks."keating:mobile-prebuild" = {
    description = "Generate the Android native project from Expo configuration";
    exec = ''
      cd mobile && bun run android:prebuild
    '';
  };

  tasks."keating:mobile-prebuild-clean" = {
    description = "Regenerate the Android native project (clean)";
    exec = ''
      cd mobile && bun run android:prebuild:clean
    '';
  };

  tasks."keating:mobile-apk" = {
    description = "Build a locally installable Android debug APK";
    exec = ''
      unset CPLUS_INCLUDE_PATH C_INCLUDE_PATH LIBRARY_PATH
      cd mobile && bun run android:apk
    '';
  };

  tasks."keating:mobile-check" = {
    description = "Typecheck + test the React Native app";
    exec = ''
      cd mobile && bun run typecheck
      bun run test
    '';
  };

  tasks."keating:mobile-export" = {
    description = "Produce a production Android JS bundle locally";
    exec = ''
      cd mobile && bun run export:android
    '';
  };

  # ── Web ─────────────────────────────────────────────────────────
  tasks."keating:web" = {
    description = "Start the Keating web UI dev server (Vite on port 3000)";
    exec = ''
      cd web && bun run dev
    '';
  };

  tasks."keating:web-build" = {
    description = "Build the Keating web UI for production (vite + nitro)";
    exec = ''
      cd web && bun run build
    '';
  };

  tasks."keating:web-preview" = {
    description = "Build and preview the Keating web UI production build";
    exec = ''
      cd web && bun run build && bun run preview
    '';
  };

  # ── Desktop ─────────────────────────────────────────────────────
  tasks."keating:desktop" = {
    description = "Build and launch the Electron desktop app against the web dev server";
    exec = ''
      cd desktop && bun run dev
    '';
  };

  tasks."keating:desktop-check" = {
    description = "Typecheck + test the Electron desktop host";
    exec = ''
      cd desktop && bun run typecheck
      bun run test
    '';
  };

  tasks."keating:desktop-build" = {
    description = "Build the Electron main process and stage the production web runtime";
    exec = ''
      cd desktop && bun run build:main
    '';
  };

  tasks."keating:desktop-package" = {
    description = "Build distributable desktop packages";
    exec = ''
      cd desktop && bun run dist
    '';
  };

  tasks."keating:desktop-package-smoke" = {
    description = "Assemble an unpacked desktop app for local smoke testing";
    exec = ''
      cd desktop && bun x electron-builder --dir
    '';
  };

  tasks."keating:storybook" = {
    description = "Launch the Storybook component explorer";
    exec = ''
      cd web && bun run storybook
    '';
  };

  # ── CLI shortcuts ───────────────────────────────────────────────
  tasks."keating:shell" = {
    description = "Launch the hyperteacher shell";
    exec = ''
      bun src/cli/main.ts shell
    '';
  };

  tasks."keating:tui" = {
    description = "Launch the OpenTUI host over Pi RPC";
    exec = ''
      bun src/cli/main.ts tui
    '';
  };

  tasks."keating:doctor" = {
    description = "Run the hyperteacher doctor";
    exec = ''
      bun src/cli/main.ts doctor
    '';
  };

  tasks."keating:bench" = {
    description = "Run benchmarks with the default topic";
    exec = ''
      bun src/cli/main.ts bench
    '';
  };

  tasks."keating:evolve" = {
    description = "Evolve the teaching policy with the default topic";
    exec = ''
      bun src/cli/main.ts evolve
    '';
  };

  tasks."keating:prompt-evolve" = {
    description = "Evolve a prompt template (default: learn)";
    exec = ''
      bun src/cli/main.ts prompt-evolve
    '';
  };

  tasks."keating:plan" = {
    description = "Generate a lesson plan for a topic";
    input.topic = "";
    exec = ''
      topic="$(bun -e 'const input = JSON.parse(process.env.DEVENV_TASK_INPUT ?? "{}"); process.stdout.write(typeof input.topic === "string" ? input.topic : "")')"
      if [ -z "$topic" ]; then
        echo "usage: devenv tasks run keating:plan --input topic=<topic>" >&2
        exit 1
      fi
      bun src/cli/main.ts plan "$topic"
    '';
  };

  tasks."keating:map" = {
    description = "Generate a lesson map for a topic";
    input.topic = "";
    exec = ''
      topic="$(bun -e 'const input = JSON.parse(process.env.DEVENV_TASK_INPUT ?? "{}"); process.stdout.write(typeof input.topic === "string" ? input.topic : "")')"
      if [ -z "$topic" ]; then
        echo "usage: devenv tasks run keating:map --input topic=<topic>" >&2
        exit 1
      fi
      bun src/cli/main.ts map "$topic"
    '';
  };

  tasks."keating:verify" = {
    description = "Generate a fact-checking checklist before teaching";
    input.topic = "";
    exec = ''
      topic="$(bun -e 'const input = JSON.parse(process.env.DEVENV_TASK_INPUT ?? "{}"); process.stdout.write(typeof input.topic === "string" ? input.topic : "")')"
      if [ -z "$topic" ]; then
        echo "usage: devenv tasks run keating:verify --input topic=<topic>" >&2
        exit 1
      fi
      bun src/cli/main.ts verify "$topic"
    '';
  };

  tasks."keating:animate" = {
    description = "Animate a teaching artifact for a topic";
    input.topic = "";
    exec = ''
      topic="$(bun -e 'const input = JSON.parse(process.env.DEVENV_TASK_INPUT ?? "{}"); process.stdout.write(typeof input.topic === "string" ? input.topic : "")')"
      if [ -z "$topic" ]; then
        echo "usage: devenv tasks run keating:animate --input topic=<topic>" >&2
        exit 1
      fi
      bun src/cli/main.ts animate "$topic"
    '';
  };

  tasks."keating:trace" = {
    description = "List teaching session traces";
    exec = ''
      bun src/cli/main.ts trace
    '';
  };

  # ── Video ───────────────────────────────────────────────────────
  tasks."keating:video-intro" = {
    description = "Render the narrated Keating intro video";
    exec = ''
      bun scripts/render-keating-intro.mjs
    '';
  };

  tasks."keating:video-web-stitch" = {
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
      entry = "devenv tasks run keating:check-version";
      language = "system";
      pass_filenames = false;
      always_run = true;
      stages = [ "pre-commit" ];
    };

    # Documentation that drifts is worse than none: an operator follows it and
    # gets a 503 with no explanation. Keep the three sources honest at commit.
    keating-env-docs-check = {
      enable = true;
      name = "keating-env-docs-check";
      entry = "devenv tasks run keating:check-env";
      language = "system";
      pass_filenames = false;
      always_run = true;
      stages = [ "pre-commit" ];
    };

    # The atlas is a catalogue of working miniatures, so a broken demo reads exactly
    # like a working one in a diff. Run its contracts at commit.
    keating-atlas-check = {
      enable = true;
      name = "keating-atlas-check";
      entry = "devenv tasks run keating:check-atlas";
      language = "system";
      pass_filenames = false;
      always_run = true;
      stages = [ "pre-commit" ];
    };

    keating-root-tests = {
      enable = true;
      name = "keating-root-tests";
      entry = "devenv tasks run keating:test";
      language = "system";
      pass_filenames = false;
      always_run = true;
      stages = [ "pre-push" ];
    };

    keating-web-tests = {
      enable = true;
      name = "keating-web-tests";
      entry = "devenv tasks run keating:test-web";
      language = "system";
      pass_filenames = false;
      always_run = true;
      stages = [ "pre-push" ];
    };
  };
}
