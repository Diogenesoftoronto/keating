# Desktop release signing

Stable releases omit Windows/macOS installers when all signing credentials for
that platform are absent. A partially configured signing identity fails the
release, as does any configured platform build or signing failure. Unsigned
installers are never published as a fallback.
Store credentials in GitHub Actions secrets; do not commit certificates, private
keys, passwords, or Apple account tokens.

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
