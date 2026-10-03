# Desktop release signing

Stable releases omit Windows/macOS installers when all signing credentials for
that platform are absent. A partially configured signing identity fails the
release, as does any configured platform build or signing failure. Unsigned
installers are never published as a fallback.
Store CI credentials in GitHub Actions secrets; do not commit private signing
exports (PFX/P12), private keys, passwords, or Apple account tokens. Public
verification certificates and fingerprints may be committed separately.

## Windows

`KEATING_WINDOWS_CERTIFICATE_BASE64` is the base64-encoded PFX export of a
trusted Authenticode code signing certificate, including its private key.
`KEATING_WINDOWS_CERTIFICATE_PASSWORD` unlocks that PFX. The certificate must
permit code signing and be valid for the publisher. Electron Builder signs
the app, native libraries and NSIS installer with SHA-256. The Windows runner
requires trusted, timestamped signatures on every packaged EXE, DLL and NODE
file and the installer before upload. Signing does not guarantee immediate
Microsoft SmartScreen reputation or Microsoft Store approval.

Hardware-backed certificates that cannot be exported as PFX require a custom
signing service integration; do not substitute a self-signed certificate.

## Apple

`KEATING_APPLE_CERTIFICATE_BASE64` is the base64-encoded P12 export of an Apple
**Developer ID Application** certificate and its private key.
`KEATING_APPLE_CERTIFICATE_PASSWORD` unlocks it. Notarization additionally needs
`KEATING_APPLE_ID`, `KEATING_APPLE_APP_SPECIFIC_PASSWORD`, and
`KEATING_APPLE_TEAM_ID`, all belonging to the same Apple Developer team.

The release builds an Apple Silicon app, DMG and ZIP. Hardened runtime signing
includes the native LiteRT executable/library. Electron Builder notarizes and
staples the app; the workflow verifies its Developer ID/team, signature,
stapled ticket and Gatekeeper acceptance, then notarizes and staples the DMG.
The Intel terminal archive remains available, but there is no Intel desktop
installer because the pinned LiteRT SDK provides only a macOS arm64 library.
This is direct distribution, not Mac App Store or iOS signing.

## Linux and checksums

The existing `KEATING_RELEASE_SIGNING_KEY` and
`KEATING_RELEASE_SIGNING_PASSPHRASE` must match `fingerprint.txt`.
The release imports them into an isolated temporary keyring, embeds and verifies
RPM signatures, verifies detached signatures for AppImage/DEB/RPM, and publishes
the public key plus signed SHA256SUMS covering terminal archives and all native
installers. Authenticode and Apple notarization remain separate platform gates.

Local TypeScript/tests/configuration checks do not prove platform signing. The
native GitHub runners must complete successfully before publishing a release.

## Separate self-signed Windows preview

The manual-only `windows-selfsigned-preview.yml` workflow is separate from the
trusted stable release. Its default is a credential-free Windows preflight;
`preflight_only=false` requires the exact existing `windows-selfsigned-v4.0.7`
tag (or the matching preview tag for the source version). `publish=true` only
attaches checked assets to an existing, explicitly self-signed **draft
prerelease**; it does not make that draft public. No stable workflow or trusted
Windows secret name is used by this preview.

The public preview identity is `windows-selfsigned-public.pem`, pinned by the
DER certificate SHA-256 in `windows-selfsigned-fingerprint.txt`. Its subject is
`CN=Keating Self-Signed Preview`, RSA-3072, with code-signing EKU and a one-year
validity ending **2027-10-03 00:16:23 UTC**. The private PFX and its password
remain on the owner's computer, with the password in the OS keyring. Never
put them into a chat, commit, build artifact or release asset.

### Local Windows route

A native Windows machine can build and sign this preview without sending any
credentials to GitHub. The current Linux preparation host has no Wine,
Windows signing tool or configured Windows VM, so that build cannot be
claimed complete there. The owner controls any transfer of their encrypted
PFX to their Windows machine.

Use PowerShell 7 and a CMake C toolchain, such as the Visual Studio C++ build
tools, for the bundled native runtime. On Windows, check out the reviewed preview tag and install its locked
dependencies with Bun 1.3.13 and Node 24, including `spikes/flue-host` and
`web`. Set `WIN_CSC_LINK` to the private local PFX path and populate
`WIN_CSC_KEY_PASSWORD` in the process environment through a secure local
password prompt, never a literal command or saved script. The checkout must be
clean. Generated directories `desktop/release`, `desktop/dist`,
`packages/p2p-core/dist`, `web/dist` and `web/.output` must be absent or empty;
preserve old outputs by moving them elsewhere first. Run:

```powershell
$env:RELEASE_TAG = 'windows-selfsigned-v4.0.7'
node desktop/scripts/windows-preview-build.mjs build
$source = (git rev-parse HEAD).Trim()
./desktop/scripts/verify-windows-selfsigned.ps1 -Version 4.0.7 -SourceCommit $source -ReleaseTag windows-selfsigned-v4.0.7
```

Clear the signing password from the process environment afterward. Run the
same credential-free preflight beforehand with
`./desktop/scripts/verify-windows-selfsigned.ps1 -Preflight`.

### Optional owner handoff for GitHub's Windows runner

If the owner chooses this route, configure **only** these two repository
Actions secrets at
[Keating Actions secrets](https://github.com/Diogenesoftoronto/keating/settings/secrets/actions):

- `KEATING_WINDOWS_SELF_SIGNED_CERTIFICATE_BASE64`: base64 of the encrypted
  local PFX, including its private key.
- `KEATING_WINDOWS_SELF_SIGNED_CERTIFICATE_PASSWORD`: its existing OS-keyring
  password, keyed by `application=keating` and
  `purpose=windows-selfsigned-code-signing`.

The owner can invoke this helper directly from their own terminal on the
Linux preparation machine. Its default only prints instructions; it reads
the keyring and uploads values through standard input **only** with the
explicit `--upload` flag. It checks the PFX against the pinned public identity
before upload. An assistant must not invoke that upload mode.

```sh
python3 desktop/scripts/configure-windows-preview-secrets.py
# Owner-only, if choosing the GitHub runner:
python3 desktop/scripts/configure-windows-preview-secrets.py --upload
```

Neither secret may replace `KEATING_WINDOWS_CERTIFICATE_BASE64` or
`KEATING_WINDOWS_CERTIFICATE_PASSWORD`, which remain reserved for trusted
stable signing. A missing or partial preview pair fails the signing build.

### Verification and publication gate

Both routes retain `forceCodeSigning`, SHA-256 and signing of packaged EXE,
DLL and NODE files plus the NSIS installer. The native verifier downloads
the official osslsigncode 2.10 Windows archive and checks its SHA-256 before
execution. It verifies each PE digest, the pinned leaf certificate,
Authenticode signature and timestamp against existing public Windows roots
exported to a temporary PEM bundle. No certificate is installed into the
Windows trust store. Windows trust status is reported separately and never
used as a substitute for cryptographic verification.

The build wrapper requires a clean checkout and fresh generated directories,
records the exact source/tag and hashes every packaged output after the build.
Verification checks that receipt and clean source both before signature checks
and after the runtime probes. This records the local build sequence and output
identity; it is not a reproducible-build or third-party provenance attestation.

The verifier also runs the packaged Electron native dependency/storage smoke
test and the packaged offline executable's `--probe`. This is packaged-runtime
proof, not clean-install or real GUI-session proof. All checks must pass
before `desktop/release/selfsigned-preview/` receives:

- `Keating-4.0.7-windows-x64-selfsigned-setup.exe`
- `windows-selfsigned-public.pem`
- `signing-report.json` (exact source, certificate, each signed file and checks)
- `SHA256SUMS`

Before making the draft prerelease public, independently download those
assets, verify checksums and source/tag identity, and confirm the actual
native run succeeded. Label it **self-signed preview** and keep it outside
the latest stable download selection. Self-signing does not establish
Windows publisher trust, SmartScreen reputation or Store approval.
