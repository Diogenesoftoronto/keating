{ pkgs, lib, config, ... }:
{
  # Per-project devenv config. See https://devenv.sh
  # This shell complements the Flox setup with lightweight release hygiene:
  # - bumpy for canonical package-version bumps when available in nixpkgs
  # - repo-local git hooks that enforce version sync and run tests before push

  packages =
    (with pkgs; [
      bun
      just
    ])
    ++ lib.optionals (pkgs ? bumpy) [ pkgs.bumpy ];

  scripts.bump-version.exec = ''
    if [ "$#" -eq 0 ]; then
      echo "usage: bump-version <bumpy args>" >&2
      echo "example: bump-version patch" >&2
      exit 1
    fi

    if ! command -v bumpy >/dev/null 2>&1; then
      echo "bumpy is not available in this nixpkgs revision." >&2
      exit 1
    fi

    bumpy "$@"
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
