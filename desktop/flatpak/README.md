# Keating Flatpak repository

The stable app ID is `help.keating.desktop`, with `x86_64` and `aarch64` refs.
The repository is hosted at <https://diogenesoftoronto.github.io/keating/flatpak>.
This directory contains packaging inputs; the build script imports an already
built Electron application. It does not rebuild or relabel the application.

## Build and sign

Install Flatpak, GnuPG, and `appstreamcli` with its compose addon (Debian/Ubuntu
package `appstream-compose`). Nixpkgs `appstream` includes compose in its main
output: `nix shell nixpkgs#appstream`. The script checks that compose is available
before staging. `APPSTREAMCLI=/absolute/path/to/appstreamcli` selects a specific
installation. Then install matching runtime refs from Flathub:

```sh
flatpak install --user -y --arch=x86_64 flathub \
  org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08 \
  org.electronjs.Electron2.BaseApp//25.08
```

Use `--arch=aarch64` for the other architecture. Import the release signing key
into a dedicated `GNUPGHOME` and unlock it before running the build. Keep that
keyring outside the repository output. Only its public key is exported.

```sh
node desktop/scripts/build-flatpak.mjs \
  --app-dir desktop/release/linux-unpacked \
  --repo /absolute/path/to/flatpak-repository \
  --arch x86_64 \
  --gpg-sign FULL_SIGNING_KEY_FINGERPRINT
```

For an extracted existing release, pass `--version` with that artifact's exact
version. The app directory must contain `keating-desktop`, `resources/app.asar`,
and `resources/nitro/server/index.mjs`. ELF architecture is checked before any
export. Each invocation adds its architecture to the repository and signs both
the application commit and refreshed repository metadata. Run architecture
exports sequentially when they share one output repository.

The script uses `flatpak build-init`, copies the prebuilt application without
executing a target-architecture shell, then runs `build-finish`, `build-export`,
and `build-update-repo`. Before export, host `appstreamcli compose` merges the
metainfo, launcher, and icon into `share/app-info` catalog data with `--no-net`,
using local assets and no invented media hosting URL, so software centers
can display the app. This composition does not execute the target architecture.
Temporary staging is under ignored `.local/`. It also
writes `keating.flatpakrepo` and `help.keating.desktop.flatpakref`, each with the
public signing key embedded. Publish the entire repository directory, including
OSTree objects, refs, summary, and signatures. Retain existing objects/refs when
adding releases so installed apps can update.

## Install after publication

```sh
flatpak remote-add --user --if-not-exists keating \
  https://diogenesoftoronto.github.io/keating/flatpak/keating.flatpakrepo
flatpak install --user keating help.keating.desktop
flatpak run help.keating.desktop
```

The runtime still comes from Flathub; Keating itself comes from this signed
repository. This is not a Flathub submission.

## Sandbox

The Zypak wrapper launches Electron inside the Flatpak sandbox. Permissions
allow networking, display, audio, IPC, and GPU access. They do not expose the
host filesystem, home directory, host process execution, or arbitrary D-Bus.
Desktop portals provide user-mediated file selection without blanket home
access. Study state stays in the app's private per-user directory. Workspace
commands run inside the Flatpak environment and only see tools available there.

Runtime and wrapper configuration follow the official
[Flatpak Electron guide](https://docs.flatpak.org/en/latest/electron.html) and
[Electron example using runtime 25.08](https://github.com/flathub/org.flathub.electron-sample-app/blob/master/org.flathub.electron-sample-app.yml).
Both Electron2.BaseApp 25.08 architectures were confirmed available from Flathub.

A successful export proves packaging/signing. Launch, OAuth, sound, permissions,
and native-storage behavior still need a desktop session smoke test on each
architecture; an export does not establish those behaviors.

Catalog generation follows the [official Flatpak AppStream convention](https://docs.flatpak.org/en/latest/conventions.html#appstream-metadata).
