{ pkgs, lib, config, ... }:
{
  # Per-project devenv config. See https://devenv.sh
  # Provides lightweight release hygiene:
  # - @varlock/bumpy for canonical package-version bumps
  # - repo-local git hooks that enforce version sync and run tests before push

  packages = with pkgs; [
    bun
    just
  ];

  scripts.bumpy.exec = ''
    bumpy_bin="$DEVENV_ROOT/node_modules/.bin/bumpy"
    if [ ! -x "$bumpy_bin" ]; then
      echo "bumpy is not installed. Run: bun install" >&2
      exit 1
    fi

    exec "$bumpy_bin" "$@"
  '';

  scripts.bump-version.exec = ''
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
    just sync-version
  '';

  git-hooks.hooks = {
    keating-version-check = {
      enable = true;
      name = "keating-version-check";
      entry = "${pkgs.just}/bin/just check-version";
      language = "system";
      pass_filenames = false;
      always_run = true;
      stages = [ "pre-commit" ];
    };

    keating-root-tests = {
      enable = true;
      name = "keating-root-tests";
      entry = "${pkgs.just}/bin/just test";
      language = "system";
      pass_filenames = false;
      always_run = true;
      stages = [ "pre-push" ];
    };

    keating-web-tests = {
      enable = true;
      name = "keating-web-tests";
      entry = "${pkgs.just}/bin/just test-web";
      language = "system";
      pass_filenames = false;
      always_run = true;
      stages = [ "pre-push" ];
    };
  };
}
